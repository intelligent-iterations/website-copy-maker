/**
 * Pure: rewrite hrefs captured from a source page so the generated rebuild
 * doesn't link back to the source domain.
 *
 * - Same-host links rewrite to the same pathname (preserving the
 *   directory structure). The Next.js App Router route at
 *   app/<pathname>/page.tsx serves this URL on the rebuilt site.
 * - External links are untouched - they're
 *   real outbound destinations, not source-site self-references.
 * - Non-http schemes (mailto:, tel:, javascript:) untouched.
 *
 * Single chokepoint used by every emitter so the rule has one home.
 */

export function rewriteHref(rawHref: string, sourceUrl: string): string {
  if (!rawHref) return rawHref;

  // Pure-fragment links - preserve as-is.
  if (rawHref.startsWith("#")) return rawHref;

  // Non-http schemes (mailto:, tel:, javascript:, blob:, data:).
  // URL parses these but we never want to rewrite them.
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) && !/^https?:/i.test(rawHref)) {
    return rawHref;
  }

  let abs: URL;
  let src: URL;
  try {
    abs = new URL(rawHref, sourceUrl);
    src = new URL(sourceUrl);
  } catch {
    return rawHref;
  }

  if (abs.hostname !== src.hostname) {
    // External - return absolute form so the generated <a> has a working URL.
    return abs.toString();
  }

  // Same-host: keep the pathname and match the adapter's trailingSlash
  // setting. Carry over hash.
  const pathname = abs.pathname.replace(/\/+$/, "");
  const path = pathname === "" ? "/" : pathname + "/";
  return abs.hash ? `${path}${abs.hash}` : path;
}

/**
 * Pure: derive the Next.js App Router route path for a same-host URL.
 * The root URL maps to "" (i.e. app/page.tsx). Any other URL maps to its
 * pathname (e.g. /blog/post-1 → "blog/post-1" → app/blog/post-1/page.tsx).
 *
 * Returns null for external URLs, fragment-only links, and non-http schemes.
 */
export function urlToRoutePath(rawHref: string, sourceUrl: string): string | null {
  if (!rawHref) return null;
  if (rawHref.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) && !/^https?:/i.test(rawHref)) {
    return null;
  }
  let abs: URL;
  let src: URL;
  try {
    abs = new URL(rawHref, sourceUrl);
    src = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (abs.hostname !== src.hostname) return null;
  const segments = abs.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return ""; // root
  return segments.join("/");
}
