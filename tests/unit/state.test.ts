import { describe, expect, it } from "vitest";
import { createRunState, withIteration, withSimilarities } from "../../src/agent/state.js";
import { DEFAULT_TARGETS, DEFAULT_VIEWPORTS } from "../../src/agent/thresholds.js";

const baseInputs = {
  url: "https://example.com",
  mode: "hybrid" as const,
  maxIterations: 6,
  viewports: DEFAULT_VIEWPORTS,
  targets: DEFAULT_TARGETS,
};

const basePaths = {
  outDir: "/out",
  stateDir: "/state",
  extractionDir: "/state/extraction",
  screenshotsDir: "/state/screenshots",
  assetsDir: "/state/assets",
  reportsDir: "/state/reports",
};

describe("createRunState", () => {
  it("starts at iteration 0 with no similarities", () => {
    const s = createRunState({
      meta: { runId: "r1", startedAt: "2026-04-27T00:00:00Z" },
      inputs: baseInputs,
      paths: basePaths,
    });
    expect(s.iteration).toBe(0);
    expect(s.similarities).toEqual({});
  });
});

describe("withIteration / withSimilarities", () => {
  const s = createRunState({
    meta: { runId: "r1", startedAt: "2026-04-27T00:00:00Z" },
    inputs: baseInputs,
    paths: basePaths,
  });

  it("withIteration is immutable", () => {
    const s2 = withIteration(s, 3);
    expect(s.iteration).toBe(0);
    expect(s2.iteration).toBe(3);
    expect(s2).not.toBe(s);
  });

  it("withSimilarities merges and is immutable", () => {
    const s2 = withSimilarities(s, { mobile: 0.9 });
    const s3 = withSimilarities(s2, { tablet: 0.92 });
    expect(s.similarities).toEqual({});
    expect(s2.similarities).toEqual({ mobile: 0.9 });
    expect(s3.similarities).toEqual({ mobile: 0.9, tablet: 0.92 });
  });
});
