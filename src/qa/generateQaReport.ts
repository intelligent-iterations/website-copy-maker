/**
 * Pure: turn per-page-per-viewport diagnoses into a QaReport.
 *
 * Pass/fail gate is **tile-based**. The page is divided into 100×100 px
 * tiles by `compareScreenshots`; a tile fails when more than 4% of its
 * pixels are mismatched (TILE_MAX_RATIO). The QaReport passes iff every
 * comparison reports `tilesFailed === 0`. No tile is exempt - image
 * owners, anti-aliasing, "unknown" diagnoses, all of it must come in
 * under 4% per tile.
 *
 * Region-based diagnoses (wrong-color / missing-element / position-shift
 * / etc.) and aggregate similarity are kept as **informational** signal:
 * they drive issue text and the patcher's structural mutations, but they
 * do NOT control pass/fail. The tile gate is non-bypassable; everything
 * else is advisory.
 */

import { TILE_MAX_RATIO, type TileResult } from "./compareScreenshots.js";
import type { ThresholdMap, ViewportName } from "../agent/thresholds.js";
import type { QaIssue, QaReport, QaResult, RegionResult } from "./types.js";

export type ViewportComparison = {
  readonly viewport: ViewportName;
  readonly route: string;
  readonly similarity: number;
  readonly mismatchImagePath: string | null;
  readonly regions: readonly RegionResult[];
  readonly tiles: readonly TileResult[];
  readonly tilesFailed: number;
};

const MIN_MATERIAL_REGION_PIXELS = 2500;
/** Region size above which an "unknown" diagnosis is surfaced as an
 * issue. Informational only - does not affect pass/fail. */
const UNKNOWN_REPORTED_MIN_PIXELS = 12000;

export function generateQaReport(args: {
  readonly iteration: number;
  readonly comparisons: readonly ViewportComparison[];
  readonly targets: ThresholdMap;
}): QaReport {
  const results: QaResult[] = args.comparisons.map((c) => ({
    viewport: c.viewport,
    route: c.route,
    similarity: c.similarity,
    mismatchImagePath: c.mismatchImagePath,
    issues: deriveIssues(c, args.targets[c.viewport]),
    regions: c.regions,
    tiles: c.tiles,
    tilesFailed: c.tilesFailed,
  }));

  const viewportsTested = args.comparisons.map((c) => c.viewport) as ViewportName[];
  const similarityMet =
    viewportsTested.length > 0 &&
    args.comparisons.every((c) => c.similarity >= (args.targets[c.viewport] ?? 1));

  // The only gate. Every viewport-route must have zero tiles above the
  // 4% mismatch threshold. No exemptions.
  const meets = viewportsTested.length > 0 && args.comparisons.every((c) => c.tilesFailed === 0);

  return {
    iteration: args.iteration,
    results,
    meetsTargets: meets,
    similarityMet,
  };
}

/** Informational helper - surfaces whether a region looks materially
 * different. Does not gate the QA report; the tile gate does. */
export function isAcceptableRegion(r: RegionResult): boolean {
  if (r.region.mismatchedPixels < MIN_MATERIAL_REGION_PIXELS) return true;
  if (r.diagnosis.kind === "anti-aliasing") return true;
  if (r.diagnosis.kind === "unknown" && r.region.mismatchedPixels < UNKNOWN_REPORTED_MIN_PIXELS) {
    return true;
  }
  return false;
}

