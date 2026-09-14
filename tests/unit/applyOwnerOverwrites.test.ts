import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyOwnerOverwrites, collectFailingTiles } from "../../src/patch/applyOwnerOverwrites.js";
import type { TileResult } from "../../src/qa/compareScreenshots.js";
import type { DesignNode } from "../../src/normalize/types.js";
import type { ProjectModel, ProjectPage } from "../../src/generate/createProject.js";

function leafNode(opts: {
  id: string;
  type: DesignNode["type"];
  rect: { x: number; y: number; width: number; height: number };
  style?: Partial<DesignNode["style"]>;
  text?: string;
}): DesignNode {
  return {
    id: opts.id,
    type: opts.type,
    name: opts.id,
    rect: opts.rect,
    style: { ...(opts.style as DesignNode["style"]) },
    layout: {},
    metadata: {
      isLikelyDecorative: false,
      isLikelyHeading: false,
      isLikelyParagraph: false,
      isLikelyButton: false,
      isLikelyCard: false,
      isLikelyNav: false,
      visualImportance: 5,
    },
    children: [],
    ...(opts.text !== undefined ? { text: opts.text } : {}),
  };
}

async function halfHalfPng(
  width: number,
  height: number,
  left: [number, number, number],
  right: [number, number, number],
): Promise<Buffer> {
  const leftBuf = await sharp({
    create: {
      width: width / 2,
      height,
      channels: 3,
      background: { r: left[0], g: left[1], b: left[2] },
    },
  })
    .png()
    .toBuffer();
  const rightBuf = await sharp({
    create: {
      width: width / 2,
      height,
      channels: 3,
      background: { r: right[0], g: right[1], b: right[2] },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: leftBuf, left: 0, top: 0 },
      { input: rightBuf, left: width / 2, top: 0 },
    ])
    .png()
    .toBuffer();
}

function makeModel(rebuildRoot: DesignNode, sourceRoot: DesignNode): ProjectModel {
  const page: ProjectPage = {
    routePath: "",
    url: "",
    metadata: {
      title: null,
      description: null,
      ogImage: null,
      ogTitle: null,
      favicon: null,
      themeColor: null,
    },
    sections: [],
    root: rebuildRoot,
    rootsByViewport: { desktop: rebuildRoot, tablet: rebuildRoot, mobile: rebuildRoot },
    sourceRootsByViewport: {
      desktop: sourceRoot,
      tablet: sourceRoot,
      mobile: sourceRoot,
    },
  };
  return {
    siteName: "test",
    sourceUrl: "",
    mode: "exact",
    metadata: page.metadata,
    tokens: {
      colors: { page: "#fff", ink: "#000", muted: "#888", accent: "#f00", all: [] },
      fontFamilies: [],
      maxContentWidth: 1200,
      radii: [],
      shadows: [],
    },
    sections: [],
    root: rebuildRoot,
    assetMap: new Map(),
    pages: [page],
  };
}

