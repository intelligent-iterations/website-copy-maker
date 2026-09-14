import { describe, expect, it } from "vitest";
import { renderSection, type RenderCtx } from "../../src/generate/renderSection.js";
import type { DesignNode } from "../../src/normalize/types.js";

const baseMeta = {
  isLikelyHeading: false,
  isLikelyParagraph: false,
  isLikelyButton: false,
  isLikelyCard: false,
  isLikelyNav: false,
  isLikelyDecorative: false,
  visualImportance: 1,
};

const node = (overrides: Partial<DesignNode>): DesignNode => ({
  id: "x",
  type: "container",
  name: "x",
  rect: { x: 0, y: 0, width: 1200, height: 200 },
  style: {},
  layout: { mode: "normal" },
  metadata: baseMeta,
  children: [],
  ...overrides,
});

const ctx: RenderCtx = {
  sourceUrl: "https://example.com",
  assetMap: new Map([["https://example.com/hero.png", "/assets/abc-hero.png"]]),
  mode: "hybrid",
};

describe("renderSection - heading thresholds", () => {
  it("emits h1 for headings ≥ 40px", () => {
    const section = node({
      children: [
        node({
          type: "text",
          id: "h",
          text: "Build the thing",
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 56 },
        }),
      ],
    });
    const out = renderSection(section, ctx);
    expect(out).toContain("<h1");
    expect(out).toContain("Build the thing");
    expect(out).toContain("text-[56px]");
  });

  it("emits h2 for 28..39px headings", () => {
    const section = node({
      children: [
        node({
          type: "text",
          id: "h",
          text: "Why this matters",
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 32 },
        }),
      ],
    });
    expect(renderSection(section, ctx)).toContain("<h2");
  });

  it("emits p for body text", () => {
    const section = node({
      children: [
        node({
          type: "text",
          id: "p",
          text: "Some descriptive paragraph that runs a couple of lines.",
          metadata: { ...baseMeta, isLikelyParagraph: true },
          style: { fontSize: 16 },
        }),
      ],
    });
    expect(renderSection(section, ctx)).toContain("<p");
  });
});

describe("renderSection - grid layout", () => {
  it("3 equal-size cards → grid-cols-3", () => {
    const card = (id: string) =>
      node({
        id,
        type: "card",
        rect: { x: 0, y: 0, width: 380, height: 240 },
        children: [
          node({
            type: "text",
            text: `Card ${id}`,
            metadata: { ...baseMeta, isLikelyHeading: true },
            style: { fontSize: 22 },
          }),
        ],
      });
    const section = node({
      rect: { x: 0, y: 0, width: 1200, height: 240 },
      children: [card("a"), card("b"), card("c")],
    });
    const out = renderSection(section, ctx);
    expect(out).toMatch(/md:grid-cols-3/);
    expect(out).toContain("Card a");
    expect(out).toContain("Card b");
    expect(out).toContain("Card c");
  });

  it("4 equal-size cards → grid-cols-4 (clamped)", () => {
    const card = (id: string) =>
      node({
        id,
        type: "card",
        rect: { x: 0, y: 0, width: 280, height: 200 },
        children: [
          node({
            type: "text",
            text: id,
            metadata: { ...baseMeta, isLikelyHeading: true },
            style: { fontSize: 20 },
          }),
        ],
      });
    const section = node({
      rect: { x: 0, y: 0, width: 1200, height: 200 },
      children: ["a", "b", "c", "d"].map(card),
    });
    expect(renderSection(section, ctx)).toMatch(/md:grid-cols-4/);
  });
});

describe("renderSection - two-column with image", () => {
  it("text + image where image is ≥ 30% of section width → grid 2 cols", () => {
    const section = node({
      rect: { x: 0, y: 0, width: 1200, height: 600 },
      children: [
        node({
          id: "txt",
          type: "container",
          rect: { x: 0, y: 0, width: 700, height: 600 },
          children: [
            node({
              type: "text",
              id: "h",
              text: "Headline",
              metadata: { ...baseMeta, isLikelyHeading: true },
              style: { fontSize: 48 },
            }),
          ],
        }),
        node({
          id: "img",
          type: "image",
          src: "https://example.com/hero.png",
          rect: { x: 700, y: 0, width: 480, height: 600 }, // 40% of 1200
        }),
      ],
    });
    const out = renderSection(section, ctx);
    expect(out).toContain("md:grid-cols-2");
    expect(out).toContain('src="/assets/abc-hero.png"'); // localized
  });

  it("does not switch to two-column when image is < 30% of section width", () => {
    const section = node({
      rect: { x: 0, y: 0, width: 1200, height: 200 },
      children: [
        node({
          type: "text",
          id: "h",
          text: "Some heading",
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 32 },
        }),
        node({
          id: "img",
          type: "image",
          src: "https://example.com/hero.png",
          rect: { x: 0, y: 0, width: 200, height: 100 }, // 16%
        }),
      ],
    });
    const out = renderSection(section, ctx);
    expect(out).not.toContain("md:grid-cols-2");
  });
});

describe("renderSection - anti-cheat", () => {
  it("never emits a base64 inline image", () => {
    const section = node({
      children: [
        node({
          type: "image",
          src: "data:image/png;base64,AAAA",
          rect: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ],
    });
    const out = renderSection(section, ctx);
    expect(out).not.toMatch(/data:image/);
  });

  it("rewrites same-host hrefs through rewriteHref", () => {
    const section = node({
      children: [
        node({
          type: "link",
          text: "Privacy",
          href: "https://example.com/privacy",
          rect: { x: 0, y: 0, width: 100, height: 30 },
        }),
      ],
    });
    const out = renderSection(section, ctx);
    expect(out).toContain('href="/privacy/"');
    expect(out).not.toContain("https://example.com/privacy");
  });
});
