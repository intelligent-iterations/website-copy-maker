import { describe, expect, it } from "vitest";
import { extractUrls, parseBox, parsePx, snapToToken } from "../../src/utils/css.js";

describe("parsePx", () => {
  it("returns the numeric pixel value", () => {
    expect(parsePx("16px")).toBe(16);
    expect(parsePx("1.5px")).toBeCloseTo(1.5);
    expect(parsePx("-8px")).toBe(-8);
  });

  it("handles raw numbers", () => {
    expect(parsePx("0")).toBe(0);
    expect(parsePx("12")).toBe(12);
  });

  it("returns null for non-pixel strings", () => {
    expect(parsePx("auto")).toBeNull();
    expect(parsePx("16em")).toBeNull();
    expect(parsePx(undefined)).toBeNull();
    expect(parsePx(null)).toBeNull();
  });
});

describe("parseBox", () => {
  it("parses 1-value shorthand", () => {
    expect(parseBox("8px")).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });
  it("parses 2-value shorthand", () => {
    expect(parseBox("8px 16px")).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
  });
  it("parses 3-value shorthand", () => {
    expect(parseBox("8px 16px 24px")).toEqual({ top: 8, right: 16, bottom: 24, left: 16 });
  });
  it("parses 4-value shorthand", () => {
    expect(parseBox("8px 16px 24px 32px")).toEqual({ top: 8, right: 16, bottom: 24, left: 32 });
  });
  it("returns null for mixed unparseable", () => {
    expect(parseBox("8px auto")).toBeNull();
    expect(parseBox("")).toBeNull();
    expect(parseBox(null)).toBeNull();
  });
});

describe("snapToToken", () => {
  it("snaps to closest within tolerance", () => {
    expect(snapToToken(15, [16, 24, 32], 2)).toBe(16);
  });
  it("returns input when no candidate is close enough", () => {
    expect(snapToToken(73, [64, 80], 1)).toBe(73);
  });
});

describe("extractUrls", () => {
  it("returns urls from background-image", () => {
    expect(extractUrls('url("https://x/a.png")')).toEqual(["https://x/a.png"]);
  });
  it("handles multiple stacked backgrounds", () => {
    expect(extractUrls(`linear-gradient(black, white), url('a.png'), url(b.png)`)).toEqual([
      "a.png",
      "b.png",
    ]);
  });
  it("returns empty for none/empty", () => {
    expect(extractUrls("none")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
  });
});
