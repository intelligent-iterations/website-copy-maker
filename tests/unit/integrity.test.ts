import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertGenerationIntegrity } from "../../src/qa/integrity.js";
import type { ExtractedNode } from "../../src/extract/types.js";

function rect(x: number, y: number, w: number, h: number) {
  return { x, y, top: y, left: x, width: w, height: h, right: x + w, bottom: y + h };
}

function styles(): ExtractedNode["styles"] {
  return {
    display: "block",
    position: "static",
    zIndex: "auto",
    overflow: "visible",
    opacity: "1",
    visibility: "visible",
    color: "rgb(0,0,0)",
    backgroundColor: "rgba(0,0,0,0)",
    backgroundImage: "none",
    fontFamily: "sans-serif",
    fontSize: "16px",
    fontWeight: "400",
    lineHeight: "normal",
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
}

function makeRoot(children: ExtractedNode[]): ExtractedNode {
  return {
    id: "root",
    tag: "body",
    role: null,
    text: null,
    attributes: {},
    rect: rect(0, 0, 1440, 5000),
    styles: styles(),
    children,
  };
}

function imgNode(opts: {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}): ExtractedNode {
  return {
    id: opts.id,
    tag: "img",
    role: null,
    text: null,
    attributes: { src: opts.src },
    src: opts.src,
    rect: rect(opts.x, opts.y, opts.w, opts.h),
    styles: styles(),
    children: [],
  };
}

function headingNode(text: string): ExtractedNode {
  return {
    id: "h1",
    tag: "h1",
    role: null,
    text,
    attributes: {},
    rect: rect(100, 100, 800, 80),
    styles: styles(),
    children: [],
  };
}

let outDir: string;

beforeEach(async () => {
  outDir = await makeTestDir(path.join(os.tmpdir(), "wcm-integ-"));
  await fs.mkdir(path.join(outDir, "app"), { recursive: true });
  await fs.mkdir(path.join(outDir, "public", "assets"), { recursive: true });
});

afterEach(async () => {
  await removeTestDir(outDir);
});

async function writePage(pageContents: string): Promise<void> {
  await fs.writeFile(path.join(outDir, "app", "page.tsx"), pageContents, "utf8");
}

describe("assertGenerationIntegrity", () => {
  const sourceUrl = "https://example.com";

  it("allows a text-only source without inventing an image", async () => {
    const heading = "A text-only reference should remain a text-only replica.";
    await writePage(`export default function Page() { return <main><h1>${heading}</h1></main>; }`);
    const report = await assertGenerationIntegrity({
      outDir,
      sourceUrl,
      extractedRoot: makeRoot([headingNode(heading)]),
    });
    expect(report.violations).toEqual([]);
  });

  it("passes a clean page with copied media, distinctive text, and resolved assets", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" alt="" style={{"position":"absolute","left":"100px","top":"50px","width":"600px","height":"400px"}} />
            <h1 style={{"position":"absolute","left":"100px","top":"500px"}}>This is a long enough headline to count as distinctive content for the test.</h1>
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 100, y: 50, w: 600, h: 400 }),
      headingNode("This is a long enough headline to count as distinctive content for the test."),
    ]);
    const report = await assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root });
    expect(report.violations).toEqual([]);
    expect(report.invariants.every((i) => i.passed)).toBe(true);
  });

  it("fails when an inline base64 raster is embedded", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" style={{"position":"absolute","left":"0px","top":"0px"}} />
            <img src="data:image/png;base64,AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ" />
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 0, y: 0, w: 800, h: 400 }),
    ]);
    await expect(
      assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root }),
    ).rejects.toThrow(/no-base64-rasters/);
  });

  it("fails on source-domain leakage in href/src", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" style={{"position":"absolute","left":"0px","top":"0px"}} />
            <a href="https://example.com/oops">leaked</a>
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 0, y: 0, w: 800, h: 400 }),
    ]);
    await expect(
      assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root }),
    ).rejects.toThrow(/no-source-domain-leakage/);
  });

  it("fails when an asset is referenced but not on disk", async () => {
    await writePage(`
      <img src="/assets/missing.png" style={{"position":"absolute","left":"0px","top":"0px"}} />
    `);
    const root = makeRoot([]);
    await expect(
      assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root }),
    ).rejects.toThrow(/asset-references-resolve/);
  });

  it("fails on transform with non-zero translation alongside rect-derived left/top", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" style={{"position":"absolute","left":"100px","top":"50px","width":"600px","height":"400px"}} />
            <h1 style={{"position":"absolute","left":"100px","top":"500px"}}>This is a long enough headline to count as distinctive content for the test.</h1>
            <a href="/x" style={{"position":"absolute","left":"911px","top":"4861px","width":"56px","height":"56px","transform":"matrix(1, 0, 0, 1, -204, 0)"}} />
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 100, y: 50, w: 600, h: 400 }),
      headingNode("This is a long enough headline to count as distinctive content for the test."),
    ]);
    await expect(
      assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root }),
    ).rejects.toThrow(/no-transform-with-rect-translation/);
  });

  it("permits transforms that contain rotation but no translation", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" style={{"position":"absolute","left":"100px","top":"50px","width":"600px","height":"400px","transform":"matrix(0.707, 0.707, -0.707, 0.707, 0, 0)"}} />
            <h1 style={{"position":"absolute","left":"100px","top":"500px"}}>This is a long enough headline to count as distinctive content for the test.</h1>
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 100, y: 50, w: 600, h: 400 }),
      headingNode("This is a long enough headline to count as distinctive content for the test."),
    ]);
    const report = await assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root });
    expect(report.violations).toEqual([]);
  });

  it("fails when distinctive source phrases are dropped from the generated tree", async () => {
    await fs.writeFile(path.join(outDir, "public", "assets", "hero.png"), Buffer.from([0]));
    // Page renders an image but NOT the heading content from the source.
    await writePage(`
      export default function Page() {
        return (
          <main>
            <img src="/assets/hero.png" style={{"position":"absolute","left":"0px","top":"0px","width":"800px","height":"400px"}} />
            <p>generic placeholder text</p>
          </main>
        );
      }
    `);
    const root = makeRoot([
      imgNode({ id: "hero", src: "https://example.com/hero.png", x: 0, y: 0, w: 800, h: 400 }),
      headingNode("Your products shouldn't keep secrets from you - a distinctive headline."),
    ]);
    await expect(
      assertGenerationIntegrity({ outDir, sourceUrl, extractedRoot: root }),
    ).rejects.toThrow(/distinctive-phrases-present/);
  });
});
