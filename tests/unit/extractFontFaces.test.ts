import { describe, expect, it } from "vitest";
import { parseFontFaces } from "../../src/extract/extractFontFaces.js";

describe("parseFontFaces", () => {
  it("extracts portable HTTP font sources and resolves relative URLs", () => {
    const faces = parseFontFaces(
      `
        @font-face {
          font-family: "Fixture Sans";
          src: local("Fixture Sans"),
            url("../fonts/fixture.woff2") format("woff2"),
            url(https://assets.example.test/fixture.woff) format('woff');
          font-style: italic;
          font-weight: 300 700;
          font-display: optional;
          unicode-range: U+0000-00FF;
        }
      `,
      "https://example.test/css/site.css",
    );

    expect(faces).toEqual([
      {
        family: "Fixture Sans",
        style: "italic",
        weight: "300 700",
        stretch: "normal",
        display: "optional",
        unicodeRange: "U+0000-00FF",
        sources: [
          { url: "https://example.test/fonts/fixture.woff2", format: "woff2" },
          { url: "https://assets.example.test/fixture.woff", format: "woff" },
        ],
      },
    ]);
  });

  it("ignores embedded, blob, malformed, and source-less faces", () => {
    expect(
      parseFontFaces(
        `
          @font-face { font-family: Embedded; src: url(data:font/woff2;base64,AAAA); }
          @font-face { font-family: Blob; src: url(blob:abc); }
          @font-face { font-family: LocalOnly; src: local("Local Only"); }
        `,
        "https://example.test/site.css",
      ),
    ).toEqual([]);
  });
});
