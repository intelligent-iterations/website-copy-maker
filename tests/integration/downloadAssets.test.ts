import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
/**
 * Live integration: stand up an http-server fixture serving 2 PNGs and a 404,
 * point downloadAssets at it via Playwright's APIRequestContext, and verify
 * files written, the map returned, the 404 omitted, and that per-asset
 * failures don't throw.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request, type APIRequestContext } from "playwright";
import { downloadAssets, makeFilename } from "../../src/extract/downloadAssets.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";

let server: LocalServer;
let publicDir: string;
let req: APIRequestContext;

beforeAll(async () => {
  server = await startLocalServer(path.join(__dirname, "..", "fixtures", "simple-site"));
  publicDir = await makeTestDir(path.join(os.tmpdir(), "wcm-assets-"));
  req = await request.newContext();
});

afterAll(async () => {
  if (req) await req.dispose();
  if (server) await server.close();
  await removeTestDir(publicDir);
});

describe("downloadAssets (live)", () => {
  it("downloads accessible PNGs and skips 404s without throwing", async () => {
    // local-server returns a 1x1 transparent PNG for any image-extension miss,
    // so /missing.png is *technically* a 200 from this fixture. To get a real
    // 404 we ask for a non-image asset that doesn't exist.
    const assets = [
      { url: `${server.url}/styles.css`, source: "background-image" as const },
      { url: `${server.url}/index.html`, source: "favicon" as const },
      { url: `${server.url}/this-does-not-exist.txt`, source: "background-image" as const },
    ];
    const warnings: { msg: string; data?: Record<string, unknown> }[] = [];
    const map = await downloadAssets({
      assets,
      publicDir,
      request: req,
      sourceUrl: server.url,
      logger: { warn: (msg, data) => warnings.push({ msg, ...(data ? { data } : {}) }) },
    });

    expect(map.size).toBe(2);
    expect(map.get(assets[0]!.url)).toMatch(/^\/assets\//);
    expect(map.get(assets[1]!.url)).toMatch(/^\/assets\//);
    expect(map.get(assets[2]!.url)).toBeUndefined();
    expect(warnings.find((w) => w.msg === "asset http error")).toBeTruthy();

    // Files actually exist on disk and aren't empty.
    for (const [, localPath] of map.entries()) {
      const absolute = path.join(publicDir, localPath.replace(/^\/assets\//, ""));
      const stat = await fs.stat(absolute);
      expect(stat.size).toBeGreaterThan(0);
    }
  }, 60_000);

  it("dedupes by URL", async () => {
    const url = `${server.url}/styles.css`;
    const map = await downloadAssets({
      assets: [
        { url, source: "img-src" },
        { url, source: "background-image" },
      ],
      publicDir,
      request: req,
      sourceUrl: server.url,
    });
    expect(map.size).toBe(1);
  }, 60_000);

  it("enforces one count ceiling across the supplied asset set", async () => {
    const warnings: string[] = [];
    const map = await downloadAssets({
      assets: [
        { url: `${server.url}/styles.css`, source: "background-image" },
        { url: `${server.url}/index.html`, source: "favicon" },
      ],
      publicDir,
      request: req,
      sourceUrl: server.url,
      limits: { maxAssets: 1 },
      logger: { warn: (message) => warnings.push(message) },
    });
    expect(map.size).toBe(1);
    expect(warnings).toContain("asset count limit reached");
  }, 60_000);

  it("rejects an asset body above the configured byte ceiling", async () => {
    const warnings: string[] = [];
    const map = await downloadAssets({
      assets: [{ url: `${server.url}/index.html`, source: "favicon" }],
      publicDir,
      request: req,
      sourceUrl: server.url,
      limits: { maxAssetBytes: 16, maxTotalBytes: 16 },
      logger: { warn: (message) => warnings.push(message) },
    });
    expect(map.size).toBe(0);
    expect(warnings).toContain("asset byte limit exceeded");
  }, 60_000);
});

describe("makeFilename (pure)", () => {
  it("hashes URL and preserves base name with content-type extension", () => {
    const f = makeFilename("https://x/foo/hero-banner.png", "image/png");
    expect(f).toMatch(/^[0-9a-f]{10}-hero-banner\.png$/);
  });

  it("prefers content-type over URL extension when both exist", () => {
    const f = makeFilename("https://x/icon.gif?scale=4", "image/png");
    expect(f).toMatch(/\.png$/);
  });

  it("uses URL extension when content-type is missing", () => {
    expect(makeFilename("https://x/banner.webp")).toMatch(/\.webp$/);
  });

  it("falls back to .bin when neither helps", () => {
    expect(makeFilename("https://x/no-ext-here")).toMatch(/\.bin$/);
  });

  it("keeps filenames short and safe", () => {
    const long = "https://x/" + "a".repeat(500) + ".png";
    const f = makeFilename(long, "image/png");
    expect(f.length).toBeLessThan(80);
    expect(f).toMatch(/^[0-9a-f]{10}-a+\.png$/);
  });
});
