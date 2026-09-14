import { describe, expect, it } from "vitest";
import { normalizeTree } from "../../src/normalize/normalizeTree.js";
import type { ExtractedNode, ExtractedStyles } from "../../src/extract/types.js";

const baseStyles: ExtractedStyles = {
  display: "block",
  position: "static",
  zIndex: "auto",
  overflow: "visible",
  opacity: "1",
  visibility: "visible",
  color: "rgb(17, 17, 17)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  fontFamily: "Inter, sans-serif",
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

const baseRect = { x: 0, y: 0, top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 };

const makeNode = (overrides: Partial<ExtractedNode>): ExtractedNode => ({
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

describe("normalizeTree", () => {
  it("classifies headings as text with isLikelyHeading", () => {
    const ext = makeNode({
      tag: "body",
      children: [
        makeNode({
          id: "h1",
          tag: "h1",
          text: "Hello",
          styles: { ...baseStyles, fontSize: "56px" },
        }),
      ],
    });
    const d = normalizeTree(ext);
    const h = d.children[0]!;
    expect(h.type).toBe("text");
    expect(h.metadata.isLikelyHeading).toBe(true);
    expect(h.style.fontSize).toBe(56);
  });

  it("uses element semantics and neutral button class hints", () => {
    const ext = makeNode({
      tag: "body",
      children: [
        makeNode({ id: "a1", tag: "a", text: "About", attributes: { href: "/" }, href: "/" }),
        makeNode({
          id: "a2",
          tag: "a",
          text: "Sign up",
          attributes: { class: "btn primary", href: "/signup" },
          href: "/signup",
        }),
      ],
    });
    const d = normalizeTree(ext);
    expect(d.children[0]!.type).toBe("link");
    expect(d.children[1]!.type).toBe("button");
  });

  it("does not infer content roles from product-oriented class names", () => {
    const ext = makeNode({
      tag: "body",
      children: [
        makeNode({
          id: "feature",
          tag: "div",
          attributes: { class: "feature-card" },
          children: [makeNode({ id: "copy", tag: "p", text: "Measured content" })],
        }),
        makeNode({
          id: "article",
          tag: "article",
          children: [makeNode({ id: "article-copy", tag: "p", text: "Semantic content" })],
        }),
      ],
    });
    const d = normalizeTree(ext);
    expect(d.children[0]!.type).toBe("container");
    expect(d.children[0]!.metadata.isLikelyCard).toBe(false);
    expect(d.children[1]!.type).toBe("card");
  });

  it("uses navigation semantics instead of class-name guesses", () => {
    const ext = makeNode({
      tag: "body",
      children: [
        makeNode({ id: "header", tag: "div", attributes: { class: "site-header" } }),
        makeNode({ id: "navigation", tag: "div", role: "navigation" }),
      ],
    });
    const d = normalizeTree(ext);
    expect(d.children[0]!.metadata.isLikelyNav).toBe(false);
    expect(d.children[1]!.metadata.isLikelyNav).toBe(true);
  });

  it("captures backgroundImage url", () => {
    const ext = makeNode({
      tag: "body",
      children: [
        makeNode({
          id: "h",
          tag: "section",
          styles: { ...baseStyles, backgroundImage: 'url("/hero-bg.png")' },
        }),
      ],
    });
    const d = normalizeTree(ext);
    expect(d.children[0]!.style.backgroundImage).toBe('url("/hero-bg.png")');
    expect(d.children[0]!.src).toBe("/hero-bg.png");
  });

  it("recognises flex layout from display:flex", () => {
    const ext = makeNode({
      styles: { ...baseStyles, display: "flex", flexDirection: "column", gap: "16px" },
    });
    const d = normalizeTree(ext);
    expect(d.layout.mode).toBe("flex");
    expect(d.layout.direction).toBe("column");
    expect(d.layout.gap).toBe(16);
  });
});
