import { describe, expect, it } from "vitest";
import { clusterColors, parseColor, toHex } from "../../src/utils/colors.js";

describe("parseColor", () => {
  it("parses #rgb shorthand", () => {
    expect(parseColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  it("parses #rrggbb", () => {
    expect(parseColor("#112233")).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 1 });
  });

  it("parses #rrggbbaa", () => {
    const c = parseColor("#11223380");
    expect(c).not.toBeNull();
    expect(c!.a).toBeCloseTo(0x80 / 255, 4);
  });

  it("parses rgb()", () => {
    expect(parseColor("rgb(255, 0, 128)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it("parses rgba()", () => {
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it("treats transparent as fully clear", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null on garbage", () => {
    expect(parseColor("not-a-color")).toBeNull();
    expect(parseColor("currentColor")).toBeNull();
  });
});

describe("toHex", () => {
  it("emits #rrggbb when alpha is 1", () => {
    expect(toHex({ r: 0x11, g: 0x22, b: 0x33, a: 1 })).toBe("#112233");
  });

  it("emits #rrggbbaa when alpha < 1", () => {
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toMatch(/^#000000[0-9a-f]{2}$/);
  });

  it("clamps out-of-range channels", () => {
    expect(toHex({ r: 999, g: -10, b: 128, a: 1 })).toBe("#ff0080");
  });
});

describe("clusterColors", () => {
  it("groups near-duplicate colors and orders by frequency", () => {
    const out = clusterColors([
      "#111111",
      "rgb(17, 17, 17)", // identical
      "#112", // slightly different
      "#fafafa",
      "rgba(250, 250, 250, 1)", // identical
      "rgba(0,0,0,0)", // skipped (alpha 0)
    ]);
    // most frequent first
    expect(out[0]).toBe("#111111");
    expect(out).toContain("#fafafa");
  });

  it("ignores unparseable values", () => {
    expect(clusterColors(["rubbish", "currentColor"])).toEqual([]);
  });

  it("ignores fully transparent colors", () => {
    expect(clusterColors(["transparent", "rgba(0,0,0,0)"])).toEqual([]);
  });
});
