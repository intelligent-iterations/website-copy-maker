import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPage } from "../../src/extract/extractPage.js";
import { createFontStylesheetSession } from "../../src/extract/extractFontFaces.js";
import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";

const ASSET_FIXTURE = path.join(__dirname, "..", "fixtures", "simple-site");
const VIEWPORT = { name: "desktop" as const, width: 800, height: 600 };

let assetServer: LocalServer;
let pageServer: LocalServer;
let pageFixture: string;

beforeAll(async () => {
  assetServer = await startLocalServer(ASSET_FIXTURE);
  pageFixture = await makeTestDir(path.join(os.tmpdir(), "wcm-external-font-"));
  await fs.writeFile(
    path.join(pageFixture, "index.html"),
    `<!doctype html>
      <html>
        <head><link rel="stylesheet" href="${assetServer.url}/styles.css"></head>
        <body><p>External font stylesheet fixture.</p></body>
      </html>`,
  );
  pageServer = await startLocalServer(pageFixture);
});

afterAll(async () => {
  if (pageServer) await pageServer.close();
  if (assetServer) await assetServer.close();
  await removeTestDir(pageFixture);
});

describe("external font stylesheet extraction", () => {
  it("materializes cross-origin font facts and reuses the per-run cache", async () => {
    const fontStylesheets = createFontStylesheetSession();
    const first = await extractPage({
      url: pageServer.url,
      viewport: VIEWPORT,
      fontStylesheets,
    });
    expect(first.page.fontFaces).toContainEqual({
      family: "Fixture Sans",
      style: "normal",
      weight: "400 800",
      stretch: "normal",
      display: "swap",
      sources: [{ url: `${assetServer.url}/fixture-sans.woff2`, format: "woff2" }],
    });
    expect(fontStylesheets.requestCount).toBe(1);

    await extractPage({ url: pageServer.url, viewport: VIEWPORT, fontStylesheets });
    expect(fontStylesheets.requestCount).toBe(1);
  }, 60_000);
});
