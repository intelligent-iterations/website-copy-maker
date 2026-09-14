import { describe, expect, it } from "vitest";
import { diagnoseRegion, type RegionCrop, type Rgb } from "../../src/qa/diagnoseRegion.js";

function solid(width: number, height: number, color: Rgb): RegionCrop {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function structured(width: number, height: number): RegionCrop {
  // High-contrast stripes - lots of luminance variance, saturated colors.
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const stripe = Math.floor(x / 8) % 2 === 0;
      data[i] = stripe ? 220 : 30;
      data[i + 1] = stripe ? 50 : 200;
      data[i + 2] = stripe ? 120 : 60;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function shifted(crop: RegionCrop, dx: number, dy: number, bg: Rgb): RegionCrop {
  const out = Buffer.alloc(crop.width * crop.height * 4);
  for (let i = 0; i < crop.width * crop.height; i++) {
    out[i * 4] = bg.r;
    out[i * 4 + 1] = bg.g;
    out[i * 4 + 2] = bg.b;
    out[i * 4 + 3] = 255;
  }
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sx >= crop.width || sy < 0 || sy >= crop.height) continue;
      const i = (sy * crop.width + sx) * 4;
      const j = (y * crop.width + x) * 4;
      out[j] = crop.data[i]!;
      out[j + 1] = crop.data[i + 1]!;
      out[j + 2] = crop.data[i + 2]!;
      out[j + 3] = 255;
    }
  }
  return { width: crop.width, height: crop.height, data: out };
}

describe("diagnoseRegion", () => {
  it("classifies wrong-color when both crops are uniform but different", () => {
    const source = solid(80, 80, { r: 253, g: 234, b: 234 });
    const rebuild = solid(80, 80, { r: 255, g: 255, b: 255 });
    const d = diagnoseRegion({ source, rebuild });
    expect(d.kind).toBe("wrong-color");
    if (d.kind === "wrong-color") {
      expect(d.expected).toEqual({ r: 253, g: 234, b: 234 });
      expect(d.actual).toEqual({ r: 255, g: 255, b: 255 });
      expect(d.deltaE).toBeGreaterThan(5);
    }
  });

  it("does not flag wrong-color when both crops are uniform AND close", () => {
    const source = solid(80, 80, { r: 250, g: 250, b: 250 });
    const rebuild = solid(80, 80, { r: 252, g: 252, b: 252 });
    const d = diagnoseRegion({ source, rebuild });
    expect(d.kind).toBe("anti-aliasing");
  });

  it("classifies missing-element when source has structure and rebuild is uniform bg", () => {
    const source = structured(100, 100);
    const rebuild = solid(100, 100, { r: 255, g: 255, b: 255 });
    const d = diagnoseRegion({ source, rebuild });
    expect(d.kind).toBe("missing-element");
  });

  it("classifies extra-element when rebuild has structure and source is uniform bg", () => {
    const source = solid(100, 100, { r: 255, g: 255, b: 255 });
    const rebuild = structured(100, 100);
    const d = diagnoseRegion({ source, rebuild });
    expect(d.kind).toBe("extra-element");
  });

  it("classifies position-shift when content is the same but offset", () => {
    const a = structured(80, 80);
    const b = shifted(a, 8, 4, { r: 255, g: 255, b: 255 });
    const d = diagnoseRegion({ source: a, rebuild: b });
    expect(d.kind).toBe("position-shift");
    if (d.kind === "position-shift") {
      expect(Math.abs(d.dx)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(d.dy)).toBeGreaterThanOrEqual(2);
    }
  });

  it("classifies anti-aliasing when both crops have similar structure with sub-pixel residual", () => {
    const a = structured(100, 100);
    // Slightly noised version of `a` (tiny per-pixel +/-3 random
    // shifts) - emulates AA / sub-pixel rasterization residuals.
    const b: RegionCrop = { width: a.width, height: a.height, data: Buffer.from(a.data) };
    for (let i = 0; i < b.data.length; i += 4) {
      const noise = Math.floor(Math.random() * 6) - 3;
      b.data[i] = Math.max(0, Math.min(255, b.data[i]! + noise));
      b.data[i + 1] = Math.max(0, Math.min(255, b.data[i + 1]! + noise));
      b.data[i + 2] = Math.max(0, Math.min(255, b.data[i + 2]! + noise));
    }
    const d = diagnoseRegion({ source: a, rebuild: b });
    expect(d.kind).toBe("anti-aliasing");
  });
});
