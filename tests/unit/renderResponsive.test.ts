import { describe, expect, it } from "vitest";
import { renderResponsive } from "../../src/generate/renderResponsive.js";
import type { ProjectModel, ProjectPage } from "../../src/generate/createProject.js";
import type { DesignNode } from "../../src/normalize/types.js";
import type { Section } from "../../src/normalize/groupSections.js";

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

function makeModel(
  sections: Section[],
  root: DesignNode,
): { model: ProjectModel; page: ProjectPage } {
  const page: ProjectPage = {
    routePath: "",
    url: "https://example.com",
    metadata: {
      title: null,
      description: null,
      ogImage: null,
      ogTitle: null,
      favicon: null,
      themeColor: null,
    },
    sections,
    root,
  };
  const model: ProjectModel = {
    siteName: "Example",
    sourceUrl: "https://example.com",
    mode: "responsive",
    metadata: page.metadata,
    tokens: {
      colors: { page: "#fff", ink: "#000", muted: "#999", accent: "#abc", all: [] },
      fontFamilies: ["Inter"],
      maxContentWidth: 1200,
      radii: [],
      shadows: [],
    },
    sections,
    root,
    assetMap: new Map(),
    pages: [page],
  };
  return { model, page };
}

describe("renderResponsive", () => {
  it("emits a stack-on-mobile / row-on-desktop layout when a section has image + text", () => {
    const mediaTextNode = node({
      id: "media-text",
      type: "section",
      rect: { x: 0, y: 0, width: 1200, height: 600 },
      children: [
        node({
          id: "text",
          type: "text",
          text: "Build the future",
          rect: { x: 0, y: 0, width: 500, height: 100 },
          metadata: { ...baseMeta, isLikelyHeading: true },
          style: { fontSize: 48 },
        }),
        node({
          id: "img",
          type: "image",
          src: "https://example.com/media.png",
          rect: { x: 600, y: 0, width: 500, height: 600 },
        }),
      ],
    });
    const sections: Section[] = [{ kind: "generic", index: 0, node: mediaTextNode }];
    const root = node({
      rect: { x: 0, y: 0, width: 1200, height: 600 },
      children: [mediaTextNode],
    });
    const { model, page } = makeModel(sections, root);
    const out = renderResponsive(model, page);
    expect(out).toMatch(/flex-col.*md:flex-row/);
  });

  it("emits a multi-column grid that drops to 1 column on mobile for feature sections", () => {
    const featureNode = node({
      id: "features",
      type: "section",
      rect: { x: 0, y: 0, width: 1200, height: 400 },
      children: [
        node({ id: "f1", type: "card", rect: { x: 0, y: 0, width: 380, height: 300 } }),
        node({ id: "f2", type: "card", rect: { x: 410, y: 0, width: 380, height: 300 } }),
        node({ id: "f3", type: "card", rect: { x: 820, y: 0, width: 380, height: 300 } }),
      ],
    });
    const sections: Section[] = [{ kind: "repeated", index: 0, node: featureNode }];
    const root = node({
      rect: { x: 0, y: 0, width: 1200, height: 400 },
      children: [featureNode],
    });
    const { model, page } = makeModel(sections, root);
    const out = renderResponsive(model, page);
    expect(out).toMatch(/grid-cols-1.*sm:grid-cols-2.*lg:grid-cols-/);
  });

  it("falls back to fidelity-with-scaling-shell when sections come from absolute Y-banding", () => {
    // bandByY-synthesized sections have ids prefixed with "band-".
    const root = node({
      rect: { x: 0, y: 0, width: 1440, height: 5000 },
      children: [
        node({
          id: "band-root-0",
          type: "section",
          rect: { x: 0, y: 0, width: 1440, height: 600 },
          children: [
            node({
              id: "child",
              type: "text",
              text: "Hello",
              rect: { x: 100, y: 100, width: 800, height: 80 },
              metadata: { ...baseMeta, isLikelyHeading: true },
              style: { fontSize: 56 },
            }),
          ],
        }),
        node({
          id: "band-root-1",
          type: "section",
          rect: { x: 0, y: 700, width: 1440, height: 600 },
          children: [],
        }),
      ],
    });
    const sections: Section[] = [
      { kind: "generic", index: 0, node: root.children[0]! },
      { kind: "generic", index: 1, node: root.children[1]! },
    ];
    const { model, page } = makeModel(sections, root);
    const out = renderResponsive(model, page);
    // Whole page renders via fidelity (scaling shell wraps the canvas).
    expect(out).toContain('className="fidelity-canvas-outer"');
    expect(out).toContain('className="fidelity-canvas-inner"');
  });
});
