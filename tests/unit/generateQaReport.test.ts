import { describe, expect, it } from "vitest";
import { generateQaReport, isAcceptableRegion } from "../../src/qa/generateQaReport.js";
import { DEFAULT_TARGETS } from "../../src/agent/thresholds.js";
import type { RegionResult, TileResult } from "../../src/qa/types.js";

const tile = (x: number, y: number, ratio: number, w = 100, h = 100): TileResult => ({
  x,
  y,
  width: w,
  height: h,
  mismatched: Math.round(ratio * w * h),
  ratio,
});

const cleanTiles = (): TileResult[] => [tile(0, 0, 0), tile(100, 0, 0)];

const cmp = (
  viewport: "mobile" | "tablet" | "desktop",
  similarity: number,
  regions: RegionResult[] = [],
  tiles: TileResult[] = cleanTiles(),
) => ({
  viewport,
  route: "",
  similarity,
  mismatchImagePath: null,
  regions,
  tiles,
  tilesFailed: tiles.filter((t) => t.ratio > 0.04).length,
});

describe("generateQaReport - tile gate", () => {
  it("passes when every viewport has zero failing tiles", () => {
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("mobile", 0.99), cmp("tablet", 0.99), cmp("desktop", 0.99)],
      targets: DEFAULT_TARGETS,
    });
    expect(r.meetsTargets).toBe(true);
    expect(r.similarityMet).toBe(true);
  });

  it("fails when ANY tile exceeds 4% mismatch - even if similarity is 0.99", () => {
    // The badge-missing case: similarity 0.99 (passes old 0.90 floor),
    // zero region issues, but one localized tile with > 4% mismatch.
    const tiles = [tile(0, 0, 0), tile(100, 0, 0.045)]; // 4.5% mismatch
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("desktop", 0.99, [], tiles)],
      targets: { mobile: 0.9, tablet: 0.92, desktop: 0.95 },
    });
    expect(r.meetsTargets).toBe(false);
    expect(r.results[0]!.issues.some((i) => /Tile \(100,0\)/.test(i.description))).toBe(true);
  });

  it("passes when every tile is at or below 4%", () => {
    const tiles = [tile(0, 0, 0.04), tile(100, 0, 0.038), tile(200, 0, 0)];
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("desktop", 0.97, [], tiles)],
      targets: { mobile: 0.9, tablet: 0.92, desktop: 0.95 },
    });
    expect(r.meetsTargets).toBe(true);
  });

  it("fails when a single viewport has a failing tile, even if others are clean", () => {
    const dirtyTiles = [tile(0, 0, 0.05)];
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("mobile", 0.99), cmp("tablet", 0.99), cmp("desktop", 0.99, [], dirtyTiles)],
      targets: DEFAULT_TARGETS,
    });
    expect(r.meetsTargets).toBe(false);
  });

  it("edge tiles use their actual dimensions, not 10000 - small thin tiles are not more lenient", () => {
    // 40-px-wide right-edge tile: 40*100 = 4000 px. 4% = 160 px max.
    // 200 mismatched px = 5% - must fail.
    const edgeTile: TileResult = {
      x: 1400,
      y: 0,
      width: 40,
      height: 100,
      mismatched: 200,
      ratio: 200 / 4000,
    };
    const tiles = [tile(0, 0, 0), edgeTile];
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("desktop", 0.99, [], tiles)],
      targets: DEFAULT_TARGETS,
    });
    expect(r.meetsTargets).toBe(false);
  });

  it("similarity is informational only - no longer gates", () => {
    // Similarity 0.2 (way below any old floor) but zero tile failures
    // (synthetic - wouldn't happen in practice but proves the gate
    // ignores similarity).
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("desktop", 0.2, [], cleanTiles())],
      targets: { mobile: 0.9, tablet: 0.92, desktop: 0.95 },
    });
    expect(r.similarityMet).toBe(false);
    expect(r.meetsTargets).toBe(true); // tile gate alone decides
  });

  it("region issues still surface for human triage but don't gate", () => {
    const region: RegionResult = {
      region: { x: 0, y: 0, width: 200, height: 200, mismatchedPixels: 30000, density: 0.8 },
      diagnosis: {
        kind: "wrong-color",
        expected: { r: 253, g: 234, b: 234 },
        actual: { r: 255, g: 255, b: 255 },
        deltaE: 30,
      },
      ownerId: null,
      ownerLabel: "unknown",
      patchable: true,
    };
    const r = generateQaReport({
      iteration: 1,
      comparisons: [cmp("desktop", 0.97, [region], cleanTiles())],
      targets: { mobile: 0.9, tablet: 0.92, desktop: 0.95 },
    });
    expect(r.meetsTargets).toBe(true); // gate is tile-only
    expect(r.results[0]!.issues.some((i) => /Wrong color/.test(i.description))).toBe(true);
  });

  it("ignores anti-aliasing as informational", () => {
    const aaRegion: RegionResult = {
      region: { x: 0, y: 0, width: 200, height: 30, mismatchedPixels: 800, density: 0.4 },
      diagnosis: { kind: "anti-aliasing", edgeRatio: 0.8 },
      ownerId: "x",
      ownerLabel: "text#x",
      patchable: false,
    };
    expect(isAcceptableRegion(aaRegion)).toBe(true);
  });
});
