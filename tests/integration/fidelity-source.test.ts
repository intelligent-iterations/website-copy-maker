import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
/**
 * Pixel-fidelity gate against a live source site.
 *
 * Runs the full pipeline against `process.env.FIDELITY_SOURCE_URL`
 * (required when the test is enabled), boots the generated `next dev`,
 * screenshots both at three viewports, pixel-diffs each, and asserts the
 * per-viewport similarity targets.
 *
 * Anti-cheat + structural invariants run inside `runAgent` itself via
 * `assertGenerationIntegrity` - when they fail, `runAgent` throws and the
 * test fails with the violation list. This test no longer duplicates that
 * logic.
 *
 * Slow (~3-6 min wall-clock). Gated behind `FIDELITY_TEST=1` so default
 * `pnpm test` doesn't run it. Invocation:
 *   FIDELITY_TEST=1 pnpm vitest run tests/integration/fidelity-source.test.ts
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgent } from "../../src/agent/runAgent.js";
import { runGeneratedSite } from "../../src/qa/runGeneratedSite.js";

const ENABLED = process.env.FIDELITY_TEST === "1";
const SOURCE_URL = process.env.FIDELITY_SOURCE_URL ?? "";
if (ENABLED && !SOURCE_URL) throw new Error("FIDELITY_SOURCE_URL is required");
// Desktop drives the agent's measurements; tablet/mobile pixel match is
// looser because responsive reflow against per-viewport extractions is a
// follow-up. The desktop ceiling at 0.96 reflects what's reachable
// without literally embedding source screenshots - beyond that, residual
// mismatch is anti-aliasing on text and sub-pixel positioning of
// rotated-image edges.
const TARGETS = { desktop: 0.96, tablet: 0.82, mobile: 0.8 };

(ENABLED ? describe : describe.skip)("fidelity gate (live)", () => {
  it(`rebuilds ${SOURCE_URL} above per-viewport thresholds without cheating`, async () => {
    const outputWorkspace = await makeTestDir(path.join(os.tmpdir(), "wcm-fidelity-out-"));
    const outDir = path.join(outputWorkspace, "project");
    const stateDir = await makeTestDir(path.join(os.tmpdir(), "wcm-fidelity-state-"));

    let result;
    let installed = false;
    try {
      // runAgent enforces integrity invariants internally and throws if any
      // fail (no inline base64, no source-domain leakage, asset references
      // resolve, distinctive phrases present, hero band has media, no
      // transform double-translation, image coverage). When this resolves
      // without throwing, those guarantees hold.
      result = await runAgent({
        url: SOURCE_URL,
        outDir,
        mode: "hybrid",
        maxIterations: 4,
        env: { ...process.env, WEBSITE_COPY_STATE_DIR: stateDir },
        runGenerated: async (projectDir) => {
          if (!installed) {
            const { execSync } = await import("node:child_process");
            execSync(`pnpm install --silent`, { cwd: projectDir, stdio: "inherit" });
            installed = true;
          }
          const handle = await runGeneratedSite({ projectDir, port: 3217 });
          return { url: handle.url, dispose: handle.dispose };
        },
      });

      // 1. Per-viewport similarity targets.
      expect(result.finalQa).not.toBeNull();
      const byViewport = Object.fromEntries(
        result.finalQa!.results.map((r) => [r.viewport, r.similarity]),
      ) as Record<string, number>;
      const failedViewports: string[] = [];
      for (const [vp, target] of Object.entries(TARGETS)) {
        const got = byViewport[vp] ?? 0;
        if (got < target) failedViewports.push(`${vp}: ${got.toFixed(3)} < ${target}`);
      }

      // 2. Multi-page: at least the root + one subpage must exist as
      // separate `app/<route>/page.tsx` files.
      const violations: string[] = [];
      const rootPage = path.join(outDir, "app", "page.tsx");
      if (!(await fileExists(rootPage))) violations.push("app/page.tsx is missing.");
      const subpages = await collectSubpages(outDir);
      if (subpages.length === 0) {
        violations.push("Multi-page crawl produced zero subpages.");
      }

      if (failedViewports.length > 0 || violations.length > 0) {
        const detailLines: string[] = [];
        if (failedViewports.length > 0) {
          detailLines.push("Per-viewport thresholds not met:");
          detailLines.push(...failedViewports.map((s) => `  - ${s}`));
          detailLines.push("");
          for (const vp of failedViewports.map((v) => v.split(":")[0]!.trim())) {
            const regionPath = path.join(
              stateDir,
              result.runId,
              "reports",
              `region-report-${vp}.json`,
            );
            try {
              const region = JSON.parse(await fs.readFile(regionPath, "utf8"));
              const worst = [...region.yBands].sort((a, b) => a.similarity - b.similarity)[0];
              detailLines.push(
                `  ${vp} worst Y-band: y=${worst.yStart}..${worst.yEnd}, similarity=${worst.similarity.toFixed(3)}`,
              );
              const hotZones = (
                region.hotZones as Array<{
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  mismatchedPixels: number;
                }>
              ).slice(0, 3);
              for (const z of hotZones) {
                detailLines.push(
                  `    hot-zone: (${z.x},${z.y}) ${z.width}x${z.height}, ${z.mismatchedPixels}px mismatched`,
                );
              }
              detailLines.push(
                `  ${vp} overlay: ${path.join(stateDir, result.runId, "screenshots", `diff-${vp}-iter${result.iterations}.png`)}`,
              );
            } catch {
              detailLines.push(`  ${vp} region report not found at ${regionPath}`);
            }
          }
        }
        if (violations.length > 0) {
          detailLines.push("");
          detailLines.push("Structural violations:");
          detailLines.push(...violations.map((s) => `  - ${s}`));
        }
        throw new Error("\n" + detailLines.join("\n"));
      }
    } finally {
      await removeTestDir(outputWorkspace);
      await removeTestDir(stateDir);
    }
  }, 1_200_000); // 20 minute ceiling
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function collectSubpages(outDir: string): Promise<readonly string[]> {
  const subpages: string[] = [];
  const appDir = path.join(outDir, "app");
  const walk = async (dir: string, relPath: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const nextRel = relPath ? `${relPath}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, nextRel);
      } else if (e.name === "page.tsx" && relPath !== "") {
        subpages.push(relPath);
      }
    }
  };
  await walk(appDir, "");
  return subpages;
}
