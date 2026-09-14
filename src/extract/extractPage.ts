/**
 * Compose the per-viewport extraction: render → DOM walk → metadata → assets
 * → fonts. Returns one ExtractedPage; caller orchestrates over viewports.
 */

import type { Viewport } from "../agent/thresholds.js";
import type { Page } from "playwright";
import { waitForStablePage } from "../render/waitForStablePage.js";
import { disposeRender, renderOriginal } from "../render/renderOriginal.js";
import { captureFullPageScreenshot } from "../render/captureScreenshots.js";
import { extractAssets } from "./extractAssets.js";
import { extractDom } from "./extractDom.js";
import { extractFonts } from "./extractFonts.js";
import { extractFontFaces, type FontStylesheetSession } from "./extractFontFaces.js";
import { extractMetadata } from "./extractMetadata.js";
import type { ExtractedPage } from "./types.js";

export type ExtractPageOptions = {
  readonly url: string;
  readonly viewport: Viewport;
  readonly screenshotPath?: string;
  readonly headless?: boolean;
  readonly beforeCapture?: (page: Page) => Promise<void>;
  /** Share this caller-owned cache to enforce one stylesheet budget per run. */
  readonly fontStylesheets?: FontStylesheetSession;
};

export type ExtractPageResult = {
  readonly page: ExtractedPage;
  readonly screenshot: Buffer;
};

/**
 * One full extraction pass. Allocates a Browser, runs everything, and tears
 * the browser down in `finally` - caller doesn't have to manage lifetimes.
 */
export async function extractPage(opts: ExtractPageOptions): Promise<ExtractPageResult> {
  const handle = await renderOriginal({
    url: opts.url,
    viewport: opts.viewport,
    headless: opts.headless ?? true,
  });
  try {
    if (opts.beforeCapture) {
      await opts.beforeCapture(handle.page);
      await waitForStablePage(handle.page, { scroll: false });
    }
    const [domRoot, metadata, screenshot, fontFaces] = await Promise.all([
      extractDom(handle.page),
      extractMetadata(handle.page),
      captureFullPageScreenshot(handle.page, opts.screenshotPath),
      extractFontFaces(handle.page, opts.fontStylesheets),
    ]);
    const assets = extractAssets(domRoot, metadata, opts.url, fontFaces);
    const fonts = extractFonts(domRoot);
    const extracted: ExtractedPage = {
      url: handle.page.url(),
      viewport: {
        width: opts.viewport.width,
        height: opts.viewport.height,
        name: opts.viewport.name,
      },
      capturedAt: new Date().toISOString(),
      title: metadata.title,
      metadata,
      fonts,
      fontFaces,
      assets,
      root: domRoot,
    };
    return { page: extracted, screenshot: screenshot.buffer };
  } finally {
    await disposeRender(handle);
  }
}
