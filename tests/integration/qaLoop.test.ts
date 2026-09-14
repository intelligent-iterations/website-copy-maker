import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
/**
 * Integration test for the visual QA loop. We don't actually boot `next dev`
 * - that's covered by the end-to-end workflow on the marketer runner. Here
 * we use the local-server fixture as the "generated site" and prove:
 *   - real Chromium captures real screenshots at multiple viewports
 *   - real pixelmatch returns the right similarity vs the original
 *   - runQaIteration writes qa-report.json and diff PNGs as promised
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runQaIteration } from "../../src/qa/qaLoop.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";
import { extractPage } from "../../src/extract/extractPage.js";
import { normalizeTree } from "../../src/normalize/normalizeTree.js";
import { DEFAULT_TARGETS } from "../../src/agent/thresholds.js";

const FIXTURE = path.join(__dirname, "..", "fixtures", "simple-site");
const VIEWPORTS = [
  { name: "mobile" as const, width: 390, height: 1200 },
  { name: "desktop" as const, width: 1440, height: 1600 },
];

let server: LocalServer;
let stateDir: string;

beforeAll(async () => {
  server = await startLocalServer(FIXTURE);
  stateDir = await makeTestDir(path.join(os.tmpdir(), "wcm-qa-"));
});

afterAll(async () => {
  if (server) await server.close();
  await removeTestDir(stateDir);
});

describe("QA loop (live)", () => {
  it("scores ~1.0 when generated and original are the same fixture", async () => {
    // Capture an "original" screenshot at each viewport.
    const originalsByViewport: Record<string, Buffer> = {};
    let designRoot;
    for (const vp of VIEWPORTS) {
      const { screenshot, page: extracted } = await extractPage({ url: server.url, viewport: vp });
      originalsByViewport[vp.name] = screenshot;
      if (vp.name === "desktop") designRoot = normalizeTree(extracted.root);
    }

    const { report, regionReportsByPageViewport } = await runQaIteration({
      iteration: 1,
      pages: [
        {
          route: "",
          generatedUrl: server.url, // same fixture serves as the "generated" site
          originalsByViewport,
          defaultRoot: designRoot!,
        },
      ],
      viewports: VIEWPORTS,
      screenshotsDir: path.join(stateDir, "screenshots"),
      reportsDir: path.join(stateDir, "reports"),
      targets: DEFAULT_TARGETS,
    });

    expect(report.results.length).toBe(VIEWPORTS.length);
    for (const r of report.results) {
      expect(r.similarity).toBeGreaterThan(0.95);
    }
    expect(report.meetsTargets).toBe(true);
    for (const vp of VIEWPORTS) {
      const region = regionReportsByPageViewport[`::${vp.name}`];
      expect(region).toBeTruthy();
      expect(region!.yBands.length).toBeGreaterThan(0);
    }

    const reportRaw = await fs.readFile(path.join(stateDir, "reports", "qa-report.json"), "utf8");
    const parsed = JSON.parse(reportRaw);
    expect(parsed.iteration).toBe(1);
    expect(Array.isArray(parsed.results)).toBe(true);

    for (const vp of VIEWPORTS) {
      const diffStat = await fs.stat(
        path.join(stateDir, "screenshots", `diff-${vp.name}-iter1.png`),
      );
      expect(diffStat.size).toBeGreaterThan(0);
    }
  }, 90_000);
});