describe("applyOwnerOverwrites", () => {
  it("samples source mean color in failing tile, sets backgroundColor on container owner", async () => {
    // 200x100 source: red left half, blue right half.
    const sourceBuf = await halfHalfPng(200, 100, [255, 0, 0], [0, 0, 255]);
    // Rebuild has one container at (0,0,100,100) (the red half region) but
    // styled wrong - green.
    const rebuildOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { backgroundColor: "rgb(0, 255, 0)" },
    });
    const sourceOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { backgroundColor: "rgb(255, 0, 0)" },
    });
    const model = makeModel(rebuildOwner, sourceOwner);
    const failingTile: TileResult = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mismatched: 10000,
      ratio: 1.0,
    };
    const out = await applyOwnerOverwrites({
      model,
      failingTilesByPageViewport: { "::desktop": [failingTile] },
      sourceBuffersByPageViewport: { "::desktop": sourceBuf },
    });
    const patched = out.pages[0]!.rootsByViewport!.desktop!;
    // Mean of the red-tile area should be ~(255,0,0).
    expect(patched.style.backgroundColor).toMatch(/^rgb\(25[0-5], 0, 0\)$/);
  });

  it("sets `color` on text owner instead of backgroundColor", async () => {
    const sourceBuf = await halfHalfPng(200, 100, [10, 20, 30], [200, 200, 200]);
    const rebuildOwner = leafNode({
      id: "n1",
      type: "text",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { color: "rgb(255, 255, 255)" },
      text: "hello",
    });
    const sourceOwner = leafNode({
      id: "n1",
      type: "text",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { color: "rgb(10, 20, 30)" },
      text: "hello",
    });
    const model = makeModel(rebuildOwner, sourceOwner);
    const failingTile: TileResult = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mismatched: 10000,
      ratio: 1.0,
    };
    const out = await applyOwnerOverwrites({
      model,
      failingTilesByPageViewport: { "::desktop": [failingTile] },
      sourceBuffersByPageViewport: { "::desktop": sourceBuf },
    });
    const patched = out.pages[0]!.rootsByViewport!.desktop!;
    expect(patched.style.color).toBe("rgb(10, 20, 30)");
    // backgroundColor must NOT be set on a text owner (would override text rendering).
    expect(patched.style.backgroundColor).toBeUndefined();
  });

  it("returns the model by reference identity when there are no failing tiles", async () => {
    const sourceBuf = await halfHalfPng(200, 100, [255, 0, 0], [0, 0, 255]);
    const rebuildOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { backgroundColor: "rgb(0, 255, 0)" },
    });
    const sourceOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style: { backgroundColor: "rgb(255, 0, 0)" },
    });
    const model = makeModel(rebuildOwner, sourceOwner);
    const out = await applyOwnerOverwrites({
      model,
      failingTilesByPageViewport: {},
      sourceBuffersByPageViewport: { "::desktop": sourceBuf },
    });
    expect(out).toBe(model);
  });

  it("resets owner rect from pristine source tree (undoing prior diagnose-patcher drift)", async () => {
    const sourceBuf = await halfHalfPng(200, 100, [50, 60, 70], [200, 200, 200]);
    // Pretend the diagnose patcher previously shifted n1's rect off
    // the failing tile. Owner-overwrite must reset it from source so
    // the rect can't "lock" the owner out of future hits.
    const rebuildOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 30, y: 10, width: 90, height: 80 }, // drifted
      style: { backgroundColor: "rgb(0, 255, 0)" },
    });
    const sourceOwner = leafNode({
      id: "n1",
      type: "container",
      rect: { x: 0, y: 0, width: 100, height: 100 }, // pristine
      style: { backgroundColor: "rgb(50, 60, 70)" },
    });
    const model = makeModel(rebuildOwner, sourceOwner);
    const failingTile: TileResult = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mismatched: 10000,
      ratio: 1.0,
    };
    const out = await applyOwnerOverwrites({
      model,
      failingTilesByPageViewport: { "::desktop": [failingTile] },
      sourceBuffersByPageViewport: { "::desktop": sourceBuf },
    });
    const patched = out.pages[0]!.rootsByViewport!.desktop!;
    expect(patched.rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("collectFailingTiles", () => {
  it("filters tiles above the threshold and groups by route::viewport", () => {
    const t = (ratio: number): TileResult => ({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mismatched: 0,
      ratio,
    });
    const out = collectFailingTiles(
      [
        { route: "", viewport: "desktop", tiles: [t(0.01), t(0.05), t(0.001)] },
        { route: "blog", viewport: "mobile", tiles: [t(0.0)] }, // all pass
        { route: "contact", viewport: "tablet", tiles: [t(0.03)] },
      ],
      0.02,
    );
    expect(Object.keys(out).sort()).toEqual(["::desktop", "contact::tablet"]);
    expect(out["::desktop"]!.length).toBe(1);
    expect(out["contact::tablet"]!.length).toBe(1);
  });

  it("excludes route-viewport pairs where every tile is below the threshold", () => {
    const t = (ratio: number): TileResult => ({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mismatched: 0,
      ratio,
    });
    const out = collectFailingTiles(
      [{ route: "", viewport: "desktop", tiles: [t(0.0), t(0.02)] }],
      0.02,
    );
    expect(out).toEqual({});
  });
});
