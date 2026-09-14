import { describe, expect, it } from "vitest";
import { discoverInternalUrls } from "../../src/normalize/discoverUrls.js";
import type { ExtractedNode } from "../../src/extract/types.js";

const SRC = "https://example.com";

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

const a = (href: string, id = "a"): ExtractedNode => ({
  id,
  tag: "a",
  role: null,
  text: "x",
  attributes: {},
  href,
  rect: baseRect,
  styles: baseStyles,
  children: [],
});

const root = (children: ExtractedNode[]): ExtractedNode => ({
  id: "root",
  tag: "body",
  role: null,
  text: null,
  attributes: {},
  rect: baseRect,
  styles: baseStyles,
  children,
});

describe("discoverInternalUrls", () => {
  it("collects same-host hrefs and deduplicates by route path", () => {
    const tree = root([
      a("https://example.com/privacy"),
      a("https://example.com/blog/post-1"),
      a("https://example.com/privacy/"), // same route, dedupe
      a("https://apps.apple.com/x"), // external, ignored
      a("#features"), // fragment, ignored
      a("https://example.com/"), // root, ignored (we always rebuild root)
      a("mailto:a@b.c"), // non-http, ignored
    ]);
    const urls = discoverInternalUrls({ root: tree, sourceUrl: SRC });
    expect([...urls].sort()).toEqual([
      "https://example.com/blog/post-1",
      "https://example.com/privacy",
    ]);
  });

  it("strips hashes from collected URLs", () => {
    const tree = root([a("https://example.com/about#team")]);
    const urls = discoverInternalUrls({ root: tree, sourceUrl: SRC });
    expect(urls).toEqual(["https://example.com/about"]);
  });

  it("respects maxUrls", () => {
    const many = Array.from({ length: 50 }, (_, i) => a(`https://example.com/page-${i}`, `a${i}`));
    const urls = discoverInternalUrls({
      root: root(many),
      sourceUrl: SRC,
      maxUrls: 5,
    });
    expect(urls.length).toBe(5);
  });
});
