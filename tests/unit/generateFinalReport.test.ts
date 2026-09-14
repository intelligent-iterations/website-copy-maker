import { describe, expect, it } from "vitest";
import { generateFinalReport } from "../../src/qa/generateFinalReport.js";
import type { DesignTokens } from "../../src/analyze/inferTokens.js";
import type { QaReport } from "../../src/qa/types.js";

const tokens: DesignTokens = {
  colors: { page: "#faf8f3", ink: "#111111", muted: "#6f6a62", accent: "#f76b4f", all: [] },
  fontFamilies: ["Inter"],
  maxContentWidth: 1184,
  radii: [],
  shadows: [],
};

const passingQa: QaReport = {
  iteration: 1,
  meetsTargets: true,
  similarityMet: true,
  results: [
    {
      viewport: "desktop",
      route: "",
      similarity: 0.97,
      mismatchImagePath: null,
      issues: [],
      regions: [],
      tiles: [],
      tilesFailed: 0,
    },
    {
      viewport: "tablet",
      route: "",
      similarity: 0.94,
      mismatchImagePath: null,
      issues: [],
      regions: [],
      tiles: [],
      tilesFailed: 0,
    },
    {
      viewport: "mobile",
      route: "",
      similarity: 0.92,
      mismatchImagePath: null,
      issues: [],
      regions: [],
      tiles: [],
      tilesFailed: 0,
    },
  ],
};

describe("generateFinalReport", () => {
  it("includes the source URL, output dir, and inferred tokens", () => {
    const md = generateFinalReport({
      sourceUrl: "https://example.com",
      outDir: "/tmp/out",
      runId: "r1",
      mode: "hybrid",
      maxIterations: 6,
      iteration: 2,
      tokens,
      assets: [],
      failedAssets: [],
      qa: passingQa,
      integrity: null,
      generatedFiles: 18,
    });
    expect(md).toMatch(/https:\/\/example\.com/);
    expect(md).toMatch(/\/tmp\/out/);
    expect(md).toMatch(/#faf8f3/);
    expect(md).toMatch(/#f76b4f/);
    expect(md).toMatch(/Inter/);
    expect(md).toMatch(/pnpm dev/);
    expect(md).toMatch(/Meets visual targets: \*\*yes\*\*/);
  });

  it("renders QA scores when targets not met", () => {
    const md = generateFinalReport({
      sourceUrl: "https://x.test",
      outDir: "/o",
      runId: "r",
      mode: "hybrid",
      maxIterations: 6,
      iteration: 3,
      tokens,
      assets: [],
      failedAssets: [],
      qa: {
        iteration: 3,
        meetsTargets: false,
        similarityMet: false,
        results: [
          {
            viewport: "desktop",
            route: "",
            similarity: 0.91,
            mismatchImagePath: null,
            issues: [],
            regions: [],
            tiles: [],
            tilesFailed: 0,
          },
          {
            viewport: "tablet",
            route: "",
            similarity: 0.88,
            mismatchImagePath: null,
            issues: [],
            regions: [],
            tiles: [],
            tilesFailed: 0,
          },
          {
            viewport: "mobile",
            route: "",
            similarity: 0.86,
            mismatchImagePath: null,
            issues: [],
            regions: [],
            tiles: [],
            tilesFailed: 0,
          },
        ],
      },
      integrity: null,
      generatedFiles: 18,
    });
    expect(md).toMatch(/desktop \| 0\.910/);
    expect(md).toMatch(/Region gate not satisfied/);
    expect(md).toMatch(/Meets visual targets: \*\*no\*\*/);
  });

  it("renders the integrity invariant table when an integrity report is provided", () => {
    const md = generateFinalReport({
      sourceUrl: "https://x.test",
      outDir: "/o",
      runId: "r",
      mode: "hybrid",
      maxIterations: 6,
      iteration: 1,
      tokens,
      assets: [],
      failedAssets: [],
      qa: passingQa,
      integrity: {
        violations: [],
        invariants: [
          { name: "no-base64-rasters", passed: true },
          { name: "no-remote-asset-references", passed: true },
        ],
      },
      generatedFiles: 18,
    });
    expect(md).toMatch(/## Integrity invariants/);
    expect(md).toMatch(/no-base64-rasters \| ✓ pass/);
    expect(md).toMatch(/no-remote-asset-references \| ✓ pass/);
  });

  it("lists failed assets when present", () => {
    const md = generateFinalReport({
      sourceUrl: "https://x.test",
      outDir: "/o",
      runId: "r",
      mode: "hybrid",
      maxIterations: 6,
      iteration: 1,
      tokens,
      assets: [],
      failedAssets: [{ url: "https://x.test/lost.png", reason: "404" }],
      qa: passingQa,
      integrity: null,
      generatedFiles: 18,
    });
    expect(md).toMatch(/lost\.png/);
    expect(md).toMatch(/404/);
  });
});
