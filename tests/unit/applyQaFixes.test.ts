import { describe, expect, it } from "vitest";
import { applyQaFixes } from "../../src/patch/applyQaFixes.js";
import type { ProjectModel } from "../../src/generate/createProject.js";
import type { QaReport } from "../../src/qa/types.js";
import type { RegionReport } from "../../src/qa/regionReport.js";

const baseRoot = {
  id: "r",
  type: "page" as const,
  name: "page",
  rect: { x: 0, y: 0, width: 1200, height: 800 },
  style: {},
  layout: { mode: "normal" as const },
  metadata: {
    isLikelyHeading: false,
    isLikelyParagraph: false,
    isLikelyButton: false,
    isLikelyCard: false,
    isLikelyNav: false,
    isLikelyDecorative: false,
    visualImportance: 1,
  },
  children: [],
};

const baseMetadata = {
  title: "fixture",
  description: null,
  ogImage: null,
  ogTitle: null,
  favicon: null,
  themeColor: null,
};

const baseModel: ProjectModel = {
  siteName: "fixture",
  sourceUrl: "https://example.com",
  mode: "hybrid",
  metadata: baseMetadata,
  tokens: {
    colors: { page: "#fff", ink: "#000", muted: "#888", accent: "#f00", all: [] },
    fontFamilies: ["Inter"],
    maxContentWidth: 1200,
    radii: [],
    shadows: [],
  },
  sections: [],
  root: baseRoot,
  assetMap: new Map(),
  pages: [
    {
      routePath: "",
      url: "https://example.com",
      metadata: baseMetadata,
      sections: [],
      root: baseRoot,
    },
  ],
};

const failedReport = (similarity: number): QaReport => ({
  iteration: 1,
  results: [
    {
      viewport: "desktop",
      route: "",
      similarity,
      mismatchImagePath: null,
      issues: [],
      regions: [],
      tiles: [],
      tilesFailed: 0,
    },
  ],
  meetsTargets: false,
  similarityMet: false,
});

describe("applyQaFixes", () => {
  it("returns the model unchanged when targets are met", () => {
    const report: QaReport = { iteration: 1, results: [], meetsTargets: true, similarityMet: true };
    expect(applyQaFixes(baseModel, report, {}, 1)).toBe(baseModel);
  });

  it("nudges max content width down when similarity is moderately low", () => {
    const out = applyQaFixes(baseModel, failedReport(0.55), {}, 1);
    expect(out.tokens.maxContentWidth).toBeLessThan(baseModel.tokens.maxContentWidth);
  });

  it("nudges max content width up when similarity is severely low", () => {
    const out = applyQaFixes(baseModel, failedReport(0.2), {}, 1);
    expect(out.tokens.maxContentWidth).toBeGreaterThan(baseModel.tokens.maxContentWidth);
  });

  it("clamps content width to a sensible band", () => {
    const tiny: ProjectModel = {
      ...baseModel,
      tokens: { ...baseModel.tokens, maxContentWidth: 600 },
    };
    const out = applyQaFixes(tiny, failedReport(0.1), {}, 1);
    expect(out.tokens.maxContentWidth).toBeGreaterThanOrEqual(640);
  });

  it("re-picks page color from root background when it differs from current", () => {
    const skewed: ProjectModel = {
      ...baseModel,
      tokens: { ...baseModel.tokens, colors: { ...baseModel.tokens.colors, page: "#ffffff" } },
      root: { ...baseModel.root, style: { backgroundColor: "rgb(250, 248, 243)" } },
    };
    const out = applyQaFixes(skewed, failedReport(0.7), {}, 1);
    expect(out.tokens.colors.page).toBe("#faf8f3");
  });

  it("escalates to exact mode at iteration ≥ 3", () => {
    const out = applyQaFixes(baseModel, failedReport(0.6), {}, 3);
    expect(out.mode).toBe("exact");
  });

  it("nudges padding on sections that overlap the worst Y-band", () => {
    const sectionA = {
      kind: "generic" as const,
      index: 0,
      node: {
        ...baseRoot,
        id: "sa",
        rect: { x: 0, y: 0, width: 1440, height: 400 },
        layout: { mode: "normal" as const, padding: { top: 64, right: 0, bottom: 64, left: 0 } },
      },
    };
    const sectionB = {
      kind: "generic" as const,
      index: 1,
      node: {
        ...baseRoot,
        id: "sb",
        rect: { x: 0, y: 1200, width: 1440, height: 400 },
        layout: { mode: "normal" as const, padding: { top: 64, right: 0, bottom: 64, left: 0 } },
      },
    };
    const model: ProjectModel = {
      ...baseModel,
      sections: [sectionA, sectionB],
      pages: [{ ...baseModel.pages[0]!, sections: [sectionA, sectionB] }],
    };
    const region: RegionReport = {
      viewport: "desktop",
      width: 1440,
      height: 1600,
      overall: { similarity: 0.6, mismatchedPixels: 100000, totalPixels: 2304000 },
      yBands: Array.from({ length: 8 }, (_, i) => ({
        yStart: i * 200,
        yEnd: (i + 1) * 200,
        // Worst band is i=1 (y 200..400) which overlaps sectionA.
        similarity: i === 1 ? 0.4 : 0.99,
        mismatchedPixels: i === 1 ? 50000 : 0,
        label: (i === 1 ? "severe" : "match") as "severe" | "match",
      })),
      hotZones: [],
    };
    const out = applyQaFixes(model, failedReport(0.6), { desktop: region }, 2);
    // sectionA padding nudged down, sectionB unchanged.
    expect(out.sections[0]!.node.layout.padding!.top).toBe(56);
    expect(out.sections[0]!.node.layout.padding!.bottom).toBe(56);
    expect(out.sections[1]!.node.layout.padding!.top).toBe(64);
  });
});
