import type { Page } from "playwright";
import type { ExtractedFontFace, ExtractedFontSource } from "./types.js";

export const MAX_EXTERNAL_STYLESHEETS = 24;
export const MAX_STYLESHEET_BYTES = 512 * 1024;
export const MAX_TOTAL_STYLESHEET_BYTES = 4 * 1024 * 1024;

type StyleSource = {
  readonly css: string;
  readonly baseUrl: string;
};

/** Mutable, caller-owned cache and budget shared across one capture/copy run. */
export type FontStylesheetSession = {
  readonly cache: Map<string, StyleSource | null>;
  requestCount: number;
  totalBytes: number;
};

export function createFontStylesheetSession(): FontStylesheetSession {
  return { cache: new Map(), requestCount: 0, totalBytes: 0 };
}

type BrowserStyleInventory = {
  readonly inline: readonly StyleSource[];
  readonly external: readonly string[];
};

/**
 * Extract materializable font faces from inline, same-origin, and linked
 * stylesheets. Linked stylesheets are fetched sequentially through the page's
 * request context with strict count and byte ceilings and no retries.
 */
export async function extractFontFaces(
  page: Page,
  session: FontStylesheetSession = createFontStylesheetSession(),
): Promise<readonly ExtractedFontFace[]> {
  const inventory = await page.evaluate((): BrowserStyleInventory => {
    const inline: StyleSource[] = [];
    const external = new Set<string>();
    const inspected = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      const baseUrl = sheet.href ?? document.baseURI;
      try {
        const css = Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
        inline.push({ css, baseUrl });
        if (sheet.href) inspected.add(sheet.href);
      } catch {
        if (sheet.href) external.add(sheet.href);
      }
    }
    for (const link of Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
    )) {
      if (link.href && !inspected.has(link.href)) external.add(link.href);
    }
    return { inline, external: [...external] };
  });

  const sources: StyleSource[] = [...inventory.inline];
  const queued = [
    ...inventory.external,
    ...sources.flatMap((source) => extractImports(source.css, source.baseUrl)),
  ];
  const seenThisPage = new Set<string>();

  while (queued.length > 0) {
    const url = queued.shift()!;
    if (seenThisPage.has(url)) continue;
    seenThisPage.add(url);
    let parsed: URL;
    try {
      parsed = new URL(url, page.url());
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol)) continue;

    const cached = session.cache.get(parsed.href);
    if (cached !== undefined) {
      if (cached) {
        sources.push(cached);
        queued.push(...extractImports(cached.css, cached.baseUrl));
      }
      continue;
    }
    if (session.requestCount >= MAX_EXTERNAL_STYLESHEETS) continue;
    session.requestCount++;

    try {
      const response = await page.request.get(parsed.href, {
        headers: { Referer: page.url() },
        maxRedirects: 2,
        maxRetries: 0,
        timeout: 15_000,
      });
      if (!response.ok()) {
        session.cache.set(parsed.href, null);
        continue;
      }
      const declared = Number(response.headers()["content-length"] ?? "0");
      if (
        declared > MAX_STYLESHEET_BYTES ||
        session.totalBytes + declared > MAX_TOTAL_STYLESHEET_BYTES
      ) {
        session.cache.set(parsed.href, null);
        continue;
      }
      const bytes = await response.body();
      if (
        bytes.length > MAX_STYLESHEET_BYTES ||
        session.totalBytes + bytes.length > MAX_TOTAL_STYLESHEET_BYTES
      ) {
        session.cache.set(parsed.href, null);
        continue;
      }
      session.totalBytes += bytes.length;
      const css = bytes.toString("utf8");
      const source = { css, baseUrl: parsed.href };
      session.cache.set(parsed.href, source);
      sources.push(source);
      for (const imported of extractImports(css, parsed.href)) {
        if (!seenThisPage.has(imported)) queued.push(imported);
      }
    } catch {
      session.cache.set(parsed.href, null);
      // Missing or protected stylesheets leave the corresponding font face
      // unmaterialized; the generated CSS retains the captured fallback stack.
    }
  }

  return dedupeFontFaces(sources.flatMap((source) => parseFontFaces(source.css, source.baseUrl)));
}

/** Pure parser exported for deterministic coverage of CSS edge cases. */
export function parseFontFaces(css: string, baseUrl: string): readonly ExtractedFontFace[] {
  const faces: ExtractedFontFace[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
    const block = match[1] ?? "";
    const family = unquote(readDeclaration(block, "font-family"));
    const sources = parseFontSources(readDeclaration(block, "src"), baseUrl);
    if (!family || sources.length === 0) continue;
    const unicodeRange = readDeclaration(block, "unicode-range");
    faces.push({
      family,
      style: readDeclaration(block, "font-style") || "normal",
      weight: readDeclaration(block, "font-weight") || "400",
      stretch: readDeclaration(block, "font-stretch") || "normal",
      display: readDeclaration(block, "font-display") || "swap",
      ...(unicodeRange ? { unicodeRange } : {}),
      sources,
    });
  }
  return faces;
}

function readDeclaration(block: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;}]*)`, "i").exec(block)?.[1]?.trim() ?? "";
}

function parseFontSources(value: string, baseUrl: string): readonly ExtractedFontSource[] {
  const sources: ExtractedFontSource[] = [];
  const pattern =
    /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)\s*(?:format\(\s*(?:"([^"]+)"|'([^']+)'|([^)]*?))\s*\))?/gi;
  for (const match of value.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    if (!raw || /^(?:data|blob):/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      const format = (match[4] ?? match[5] ?? match[6] ?? "").trim();
      sources.push(format ? { url: url.href, format } : { url: url.href });
    } catch {
      // Ignore malformed font URLs and preserve the source's fallback family.
    }
  }
  return sources;
}

function extractImports(css: string, baseUrl: string): readonly string[] {
  const urls: string[] = [];
  const pattern = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^)'"\s;]+))\s*\)?/gi;
  for (const match of css.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    try {
      const url = new URL(raw, baseUrl);
      if (/^https?:$/.test(url.protocol)) urls.push(url.href);
    } catch {
      // Ignore malformed import URLs.
    }
  }
  return urls;
}

function unquote(value: string): string {
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
}

function dedupeFontFaces(faces: readonly ExtractedFontFace[]): readonly ExtractedFontFace[] {
  const seen = new Set<string>();
  const out: ExtractedFontFace[] = [];
  for (const face of faces) {
    const key = JSON.stringify(face);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(face);
  }
  return out;
}
