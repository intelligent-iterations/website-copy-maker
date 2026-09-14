/**
 * Capture full-page screenshots. Returns the buffer (and optionally writes to
 * a path). Pure-ish: the only side effect is the optional disk write.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import type { Page } from "playwright";

export type ScreenshotResult = {
  readonly buffer: Buffer;
  readonly path: string | null;
};

export async function captureFullPageScreenshot(
  page: Page,
  outPath?: string,
): Promise<ScreenshotResult> {
  const buffer = await page.screenshot({ fullPage: true, type: "png" });
  if (!outPath) return { buffer, path: null };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buffer);
  return { buffer, path: outPath };
}
