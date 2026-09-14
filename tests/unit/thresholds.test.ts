import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODE,
  DEFAULT_TARGETS,
  DEFAULT_VIEWPORTS,
  isMode,
  isViewportName,
  meetsTargets,
} from "../../src/agent/thresholds.js";

describe("defaults", () => {
  it("has the three required viewports", () => {
    expect(DEFAULT_VIEWPORTS.map((v) => v.name)).toEqual(["mobile", "tablet", "desktop"]);
  });
  it("has the contractual target thresholds", () => {
    expect(DEFAULT_TARGETS).toEqual({ mobile: 0.9, tablet: 0.92, desktop: 0.95 });
  });
  it("responsive is the default mode (per-viewport reflow with scaling-shell fallback)", () => {
    expect(DEFAULT_MODE).toBe("responsive");
  });
  it("default max iterations is 6", () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(6);
  });
});

describe("isMode", () => {
  it("accepts all four modes", () => {
    expect(isMode("responsive")).toBe(true);
    expect(isMode("hybrid")).toBe(true);
    expect(isMode("semantic")).toBe(true);
    expect(isMode("exact")).toBe(true);
  });
  it("rejects unknown values", () => {
    expect(isMode("magic")).toBe(false);
    expect(isMode("")).toBe(false);
  });
});

describe("isViewportName", () => {
  it("accepts the three viewport names", () => {
    expect(isViewportName("mobile")).toBe(true);
    expect(isViewportName("tablet")).toBe(true);
    expect(isViewportName("desktop")).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isViewportName("watch")).toBe(false);
  });
});

describe("meetsTargets", () => {
  it("true when every viewport ≥ target", () => {
    expect(meetsTargets({ mobile: 0.91, tablet: 0.92, desktop: 0.96 })).toBe(true);
  });
  it("false when any viewport below target", () => {
    expect(meetsTargets({ mobile: 0.89, tablet: 0.92, desktop: 0.96 })).toBe(false);
  });
  it("false when a viewport is missing", () => {
    expect(meetsTargets({ mobile: 0.95, tablet: 0.95 } as never)).toBe(false);
  });
});
