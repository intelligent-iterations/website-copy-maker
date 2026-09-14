import { describe, expect, it } from "vitest";
import { localize, localizeBackgroundImage } from "../../src/generate/utils/localize.js";

const MAP: ReadonlyMap<string, string> = new Map([
  ["https://assets.example.test/x.png", "/assets/abc123-x.png"],
  ["https://cdn.example/y.webp", "/assets/def456-y.webp"],
]);

describe("localize", () => {
  it("returns local path when URL is mapped", () => {
    expect(localize("https://assets.example.test/x.png", MAP)).toBe("/assets/abc123-x.png");
  });
  it("returns input unchanged when URL is not mapped", () => {
    expect(localize("https://other.com/z.png", MAP)).toBe("https://other.com/z.png");
  });
  it("returns null for null/undefined/empty", () => {
    expect(localize(null, MAP)).toBeNull();
    expect(localize(undefined, MAP)).toBeNull();
    expect(localize("", MAP)).toBeNull();
  });
});

describe("localizeBackgroundImage", () => {
  it("rewrites a single url() reference", () => {
    expect(localizeBackgroundImage('url("https://assets.example.test/x.png")', MAP)).toBe(
      'url("/assets/abc123-x.png")',
    );
  });
  it("rewrites every url() in a stack and leaves gradients alone", () => {
    const input = `linear-gradient(black, white), url(https://assets.example.test/x.png), url('https://cdn.example/y.webp')`;
    expect(localizeBackgroundImage(input, MAP)).toBe(
      `linear-gradient(black, white), url(/assets/abc123-x.png), url('/assets/def456-y.webp')`,
    );
  });
  it("leaves unmapped URLs unchanged", () => {
    expect(localizeBackgroundImage("url(https://other.com/z.png)", MAP)).toBe(
      "url(https://other.com/z.png)",
    );
  });
  it("returns null for null/undefined/empty", () => {
    expect(localizeBackgroundImage(null, MAP)).toBeNull();
    expect(localizeBackgroundImage("", MAP)).toBeNull();
  });
});
