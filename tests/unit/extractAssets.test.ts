import { describe, expect, it } from "vitest";
import { extractAssets } from "../../src/extract/extractAssets.js";
import type { ExtractedNode, ExtractedMetadata } from "../../src/extract/types.js";

const baseStyles = {
  display: "block",
  position: "static",
  zIndex: "auto",
  overflow: "visible",
  opacity: "1",
  visibility: "visible",
  color: "rgb(0, 0, 0)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  fontFamily: "Inter",
  fontSize: "16px",
  fontWeight: "400",
  lineHeight: "1.5",
  letterSpacing: "normal",
  textAlign: "left",
  textTransform: "none",
  margin: "0px",
  padding: "0px",
  gap: "0px",
  border: "0px",
  borderRadius: "0px",
  boxShadow: "none",
  transform: "none",
  flexDirection: "row",
  alignItems: "stretch",
  justifyContent: "flex-start",
  gridTemplateColumns: "none",
  gridTemplateRows: "none",
};

const baseRect = { x: 0, y: 0, top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };

const node = (overrides: Partial<ExtractedNode>): ExtractedNode => ({
  id: "n1",
  tag: "div",
  role: null,
  text: null,
  attributes: {},
  rect: baseRect,
  styles: baseStyles,
  children: [],
  ...overrides,
});

const noMeta: ExtractedMetadata = {
  title: null,
  description: null,
  ogImage: null,
  ogTitle: null,
  favicon: null,
  themeColor: null,
};

describe("extractAssets", () => {
  it("collects img.src", () => {
    const root = node({
      tag: "section",
      children: [node({ tag: "img", id: "img1", src: "/hero.png" })],
    });
    const assets = extractAssets(root, noMeta, "https://example.com");
    expect(assets).toContainEqual({
      url: "https://example.com/hero.png",
      source: "img-src",
      nodeId: "img1",
    });
  });

  it("collects css background-image urls", () => {
    const root = node({
      styles: { ...baseStyles, backgroundImage: 'url("/bg.jpg")' },
    });
    const assets = extractAssets(root, noMeta, "https://example.com");
    expect(assets[0]?.url).toBe("https://example.com/bg.jpg");
    expect(assets[0]?.source).toBe("background-image");
  });

  it("ignores data: and blob: urls", () => {
    const root = node({
      tag: "img",
      src: "data:image/png;base64,AAAA",
    });
    expect(extractAssets(root, noMeta, "https://example.com")).toEqual([]);
  });

  it("dedupes by url+source", () => {
    const root = node({
      children: [
        node({ tag: "img", id: "a", src: "/x.png" }),
        node({ tag: "img", id: "b", src: "/x.png" }),
      ],
    });
    const assets = extractAssets(root, noMeta, "https://example.com");
    const byUrl = assets.filter(
      (a) => a.url === "https://example.com/x.png" && a.source === "img-src",
    );
    expect(byUrl.length).toBe(1);
  });

  it("includes favicon and og:image from metadata", () => {
    const root = node({});
    const meta: ExtractedMetadata = {
      ...noMeta,
      favicon: "/favicon.png",
      ogImage: "/og.png",
    };
    const assets = extractAssets(root, meta, "https://example.com");
    expect(assets.find((a) => a.source === "favicon")?.url).toBe("https://example.com/favicon.png");
    expect(assets.find((a) => a.url === "https://example.com/og.png")).toBeTruthy();
  });

  it("expands srcset on <source>", () => {
    const root = node({
      children: [
        node({
          tag: "source",
          id: "s1",
          attributes: { srcset: "/small.png 1x, /large.png 2x" },
        }),
      ],
    });
    const assets = extractAssets(root, noMeta, "https://example.com");
    const urls = assets.map((a) => a.url).sort();
    expect(urls).toEqual(["https://example.com/large.png", "https://example.com/small.png"]);
  });

  it("collects each discovered font source as a materializable asset", () => {
    const assets = extractAssets(node({}), noMeta, "https://example.com", [
      {
        family: "Fixture Sans",
        style: "normal",
        weight: "400",
        stretch: "normal",
        display: "swap",
        sources: [
          { url: "https://cdn.example.test/type.woff2", format: "woff2" },
          { url: "https://cdn.example.test/type.woff", format: "woff" },
        ],
      },
    ]);
    expect(assets).toContainEqual({
      url: "https://cdn.example.test/type.woff2",
      source: "font",
    });
    expect(assets).toContainEqual({
      url: "https://cdn.example.test/type.woff",
      source: "font",
    });
  });
});