function deriveIssues(c: ViewportComparison, target: number): readonly QaIssue[] {
  const issues: QaIssue[] = [];

  // 1. Failing tiles - the load-bearing pass/fail signal. Each failing
  //    tile gets a separate issue with the owner of the largest region
  //    overlapping it (when one exists). The patcher uses the regions
  //    directly; tile issues are for human triage.
  for (const t of c.tiles) {
    if (t.ratio <= TILE_MAX_RATIO) continue;
    const owner = findOwnerForTile(t, c.regions);
    issues.push({
      severity: t.ratio > 0.1 ? "high" : "medium",
      description: `Tile (${t.x},${t.y}) ${t.width}x${t.height} on ${c.viewport}: ${(t.ratio * 100).toFixed(1)}% mismatch (${t.mismatched}px). Owner: ${owner ?? "unknown"}.`,
      suggestedFix: owner
        ? `Inspect ${owner} - pixel diff is concentrated here.`
        : "No DOM owner mapped; inspect diff PNG manually.",
    });
  }

  // 2. Region-driven issues - informational diagnoses by class
  //    (wrong-color / missing-element / etc.). The patcher consumes
  //    these via the regions array directly.
  for (const r of c.regions) {
    if (isAcceptableRegion(r)) continue;
    issues.push(regionToIssue(r, c.viewport));
  }

  // 3. Aggregate similarity - informational, only surfaced when the
  //    tile gate is otherwise clean (helps spot whole-page-blank cases
  //    that somehow pass the per-tile gate, e.g. uniform-color shells).
  const gap = target - c.similarity;
  if (gap > 0 && c.tilesFailed === 0) {
    const severity: QaIssue["severity"] = gap > 0.15 ? "high" : gap > 0.05 ? "medium" : "low";
    issues.push({
      severity,
      description: `Aggregate similarity ${c.similarity.toFixed(3)} below ${target.toFixed(2)} target on ${c.viewport} despite zero tile failures (informational).`,
      suggestedFix:
        "Inspect diff PNG; this means many sub-4%-per-tile differences spread across the page.",
    });
  }
  return issues;
}

function findOwnerForTile(t: TileResult, regions: readonly RegionResult[]): string | null {
  let best: { region: RegionResult; overlap: number } | null = null;
  const tx2 = t.x + t.width;
  const ty2 = t.y + t.height;
  for (const r of regions) {
    const rx2 = r.region.x + r.region.width;
    const ry2 = r.region.y + r.region.height;
    const ow = Math.max(0, Math.min(tx2, rx2) - Math.max(t.x, r.region.x));
    const oh = Math.max(0, Math.min(ty2, ry2) - Math.max(t.y, r.region.y));
    const overlap = ow * oh;
    if (overlap > 0 && (best === null || overlap > best.overlap)) {
      best = { region: r, overlap };
    }
  }
  return best && best.region.ownerLabel !== "unknown" ? best.region.ownerLabel : null;
}

function regionToIssue(r: RegionResult, viewport: ViewportName): QaIssue {
  const where = `(${r.region.x},${r.region.y}) ${r.region.width}x${r.region.height} on ${viewport}`;
  switch (r.diagnosis.kind) {
    case "wrong-color":
      return {
        severity: "high",
        description: `Wrong color at ${where}: expected rgb(${r.diagnosis.expected.r},${r.diagnosis.expected.g},${r.diagnosis.expected.b}), got rgb(${r.diagnosis.actual.r},${r.diagnosis.actual.g},${r.diagnosis.actual.b}). Owner: ${r.ownerLabel}.`,
        suggestedFix: `Set backgroundColor / color on ${r.ownerLabel} to the source value.`,
      };
    case "missing-element":
      return {
        severity: "high",
        description: `Missing element at ${where}. Owner: ${r.ownerLabel}.`,
        suggestedFix: `Re-emit the source element at this region; check whether visibility filter or leaf-detection dropped it.`,
      };
    case "extra-element":
      return {
        severity: "medium",
        description: `Extra element rendered at ${where}. Owner: ${r.ownerLabel}.`,
        suggestedFix: `Mark the rebuild's element as decorative or remove it from the design tree.`,
      };
    case "position-shift":
      return {
        severity: "medium",
        description: `Position offset by (${r.diagnosis.dx}, ${r.diagnosis.dy}) at ${where}. Owner: ${r.ownerLabel}.`,
        suggestedFix: `Shift the owner's rect or fix the transform that's translating it.`,
      };
    case "size-shift":
      return {
        severity: "medium",
        description: `Size scale ${r.diagnosis.scale.toFixed(2)} at ${where}. Owner: ${r.ownerLabel}.`,
        suggestedFix: `Adjust the owner's rect width/height - usually a viewport-anchor mismatch.`,
      };
    case "anti-aliasing":
      return {
        severity: "low",
        description: `Anti-aliasing residual at ${where}.`,
        suggestedFix: "No action - sub-pixel rasterization noise.",
      };
    case "unknown":
    default:
      return {
        severity: "medium",
        description: `Unrecognized mismatch at ${where}. Owner: ${r.ownerLabel}.`,
        suggestedFix:
          "Inspect manually: pixelmatch hot-zone exists but doesn't match a recognized class.",
      };
  }
}
