/**
 * Wait for the page to become visually stable: fonts loaded, images decoded,
 * lazy-load triggered, and a brief idle window after the last network
 * activity. Walks the page top-to-bottom in viewport-sized steps to fire
 * IntersectionObserver-based lazy media before extraction begins.
 *
 *   await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
 *   await page.waitForTimeout(2000);              // initial settle
 *   scroll-walk page → settle → scroll back       // fire IO triggers
 *   await page.waitForLoadState("networkidle");   // re-await network
 *   await fonts.ready + images decoded            // wait newly mounted
 */

import type { Page } from "playwright";

export async function waitForStablePage(
  page: Page,
  options: { scroll?: boolean } = {},
): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {
    // Some sites never reach networkidle (long-poll, websockets). Don't
    // block the whole pipeline on it; we already required goto + DOM load.
  });
  await page.waitForTimeout(2_000);

  // ── Scroll-walk: trigger IntersectionObserver-based lazy-load ─────────
  // Walks the document in 0.8-viewport steps with 250 ms settle at each
  // stop. After reaching the bottom, scrolls back to the top and gives
  // newly-mounted media one more half-second to render. Bounded and
  // deterministic - no race conditions.
  if (options.scroll !== false)
    await page.evaluate(async () => {
      const step = Math.max(window.innerHeight * 0.8, 400);
      const total = document.documentElement.scrollHeight;
      for (let y = 0; y < total + step; y += step) {
        window.scrollTo(0, Math.min(y, total));
        await new Promise<void>((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
      await new Promise<void>((r) => setTimeout(r, 600));
    });
  // Re-await network - lazy-loaded media often kick off fresh requests.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  await page.evaluate(async () => {
    if ("fonts" in document) {
      await (document as Document).fonts.ready;
    }
    await Promise.all(
      Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }),
    );
  });
}
