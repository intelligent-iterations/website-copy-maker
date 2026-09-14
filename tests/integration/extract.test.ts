/**
 * Live integration test: stand up a static server over a fixture site, run
 * the full render+extract pipeline against it, and assert the structure of
 * the extracted page.
 *
 * No mocks - real Chromium, real HTTP, real getComputedStyle. This is the
 * test the README promises is the contract for what website-copy-maker does
 * with a real page.
 */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPage } from "../../src/extract/extractPage.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";

const FIXTURE = path.join(__dirname, "..", "fixtures", "simple-site");
const VIEWPORT = { name: "desktop" as const, width: 1440, height: 900 };

let server: LocalServer;

beforeAll(async () => {
  server = await startLocalServer(FIXTURE);
});

afterAll(async () => {
  if (server) await server.close();
});

describe("extractPage (live)", () => {
  it("captures the page title and metadata", async () => {
    const { page } = await extractPage({
      url: server.url,
      viewport: VIEWPORT,
    });
    expect(page.title).toBe("Simple Fixture Site");
    expect(page.metadata.description).toBe("Fixture page used by integration tests.");
    expect(page.metadata.themeColor).toBe("#FAF8F3");
    expect(page.metadata.favicon).toMatch(/\/favicon\.png$/);
    expect(page.metadata.ogImage).toMatch(/\/og-image\.png$/);
  }, 60_000);

  it("captures a non-empty screenshot", async () => {
    const { screenshot } = await extractPage({
      url: server.url,
      viewport: VIEWPORT,
    });
    expect(screenshot.length).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(screenshot[0]).toBe(0x89);
    expect(screenshot[1]).toBe(0x50);
  }, 60_000);

  it("walks the DOM, computes styles, filters tracking pixels + hidden + script", async () => {
    const { page } = await extractPage({
      url: server.url,
      viewport: VIEWPORT,
    });

    const flat: { tag: string; text: string | null; bg: string }[] = [];
    const walk = (n: typeof page.root): void => {
      flat.push({ tag: n.tag, text: n.text, bg: n.styles.backgroundColor });
      for (const c of n.children) walk(c);
    };
    walk(page.root);

    // <h1 class="hero-title">Build the thing.</h1> should be in the tree
    const h1 = flat.find((n) => n.tag === "h1");
    expect(h1).toBeTruthy();
    expect(h1!.text).toBe("Build the thing.");

    // CTA link
    const cta = flat.find((n) => n.tag === "a" && n.text === "Get started");
    expect(cta).toBeTruthy();

    // Three feature articles
    const features = flat.filter((n) => n.tag === "article");
    expect(features.length).toBe(3);

    // Structural 1×1 tracking pixels are filtered without a provider list.
    const trackingPixel = flat.find(
      (n) => n.tag === "img" && /tracking-pixel/.test(JSON.stringify(n)),
    );
    expect(trackingPixel).toBeUndefined();

    // <script> is filtered
    expect(flat.find((n) => n.tag === "script")).toBeUndefined();

    // display:none div is filtered
    expect(flat.find((n) => n.text === "hidden")).toBeUndefined();
  }, 60_000);

  it("extracts assets including the hero image and og:image", async () => {
    const { page } = await extractPage({
      url: server.url,
      viewport: VIEWPORT,
    });
    const urls = page.assets.map((a) => a.url);
    expect(urls.some((u) => /\/hero\.png$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/favicon\.png$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/og-image\.png$/.test(u))).toBe(true);
    // background-image: url("/hero-bg.png") should be picked up
    expect(urls.some((u) => /\/hero-bg\.png$/.test(u))).toBe(true);
  }, 60_000);

  it("infers fonts from computed styles", async () => {
    const { page } = await extractPage({
      url: server.url,
      viewport: VIEWPORT,
    });
    expect(page.fonts.length).toBeGreaterThan(0);
    expect(page.fonts.some((f) => /fixture sans/i.test(f))).toBe(true);
    expect(page.fontFaces).toContainEqual({
      family: "Fixture Sans",
      style: "normal",
      weight: "400 800",
      stretch: "normal",
      display: "swap",
      sources: [{ url: `${server.url}/fixture-sans.woff2`, format: "woff2" }],
    });
    expect(page.assets).toContainEqual({
      url: `${server.url}/fixture-sans.woff2`,
      source: "font",
    });
  }, 60_000);
});
