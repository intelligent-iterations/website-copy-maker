import { describe, expect, it } from "vitest";
import {
  computeIoU,
  findElementForRegion,
  regionContainment,
} from "../../src/qa/regionToElement.js";
import type { DesignNode } from "../../src/normalize/types.js";

const baseMeta = {
  isLikelyHeading: false,
  isLikelyParagraph: false,
  isLikelyButton: false,
  isLikelyCard: false,
  isLikelyNav: false,
  isLikelyDecorative: false,
  visualImportance: 1,
};

const node = (overrides: Partial<DesignNode>): DesignNode => ({
  id: "x",
  type: "container",
  name: "x",
  rect: { x: 0, y: 0, width: 100, height: 100 },
  style: {},
  layout: { mode: "normal" },
  metadata: baseMeta,
  children: [],
  ...overrides,
});

describe("computeIoU", () => {
  it("returns 1 for identical boxes", () => {
    expect(
      computeIoU({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toBe(1);
  });

  it("returns 0 for disjoint boxes", () => {
    expect(
      computeIoU({ x: 0, y: 0, width: 50, height: 50 }, { x: 100, y: 100, width: 50, height: 50 }),
    ).toBe(0);
  });

  it("returns the right value for 50% overlap", () => {
    // a = 100x100 at (0,0), b = 100x100 at (50,0) → intersection 50x100=5000;
    // union = 10000 + 10000 - 5000 = 15000 → IoU = 1/3.
    const iou = computeIoU(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 100, height: 100 },
    );
    expect(iou).toBeCloseTo(1 / 3, 3);
  });
});

describe("regionContainment", () => {
  it("returns 1 when the rect fully contains the region", () => {
    expect(
      regionContainment(
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 50, y: 50, width: 100, height: 100 },
      ),
    ).toBe(1);
  });

  it("returns 0.5 when half of the region is inside the rect", () => {
    expect(
      regionContainment(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 0, width: 100, height: 100 },
      ),
    ).toBeCloseTo(0.5, 3);
  });
});

describe("findElementForRegion", () => {
  it("returns null when no node overlaps the region", () => {
    const root = node({ rect: { x: 0, y: 0, width: 100, height: 100 } });
    const m = findElementForRegion({ x: 500, y: 500, width: 50, height: 50 }, root);
    expect(m.node).toBeNull();
  });

  it("picks the most-specific leaf for a small region inside a big wrapper", () => {
    // Card wrapper 1000×400 with two leaves: image (400×400) and text
    // (400×200) inside it. A 50×50 region centered on the image should
    // map to the image leaf, not the wrapper.
    const wrapper = node({
      id: "wrap",
      rect: { x: 0, y: 0, width: 1000, height: 400 },
      children: [
        node({
          id: "img",
          type: "image",
          rect: { x: 0, y: 0, width: 400, height: 400 },
          metadata: { ...baseMeta, visualImportance: 5 },
        }),
        node({
          id: "txt",
          type: "text",
          rect: { x: 500, y: 50, width: 400, height: 200 },
          text: "hi",
          metadata: { ...baseMeta, visualImportance: 5 },
        }),
      ],
    });
    const m = findElementForRegion({ x: 100, y: 100, width: 50, height: 50 }, wrapper);
    expect(m.node?.id).toBe("img");
    expect(m.ancestors.map((a) => a.id)).toEqual(["wrap", "img"]);
  });

  it("picks the wrapper if the region spans both leaves equally", () => {
    // Region overlaps both leaves; wrapper has higher importance.
    const wrapper = node({
      id: "wrap",
      rect: { x: 0, y: 0, width: 1000, height: 400 },
      metadata: { ...baseMeta, visualImportance: 10 },
      children: [
        node({
          id: "left",
          type: "container",
          rect: { x: 0, y: 0, width: 500, height: 400 },
          metadata: { ...baseMeta, visualImportance: 1 },
        }),
        node({
          id: "right",
          type: "container",
          rect: { x: 500, y: 0, width: 500, height: 400 },
          metadata: { ...baseMeta, visualImportance: 1 },
        }),
      ],
    });
    const m = findElementForRegion({ x: 0, y: 0, width: 1000, height: 400 }, wrapper);
    expect(m.node?.id).toBe("wrap");
  });

  it("returns the ancestor chain so the patcher can reach wrappers", () => {
    const inner = node({
      id: "inner",
      type: "image",
      rect: { x: 100, y: 100, width: 100, height: 100 },
    });
    const middle = node({
      id: "middle",
      rect: { x: 50, y: 50, width: 200, height: 200 },
      children: [inner],
    });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 400, height: 400 },
      children: [middle],
    });
    const m = findElementForRegion({ x: 110, y: 110, width: 20, height: 20 }, root);
    expect(m.node?.id).toBe("inner");
    expect(m.ancestors.map((a) => a.id)).toEqual(["root", "middle", "inner"]);
  });
});
