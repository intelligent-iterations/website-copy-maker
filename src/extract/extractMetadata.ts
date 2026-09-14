/**
 * Pull the document-level metadata that the generator needs for layout.tsx
 * (title, description, og:image, favicon, theme-color).
 */

import type { Page } from "playwright";
import type { ExtractedMetadata } from "./types.js";

export async function extractMetadata(page: Page): Promise<ExtractedMetadata> {
  await page.evaluate(`(function(){
    if (typeof globalThis.__name === 'undefined') globalThis.__name = function(t){return t};
  })()`);
  return page.evaluate<ExtractedMetadata>(() => {
    const meta = (selectors: string[]): string | null => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const value = (el as HTMLMetaElement).content || el.getAttribute("href");
          if (value) return value;
        }
      }
      return null;
    };

    const title = document.title || null;
    const description = meta(['meta[name="description"]', 'meta[property="og:description"]']);
    const ogTitle = meta(['meta[property="og:title"]']);
    const ogImage = meta(['meta[property="og:image"]', 'meta[name="twitter:image"]']);
    const favicon = meta([
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ]);
    const themeColor = meta(['meta[name="theme-color"]']);

    return { title, description, ogImage, ogTitle, favicon, themeColor };
  });
}
