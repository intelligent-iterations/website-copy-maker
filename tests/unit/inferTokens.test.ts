import { describe, expect, it } from "vitest";
import { inferTokens } from "../../src/analyze/inferTokens.js";
import type { DesignNode } from "../../src/normalize/types.js";

const node = (overrides: Partial<DesignNode>): DesignNode => ({
  id: "x",
  type: "container",
  name: "wrapper",
  rect: { x: 0, y: 0, width: 1200, height: 100 },
  style: {},
  layout: { mode: "normal" },
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
  ...overrides,
});

describe("inferTokens", () => {
  it("picks the most-frequent background as page color", () => {
    const tree = node({
      style: { backgroundColor: "rgb(250, 248, 243)" },
      children: [
        node({ id: "1", style: { backgroundColor: "rgb(250, 248, 243)" } }),
        node({ id: "2", style: { backgroundColor: "rgb(255, 255, 255)" } }),
      ],
    });
    const tokens = inferTokens(tree);
    expect(tokens.colors.page.toLowerCase()).toBe("#faf8f3");
  });

  it("picks the most-frequent text color as ink", () => {
    const tree = node({
      style: { color: "rgb(17, 17, 17)" },
      children: [
        node({ id: "1", style: { color: "rgb(17, 17, 17)" } }),
        node({ id: "2", style: { color: "rgb(111, 106, 98)" } }),
      ],
    });
    const tokens = inferTokens(tree);
    expect(tokens.colors.ink.toLowerCase()).toBe("#111111");
    expect(tokens.colors.muted.toLowerCase()).toBe("#6f6a62");
  });

  it("collects font families ordered by frequency", () => {
    const tree = node({
      style: { fontFamily: '"Inter", sans-serif' },
      children: [
        node({ id: "1", style: { fontFamily: '"Inter", sans-serif' } }),
        node({ id: "2", style: { fontFamily: "Georgia, serif" } }),
      ],
    });
    const tokens = inferTokens(tree);
    expect(tokens.fontFamilies[0]).toBe("Inter");
  });

  it("derives maxContentWidth from observed wide elements", () => {
    const tree = node({
      rect: { x: 0, y: 0, width: 1200, height: 100 },
      children: [
        node({ id: "1", rect: { x: 0, y: 0, width: 1184, height: 100 } }),
        node({ id: "2", rect: { x: 0, y: 0, width: 800, height: 100 } }),
      ],
    });
    const tokens = inferTokens(tree);
    expect(tokens.maxContentWidth).toBeGreaterThanOrEqual(1184);
  });

  it("falls back to defaults when nothing is colored", () => {
    const tree = node({});
    const tokens = inferTokens(tree);
    expect(tokens.colors.page).toBe("#ffffff");
    expect(tokens.colors.ink).toBe("#111111");
  });
});
