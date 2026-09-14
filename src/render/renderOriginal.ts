/**
 * Open a page at a viewport, navigate to the URL, and wait for it to settle.
 * The caller owns the returned `page` (and `context`) - this module never
 * closes them. Cleanup happens in a `finally` at the call site.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Viewport } from "../agent/thresholds.js";
import { waitForStablePage } from "./waitForStablePage.js";

export type RenderHandle = {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
};

export type RenderOptions = {
  readonly url: string;
  readonly viewport: Viewport;
  readonly headless?: boolean;
  readonly browserChannel?: string;
};

export async function renderOriginal(opts: RenderOptions): Promise<RenderHandle> {
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    ...(opts.browserChannel ? { channel: opts.browserChannel } : {}),
  });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    const response = await page.goto(opts.url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!response || !response.ok())
      throw new Error(`Capture failed: ${opts.url} (HTTP ${response?.status() ?? "unknown"})`);
    await waitForStablePage(page);
    return { browser, context, page };
  } catch (err) {
    // Tear down whatever we managed to allocate before re-throwing.
    if (page) await page.close().catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw err;
  }
}

export async function disposeRender(handle: RenderHandle): Promise<void> {
  await handle.page.close().catch(() => undefined);
  await handle.context.close().catch(() => undefined);
  await handle.browser.close().catch(() => undefined);
}
