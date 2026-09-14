import { describe, expect, it } from "vitest";
import { applyRegionPatches, type RegionPatch } from "../../src/patch/applyQaFixes.js";
import type { ProjectModel, ProjectPage } from "../../src/generate/createProject.js";
import type { DesignNode } from "../../src/normalize/types.js";
import type { HotZone } from "../../src/qa/regionReport.js";

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

const region = (over: Partial<HotZone> = {}): HotZone => ({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  mismatchedPixels: 1000,
  density: 0.5,
  ...over,
});

function makeModel(root: DesignNode): ProjectModel {
  const page: ProjectPage = {
    routePath: "",
    url: "https://example.com",
    metadata: {
      title: null,
      description: null,
      ogImage: null,
      ogTitle: null,
      favicon: null,
      themeColor: null,
    },
    sections: [],
    root,
    rootsByViewport: { desktop: root, tablet: root, mobile: root },
  };
  return {
    siteName: "ex",
    sourceUrl: "https://example.com",
    mode: "exact",
    metadata: page.metadata,
    tokens: {
      colors: { page: "#fff", ink: "#000", muted: "#999", accent: "#abc", all: [] },
      fontFamilies: [],
      maxContentWidth: 1200,
      radii: [],
      shadows: [],
    },
    sections: [],
    root,
    assetMap: new Map(),
    pages: [page],
  };
}

describe("applyRegionPatches", () => {
  it("sets backgroundColor on the owning node when diagnosis is wrong-color", () => {
    const card = node({
      id: "card",
      rect: { x: 50, y: 50, width: 200, height: 200 },
      style: { backgroundColor: "rgb(255, 255, 255)" },
    });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 1440, height: 600 },
      children: [card],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region({ x: 50, y: 50, width: 200, height: 200 }),
        diagnosis: {
          kind: "wrong-color",
          expected: { r: 253, g: 234, b: 234 },
          actual: { r: 255, g: 255, b: 255 },
          deltaE: 30,
        },
        ownerId: "card",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "card");
    expect(patched?.style.backgroundColor).toBe("rgb(253, 234, 234)");
  });

  it("sets text color when the owner is a text node", () => {
    const text = node({
      id: "text",
      type: "text",
      text: "hi",
      rect: { x: 0, y: 0, width: 100, height: 30 },
      style: { color: "rgb(0, 0, 0)" },
    });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 200, height: 200 },
      children: [text],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region(),
        diagnosis: {
          kind: "wrong-color",
          expected: { r: 248, g: 79, b: 82 },
          actual: { r: 0, g: 0, b: 0 },
          deltaE: 50,
        },
        ownerId: "text",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "text");
    expect(patched?.style.color).toBe("rgb(248, 79, 82)");
  });

  it("shifts node rect when diagnosis is position-shift", () => {
    const target = node({
      id: "icon",
      rect: { x: 911, y: 4861, width: 56, height: 56 },
    });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 1440, height: 5132 },
      children: [target],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region(),
        diagnosis: { kind: "position-shift", dx: 204, dy: 0, correlation: 0.95 },
        ownerId: "icon",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "icon");
    expect(patched?.rect.x).toBe(707);
    expect(patched?.rect.y).toBe(4861);
  });

  it("scales rect when diagnosis is size-shift", () => {
    const target = node({ id: "img", rect: { x: 0, y: 0, width: 100, height: 100 } });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 200, height: 200 },
      children: [target],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region(),
        diagnosis: { kind: "size-shift", scale: 1.5, correlation: 0.9 },
        ownerId: "img",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "img");
    expect(patched?.rect.width).toBe(150);
    expect(patched?.rect.height).toBe(150);
  });

  it("marks an extra-element node as decorative so the renderer drops it", () => {
    const target = node({ id: "spurious", rect: { x: 0, y: 0, width: 50, height: 50 } });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 200, height: 200 },
      children: [target],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region(),
        diagnosis: {
          kind: "extra-element",
          rebuildMean: { r: 100, g: 200, b: 100 },
          rebuildStdDev: 30,
        },
        ownerId: "spurious",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "spurious");
    expect(patched?.metadata.isLikelyDecorative).toBe(true);
  });

  it("leaves anti-aliasing diagnoses as no-ops", () => {
    const target = node({ id: "edge", rect: { x: 0, y: 0, width: 100, height: 30 } });
    const root = node({
      id: "root",
      rect: { x: 0, y: 0, width: 200, height: 200 },
      children: [target],
    });
    const model = makeModel(root);
    const patches: RegionPatch[] = [
      {
        region: region(),
        diagnosis: { kind: "anti-aliasing", edgeRatio: 0.8 },
        ownerId: "edge",
      },
    ];
    const next = applyRegionPatches({
      model,
      patchesByPageViewport: { "::desktop": patches },
    });
    const patched = findById(next.pages[0]!.rootsByViewport!.desktop!, "edge");
    expect(patched).toEqual(target);
  });
});

function findById(n: DesignNode, id: string): DesignNode | null {
  if (n.id === id) return n;
  for (const c of n.children) {
    const f = findById(c, id);
    if (f) return f;
  }
  return null;
}
