/**
 * Capture full-page screenshots of a *running* site at every configured
 * viewport. Owns its own browser/context lifecycle and tears down in
 * `finally`. Caller passes the URL the site is already serving from - we
 * don't care whether it's `next dev`, a static `http-server`, or anything
 * else.
 */

import { chromium, type Browser } from "playwright";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Viewport } from "../agent/thresholds.js";
import { waitForStablePage } from "../render/waitForStablePage.js";

export type CapturedScreenshot = {
  readonly viewport: Viewport;
  readonly buffer: Buffer;
  readonly path: string | null;
};

export type CaptureOptions = {
  readonly url: string;
  readonly viewports: readonly Viewport[];
  readonly outDir?: string; // when set, write PNGs to disk
  readonly headless?: boolean;
  /** Filename prefix for emitted PNGs (default "generated"). Used by the
   * QA loop to disambiguate per-route captures (`generated-blog-mobile.png`
   * vs `generated-mobile.png`). */
  readonly filenamePrefix?: string;
};

export async function captureGeneratedScreenshots(
  opts: CaptureOptions,
): Promise<readonly CapturedScreenshot[]> {
  const browser: Browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    const out: CapturedScreenshot[] = [];
    for (const vp of opts.viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      try {
        const response = await page.goto(opts.url, { waitUntil: "networkidle", timeout: 30_000 });
        if (!response || !response.ok())
          throw new Error(`Capture failed: ${opts.url} (HTTP ${response?.status() ?? "unknown"})`);
        await waitForStablePage(page);
        const buffer = await page.screenshot({ fullPage: true, type: "png" });
        let pngPath: string | null = null;
        if (opts.outDir) {
          await fs.mkdir(opts.outDir, { recursive: true });
          const prefix = opts.filenamePrefix ?? "generated";
          pngPath = path.join(opts.outDir, `${prefix}-${vp.name}.png`);
          await fs.writeFile(pngPath, buffer);
        }
        out.push({ viewport: vp, buffer, path: pngPath });
      } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    }
    return out;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
