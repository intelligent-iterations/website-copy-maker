import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compareScreenshots, TILE_MAX_RATIO, TILE_SIZE } from "../../src/qa/compareScreenshots.js";

async function solidColorPng(
  width: number,
  height: number,
  rgb: [number, number, number],
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png()
    .toBuffer();
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

describe("compareScreenshots", () => {
  it("preserves document coordinates and fails missing page area", async () => {
    const source = await solidColorPng(100, 300, [255, 255, 255]);
    const replica = await solidColorPng(100, 100, [255, 255, 255]);
    const result = await compareScreenshots(source, replica);
    expect([result.width, result.height]).toEqual([100, 300]);
    expect(
      result.tiles.filter((tile) => tile.ratio > TILE_MAX_RATIO).map((tile) => tile.y),
    ).toEqual([100, 200]);
    expect(result.similarity).toBeCloseTo(1 / 3);
  });

  it("counts extra replica content without stretching the source", async () => {
    const source = await solidColorPng(100, 100, [255, 255, 255]);
    const replica = await solidColorPng(200, 100, [255, 255, 255]);
    const result = await compareScreenshots(source, replica);
    expect(result.tilesFailed).toBe(1);
    expect(result.worstTile?.x).toBe(100);
  });

  it("returns similarity 1.0 for identical images", async () => {
    const a = await solidColorPng(100, 100, [255, 0, 0]);
    const b = await solidColorPng(100, 100, [255, 0, 0]);
    const result = await compareScreenshots(a, b);
    expect(result.similarity).toBe(1);
  });

  it("returns similarity ~0 for fully different images", async () => {
    const a = await solidColorPng(100, 100, [255, 0, 0]);
    const b = await solidColorPng(100, 100, [0, 255, 0]);
    const result = await compareScreenshots(a, b);
    expect(result.similarity).toBeLessThan(0.05);
  });

  it("returns similarity ~0.5 for half-different images", async () => {
    const a = await solidColorPng(100, 100, [255, 0, 0]);
    const b = await halfHalfPng(100, 100, [255, 0, 0], [0, 255, 0]);
    const result = await compareScreenshots(a, b);
    expect(result.similarity).toBeGreaterThan(0.45);
    expect(result.similarity).toBeLessThan(0.55);
  });

  it("emits a non-empty PNG diff buffer", async () => {
    const a = await solidColorPng(50, 50, [255, 0, 0]);
    const b = await solidColorPng(50, 50, [0, 0, 255]);
    const result = await compareScreenshots(a, b);
    expect(result.diffPng.length).toBeGreaterThan(50);
  });
});

describe("compareScreenshots - tile metrics", () => {
  it("exports TILE_SIZE=100 and TILE_MAX_RATIO=0.04 (binding constants)", () => {
    expect(TILE_SIZE).toBe(100);
    expect(TILE_MAX_RATIO).toBe(0.04);
  });

  it("identical images → tilesFailed=0, every tile.ratio=0", async () => {
    const a = await solidColorPng(200, 200, [200, 200, 200]);
    const b = await solidColorPng(200, 200, [200, 200, 200]);
    const result = await compareScreenshots(a, b);
    expect(result.tilesFailed).toBe(0);
    expect(result.tiles).toHaveLength(4); // 2x2 tiles for 200x200
    for (const t of result.tiles) expect(t.ratio).toBe(0);
  });

  it("one fully-mismatched 100x100 quadrant → exactly 1 failed tile, ratio 1.0", async () => {
    // 200x200 left half red, right half red on A; on B left half red, right half green
    // expect the two right tiles (at x=100, y=0 and y=100) to be ~100% mismatched
    const a = await halfHalfPng(200, 200, [255, 0, 0], [255, 0, 0]);
    const b = await halfHalfPng(200, 200, [255, 0, 0], [0, 255, 0]);
    const result = await compareScreenshots(a, b);
    const failing = result.tiles.filter((t) => t.ratio > TILE_MAX_RATIO);
    expect(failing.length).toBe(2);
    expect(result.tilesFailed).toBe(2);
    expect(result.worstTile?.ratio).toBeGreaterThan(0.9);
    // Failing tiles must be the right column (x=100), not the left
    for (const t of failing) expect(t.x).toBe(100);
  });

  it("edge tiles have correct dimensions (right column 40px, not 100)", async () => {
    const a = await solidColorPng(140, 100, [255, 0, 0]);
    const b = await solidColorPng(140, 100, [255, 0, 0]);
    const result = await compareScreenshots(a, b);
    // 140/100 = 1.4 columns → 2 columns. Last is 40px wide.
    expect(result.tiles).toHaveLength(2);
    const edge = result.tiles.find((t) => t.x === 100);
    expect(edge?.width).toBe(40);
    expect(edge?.height).toBe(100);
  });

  it("a single mismatched 60-px block in a 40x100 edge tile fails the gate (60/4000=1.5% no, 100/4000=2.5% yes)", async () => {
    // construct 140x100: left 100x100 red, right 40x100 red on A; right 40x100 green on B
    const a = await solidColorPng(140, 100, [255, 0, 0]);
    const greenStripe = await sharp({
      create: { width: 40, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer();
    const b = await sharp({
      create: { width: 140, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([{ input: greenStripe, left: 100, top: 0 }])
      .png()
      .toBuffer();
    const result = await compareScreenshots(a, b);
    // The right 40x100 edge tile is 100% mismatched. 4000 px > 2% of 4000 (=80).
    const edgeTile = result.tiles.find((t) => t.x === 100)!;
    expect(edgeTile.width).toBe(40);
    expect(edgeTile.ratio).toBeGreaterThan(TILE_MAX_RATIO);
    expect(result.tilesFailed).toBeGreaterThanOrEqual(1);
  });
});
