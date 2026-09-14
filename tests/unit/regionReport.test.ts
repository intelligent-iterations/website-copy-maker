import { describe, expect, it } from "vitest";
import { buildRegionReport } from "../../src/qa/regionReport.js";

function blankRGBA(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function paintRect(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rgba: [number, number, number, number],
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
    }
  }
}

describe("buildRegionReport", () => {
  it("scores 1.0 on an all-zero mask", () => {
    const data = blankRGBA(100, 80);
    const r = buildRegionReport({ diffData: data, width: 100, height: 80, viewport: "desktop" });
    expect(r.overall.similarity).toBe(1);
    expect(r.overall.mismatchedPixels).toBe(0);
    expect(r.yBands.every((b) => b.label === "match")).toBe(true);
    expect(r.hotZones.length).toBe(0);
  });

  it("identifies a single hot zone in the middle of a mostly-clean image", () => {
    const data = blankRGBA(100, 80);
    paintRect(data, 100, 30, 30, 20, 20, [255, 0, 0, 255]); // 400px hot zone
    const r = buildRegionReport({ diffData: data, width: 100, height: 80, viewport: "desktop" });
    expect(r.overall.mismatchedPixels).toBe(400);
    expect(r.hotZones.length).toBe(1);
    expect(r.hotZones[0]!.x).toBe(30);
    expect(r.hotZones[0]!.y).toBe(30);
    expect(r.hotZones[0]!.width).toBe(20);
    expect(r.hotZones[0]!.height).toBe(20);
    expect(r.hotZones[0]!.mismatchedPixels).toBe(400);
    expect(r.hotZones[0]!.density).toBe(1);
  });

  it("Y-band similarity reflects vertical placement of mismatches", () => {
    const data = blankRGBA(100, 80);
    // Paint the top band severely red.
    paintRect(data, 100, 0, 0, 100, 10, [255, 0, 0, 255]); // first band ~ y0..10
    const r = buildRegionReport({ diffData: data, width: 100, height: 80, viewport: "desktop" });
    expect(r.yBands[0]!.label).toBe("severe");
    // Subsequent bands should match.
    for (const band of r.yBands.slice(1)) expect(band.label).toBe("match");
  });

  it("ranks hot zones by area * density", () => {
    const data = blankRGBA(200, 200);
    // Big sparse splash (lots of red, but in a mask with gaps)
    for (let y = 0; y < 50; y += 2) {
      for (let x = 0; x < 50; x += 2) paintRect(data, 200, x, y, 1, 1, [255, 0, 0, 255]);
    }
    // Small dense block
    paintRect(data, 200, 100, 100, 30, 30, [255, 0, 0, 255]); // 900 px, density 1.0
    const r = buildRegionReport({ diffData: data, width: 200, height: 200, viewport: "desktop" });
    expect(r.hotZones.length).toBeGreaterThanOrEqual(1);
    // Dense block should rank above sparse splash
    expect(r.hotZones[0]!.density).toBe(1);
  });

  it("ignores non-red pixels (anti-aliased gray, transparent) in the mask", () => {
    const data = blankRGBA(50, 50);
    paintRect(data, 50, 0, 0, 50, 50, [128, 128, 128, 64]); // gray semi-transparent
    const r = buildRegionReport({ diffData: data, width: 50, height: 50, viewport: "mobile" });
    expect(r.overall.mismatchedPixels).toBe(0);
  });
});
