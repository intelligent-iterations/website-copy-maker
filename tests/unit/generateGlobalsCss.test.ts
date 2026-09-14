import { describe, expect, it } from "vitest";
import { generateFontFaceCss } from "../../src/generate/generateGlobalsCss.js";

describe("generateFontFaceCss", () => {
  it("emits only materialized local font URLs", () => {
    const css = generateFontFaceCss(
      [
        {
          family: "Fixture Sans",
          style: "normal",
          weight: "400 800",
          stretch: "normal",
          display: "swap",
          sources: [
            { url: "https://assets.example.test/fixture.woff2", format: "woff2" },
            { url: "https://assets.example.test/missing.woff", format: "woff" },
          ],
        },
      ],
      new Map([["https://assets.example.test/fixture.woff2", "/assets/a-fixture.woff2"]]),
    );

    expect(css).toContain('font-family: "Fixture Sans"');
    expect(css).toContain('url("/assets/a-fixture.woff2") format("woff2")');
    expect(css).not.toContain("missing.woff");
    expect(css).not.toContain("https://");
  });

  it("omits a face when none of its files were materialized", () => {
    expect(
      generateFontFaceCss(
        [
          {
            family: "Unavailable",
            style: "normal",
            weight: "400",
            stretch: "normal",
            display: "swap",
            sources: [{ url: "https://assets.example.test/nope.woff2" }],
          },
        ],
        new Map(),
      ),
    ).toBe("");
  });
});
