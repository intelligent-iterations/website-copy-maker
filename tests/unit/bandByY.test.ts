import { describe, expect, it } from "vitest";
import { bandByY, groupSections } from "../../src/normalize/groupSections.js";
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
  rect: { x: 0, y: 0, width: 1200, height: 100 },
  style: {},
  layout: { mode: "absolute" },
  metadata: baseMeta,
  children: [],
  ...overrides,
});

const wrapper = (children: DesignNode[]): DesignNode =>
  node({
    id: "root",
    type: "container",
    name: "root",
    rect: { x: 0, y: 0, width: 1440, height: 4000 },
    layout: { mode: "normal" },
    children,
  });

describe("bandByY", () => {
  it("clusters absolute children at distinct Y bands", () => {
    const root = wrapper([
      node({ id: "a", rect: { x: 0, y: 0, width: 1440, height: 200 } }),
      node({ id: "b", rect: { x: 100, y: 100, width: 200, height: 90 } }), // overlaps a
      node({ id: "c", rect: { x: 0, y: 400, width: 1440, height: 300 } }), // new band
      node({ id: "d", rect: { x: 0, y: 1000, width: 1440, height: 200 } }), // new band
    ]);
    const bands = bandByY(root);
    expect(bands.length).toBe(3);
    expect(bands[0]!.children.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(bands[1]!.children.map((c) => c.id)).toEqual(["c"]);
    expect(bands[2]!.children.map((c) => c.id)).toEqual(["d"]);
  });

  it("respects tolerance: bands within tolerancePx merge", () => {
    const root = wrapper([
      node({ id: "a", rect: { x: 0, y: 0, width: 1440, height: 200 } }),
      // y=210 is within tolerancePx=24 of bottom=200 -> same band
      node({ id: "b", rect: { x: 0, y: 210, width: 1440, height: 100 } }),
      // y=400 is far below 310+24 -> new band
      node({ id: "c", rect: { x: 0, y: 400, width: 1440, height: 200 } }),
    ]);
    const bands = bandByY(root, 24);
    expect(bands.length).toBe(2);
    expect(bands[0]!.children.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("synthesizes section DesignNodes with union rects", () => {
    const root = wrapper([
      node({ id: "a", rect: { x: 100, y: 50, width: 400, height: 200 } }),
      node({ id: "b", rect: { x: 800, y: 100, width: 400, height: 100 } }),
    ]);
    const bands = bandByY(root);
    expect(bands.length).toBe(1);
    const band = bands[0]!;
    expect(band.type).toBe("section");
    // Union rect: x=100, y=50, right=1200, bottom=250
    expect(band.rect.x).toBe(100);
    expect(band.rect.y).toBe(50);
    expect(band.rect.width).toBe(1100);
    expect(band.rect.height).toBe(200);
    expect(band.children.length).toBe(2);
  });

  it("filters out 0-height children", () => {
    const root = wrapper([
      node({ id: "a", rect: { x: 0, y: 0, width: 1440, height: 200 } }),
      node({ id: "ghost", rect: { x: 0, y: 250, width: 1440, height: 0 } }),
      node({ id: "c", rect: { x: 0, y: 400, width: 1440, height: 200 } }),
    ]);
    const bands = bandByY(root);
    expect(bands.length).toBe(2);
    const ids = bands.flatMap((b) => b.children.map((c) => c.id));
    expect(ids).not.toContain("ghost");
  });
});

describe("groupSections triggers bandByY for absolute canvases", () => {
  it("a single absolute wrapper produces multiple structural sections", () => {
    const canvas = node({
      id: "canvas",
      type: "container",
      name: "canvas",
      rect: { x: 0, y: 0, width: 1440, height: 4000 },
      layout: { mode: "normal" },
      children: [
        node({
          id: "a",
          layout: { mode: "absolute" },
          rect: { x: 0, y: 0, width: 1440, height: 200 },
        }),
        node({
          id: "b",
          layout: { mode: "absolute" },
          rect: { x: 0, y: 400, width: 1440, height: 300 },
        }),
        node({
          id: "c",
          layout: { mode: "absolute" },
          rect: { x: 0, y: 900, width: 1440, height: 200 },
        }),
        node({
          id: "d",
          layout: { mode: "absolute" },
          rect: { x: 0, y: 1500, width: 1440, height: 250 },
        }),
      ],
    });
    const body = node({
      id: "body",
      type: "page",
      name: "body",
      rect: { x: 0, y: 0, width: 1440, height: 4000 },
      layout: { mode: "normal" },
      children: [canvas],
    });
    const sections = groupSections(body);
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });
});
