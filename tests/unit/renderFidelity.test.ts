import { describe, expect, it } from "vitest";
import { renderFidelity, type FidelityCtx } from "../../src/generate/renderFidelity.js";
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
  rect: { x: 0, y: 0, width: 100, height: 100 },
  style: {},
  layout: { mode: "normal" },
  metadata: baseMeta,
  children: [],
  ...overrides,
});

const ctx: FidelityCtx = {
  sourceUrl: "https://example.com",
  assetMap: new Map([["https://example.com/a.png", "/assets/abc-a.png"]]),
};

describe("renderFidelity", () => {
  it("emits absolute positioning when layout.mode is absolute", () => {
    const root = node({
      rect: { x: 0, y: 0, width: 1440, height: 4000 },
      children: [
        node({
          id: "child",
          type: "text",
          layout: { mode: "absolute" },
          rect: { x: 100, y: 200, width: 800, height: 80 },
          text: "Hello",
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 56 },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    expect(out).toContain('"position": "absolute"');
    expect(out).toContain('"left": "100px"');
    expect(out).toContain('"top": "200px"');
    expect(out).toContain('"fontSize": "56px"');
    expect(out).toContain("<h1");
    expect(out).toContain("Hello");
  });

  it("rejects data: and blob: image URIs", () => {
    const root = node({
      children: [
        node({
          type: "image",
          src: "data:image/png;base64,XXX",
          rect: { x: 0, y: 0, width: 100, height: 100 },
        }),
        node({
          type: "image",
          src: "blob:https://x/123",
          rect: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    expect(out).not.toContain("data:");
    expect(out).not.toContain("blob:");
  });

  it("rejects page-screenshot-sized images (very wide AND very tall)", () => {
    const section = node({
      type: "section",
      rect: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [
        node({
          type: "image",
          src: "https://example.com/a.png",
          rect: { x: 0, y: 0, width: 1440, height: 5000 }, // entire-page-sized
        }),
      ],
    });
    const out = renderFidelity(section, ctx);
    expect(out).not.toContain("/assets/abc-a.png");
  });

  it("allows hero-banner images (wide but not tall)", () => {
    const section = node({
      type: "section",
      rect: { x: 0, y: 0, width: 1440, height: 600 },
      children: [
        node({
          type: "image",
          src: "https://example.com/a.png",
          rect: { x: 0, y: 0, width: 1440, height: 480 }, // 1440 wide but only 480 tall
        }),
      ],
    });
    const out = renderFidelity(section, ctx);
    expect(out).toContain("/assets/abc-a.png");
  });

  it("rewrites same-host hrefs", () => {
    const root = node({
      children: [
        node({
          type: "link",
          href: "https://example.com/about",
          text: "About",
          rect: { x: 0, y: 0, width: 100, height: 30 },
        }),
      ],
    });
    expect(renderFidelity(root, ctx)).toContain('href="/about/"');
  });

  it("never emits base64 inline images", () => {
    const root = node({
      type: "section",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      children: [
        node({
          type: "image",
          src: "data:image/png;base64,AAAA",
          rect: { x: 0, y: 0, width: 50, height: 50 },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    expect(out).not.toMatch(/data:image/);
  });

  it("strips translation from CSS transforms - rect already encodes position", () => {
    // Reproduces the the example site social-icons bug. The source has
    //   transform: matrix(1, 0, 0, 1, -204, 0)
    // on top of an element whose rect is {x:911, y:4861}. Preserving the
    // matrix translates a second time. After the fix, the transform must
    // be dropped (it's a pure translation) so left:911px stands alone.
    const root = node({
      rect: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [
        node({
          id: "social-icon",
          type: "link",
          href: "https://example.com/social",
          text: "Follow",
          rect: { x: 911, y: 4861, width: 56, height: 56 },
          style: { transform: "matrix(1, 0, 0, 1, -204, 0)" },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    expect(out).toContain('"left": "911px"');
    expect(out).toContain('"top": "4861px"');
    expect(out).not.toMatch(/transform.*matrix\(1,\s*0,\s*0,\s*1,\s*-?\d/);
    expect(out).not.toMatch(/translate/);
  });

  it("wraps the canvas in a scaling shell so it doesn't clip on narrow viewports", () => {
    const root = node({
      rect: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [
        node({
          id: "child",
          type: "text",
          rect: { x: 100, y: 100, width: 800, height: 80 },
          text: "Hi",
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 56 },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    expect(out).toContain('className="fidelity-canvas-outer"');
    expect(out).toContain('className="fidelity-canvas-inner"');
    // Custom properties on the outer carry the source canvas dimensions so
    // the matching CSS rules in globals.css can compute the scale factor.
    expect(out).toContain('"--canvas-w": "1440px"');
    expect(out).toContain('"--canvas-h": "5000px"');
  });

  it("preserves rotation while stripping translation in matrix", () => {
    const root = node({
      rect: { x: 0, y: 0, width: 1440, height: 1000 },
      children: [
        node({
          id: "tilted-phone",
          type: "image",
          src: "https://example.com/a.png",
          rect: { x: 720, y: 100, width: 400, height: 800 },
          style: { transform: "matrix(0.707, 0.707, -0.707, 0.707, 50, 50)" },
        }),
      ],
    });
    const out = renderFidelity(root, ctx);
    // Translation components zeroed out, rotation kept.
    expect(out).toContain("matrix(0.707, 0.707, -0.707, 0.707, 0, 0)");
  });
});
