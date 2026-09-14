/**
 * One iteration of the visual-QA loop. Effects: screenshot capture, diff PNG
 * write, qa-report.json + region-report-<viewport>.json writes. Cleanup of
 * any spawned `next dev` is the caller's responsibility.
 *
 * Now drives per-page-per-viewport: takes a list of `{ route, generatedUrl,
 * sourceRoot, originalsByViewport }` entries and produces one `QaResult`
 * per (route × viewport).
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { PNG } from "pngjs";
import type { Viewport, ViewportName, ThresholdMap } from "../agent/thresholds.js";
import { captureGeneratedScreenshots } from "./captureGeneratedScreenshots.js";
import { compareScreenshots } from "./compareScreenshots.js";
import { generateQaReport, type ViewportComparison } from "./generateQaReport.js";
import { buildRegionReport, type RegionReport } from "./regionReport.js";
import { cropRegion, diagnoseRegion } from "./diagnoseRegion.js";
import { findElementForRegion } from "./regionToElement.js";
import type { DesignNode } from "../normalize/types.js";
import type { QaReport, RegionResult } from "./types.js";
import type { RegionPatch } from "../patch/applyQaFixes.js";

export type QaPageInput = {
  /** Route path, "" for root, or e.g. "blog" / "blog/post-1". */
  readonly route: string;
  /** URL of the generated page on the dev server. */
  readonly generatedUrl: string;
  /** Source-side screenshots keyed by viewport name. */
  readonly originalsByViewport: Readonly<Record<string, Buffer>>;
  /** Per-viewport DesignNode roots (for owner lookup). Falls back to
   * `defaultRoot` when a particular viewport is missing. */
  readonly rootsByViewport?: Readonly<Record<string, DesignNode>>;
  /** Required when rootsByViewport is absent or partial. */
  readonly defaultRoot: DesignNode;
};

export type QaIterationInput = {
  readonly iteration: number;
  readonly viewports: readonly Viewport[];
  readonly screenshotsDir: string;
  readonly reportsDir: string;
  readonly targets: ThresholdMap;
  readonly pages: readonly QaPageInput[];
};

export type QaIterationResult = {
  readonly report: QaReport;
  readonly regionReportsByPageViewport: Readonly<Record<string, RegionReport>>;
  /** Patches keyed by `<route>::<viewport>` for direct consumption by
   * applyRegionPatches. */
  readonly patchesByPageViewport: Readonly<Record<string, readonly RegionPatch[]>>;
};

export async function runQaIteration(input: QaIterationInput): Promise<QaIterationResult> {
  await fs.mkdir(input.screenshotsDir, { recursive: true });
  await fs.mkdir(input.reportsDir, { recursive: true });

  const comparisons: ViewportComparison[] = [];
  const regionReportsByPageViewport: Record<string, RegionReport> = {};
  const patchesByPageViewport: Record<string, RegionPatch[]> = {};

  for (const page of input.pages) {
    const captured = await captureGeneratedScreenshots({
      url: page.generatedUrl,
      viewports: input.viewports,
      outDir: input.screenshotsDir,
      filenamePrefix: page.route ? `generated-${slugify(page.route)}` : "generated",
    });

    for (const c of captured) {
      const original = page.originalsByViewport[c.viewport.name];
      if (!original)
        throw new Error(`Missing reference screenshot: ${page.route}@${c.viewport.name}`);
      const cmp = await compareScreenshots(original, c.buffer);
      const slug = page.route ? slugify(page.route) + "-" : "";
      const diffPath = path.join(
        input.screenshotsDir,
        `diff-${slug}${c.viewport.name}-iter${input.iteration}.png`,
      );
      await fs.writeFile(diffPath, cmp.diffPng);

      const diffPng = PNG.sync.read(cmp.diffPng);
      const regionReport = buildRegionReport({
        diffData: diffPng.data,
        width: cmp.width,
        height: cmp.height,
        viewport: c.viewport.name as ViewportName,
      });
      const reportKey = `${page.route}::${c.viewport.name}`;
      regionReportsByPageViewport[reportKey] = regionReport;
      await fs.writeFile(
        path.join(
          input.reportsDir,
          `region-report-${slug}${c.viewport.name}-iter${input.iteration}.json`,
        ),
        JSON.stringify(regionReport, null, 2),
        "utf8",
      );

      // ── Per-region diagnosis + owner mapping ──────────────────────
      const ownerRoot = page.rootsByViewport?.[c.viewport.name] ?? page.defaultRoot;
      const regions: RegionResult[] = [];
      const patches: RegionPatch[] = [];
      for (const hot of regionReport.hotZones) {
        const sourceCrop = await cropRegion(original, hot);
        const rebuildCrop = await cropRegion(c.buffer, hot);
        let diagnosis = diagnoseRegion({ source: sourceCrop, rebuild: rebuildCrop });
        const ownerMatch = findElementForRegion(hot, ownerRoot);
        const ownerLabel = ownerMatch.node
          ? `${ownerMatch.node.type}#${ownerMatch.node.id}`
          : "unknown";
        const patchable = isPatchable(diagnosis.kind);
        regions.push({
          region: hot,
          diagnosis,
          ownerId: ownerMatch.node?.id ?? null,
          ownerLabel,
          patchable,
        });
        if (patchable && ownerMatch.node) {
          patches.push({ region: hot, diagnosis, ownerId: ownerMatch.node.id });
        }
      }
      patchesByPageViewport[reportKey] = patches;

      comparisons.push({
        route: page.route,
        viewport: c.viewport.name as ViewportName,
        similarity: cmp.similarity,
        mismatchImagePath: diffPath,
        regions,
        tiles: cmp.tiles,
        tilesFailed: cmp.tilesFailed,
      });
    }
  }

  const report = generateQaReport({
    iteration: input.iteration,
    comparisons,
    targets: input.targets,
  });

  await fs.writeFile(
    path.join(input.reportsDir, `qa-report-iter${input.iteration}.json`),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(input.reportsDir, `qa-report.json`),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  return { report, regionReportsByPageViewport, patchesByPageViewport };
}

function isPatchable(kind: string): boolean {
  return (
    kind === "wrong-color" ||
    kind === "position-shift" ||
    kind === "size-shift" ||
    kind === "extra-element"
    // missing-element is not patchable yet (needs source-tree injection helper).
  );
}

function slugify(route: string): string {
  return route.replace(/^\/+|\/+$/g, "").replace(/\//g, "_") || "root";
}
