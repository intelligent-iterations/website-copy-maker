/**
 * Walk an ExtractedNode tree and collect every asset URL we should download
 * for a portable copy (img, picture/source, css background-image, video poster,
 * favicon).
 */

import { extractUrls } from "../utils/css.js";
import type {
  ExtractedAsset,
  ExtractedFontFace,
  ExtractedMetadata,
  ExtractedNode,
} from "./types.js";

export function extractAssets(
  root: ExtractedNode,
  metadata: ExtractedMetadata,
  baseUrl: string,
  fontFaces: readonly ExtractedFontFace[] = [],
): readonly ExtractedAsset[] {
  const out: ExtractedAsset[] = [];
  const seen = new Set<string>();

  const push = (
    raw: string | null | undefined,
    source: ExtractedAsset["source"],
    nodeId?: string,
  ): void => {
    if (!raw) return;
    const abs = absolutize(raw, baseUrl);
    if (!abs) return;
    const key = `${source}::${abs}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(nodeId !== undefined ? { url: abs, source, nodeId } : { url: abs, source });
  };

  const walk = (n: ExtractedNode): void => {
    if (n.tag === "img") {
      push(n.src, "img-src", n.id);
      push(n.currentSrc, "img-currentSrc", n.id);
    }
    if (n.tag === "source") {
      push(n.src, "picture-source", n.id);
      const srcset = n.attributes.srcset;
      if (srcset) {
        for (const candidate of parseSrcset(srcset)) {
          push(candidate, "picture-source", n.id);
        }
      }
    }
    if (n.tag === "video") {
      const poster = n.attributes.poster;
      if (poster) push(poster, "video-poster", n.id);
    }
    for (const url of extractUrls(n.styles.backgroundImage)) {
      push(url, "background-image", n.id);
    }
    for (const child of n.children) walk(child);
  };

  walk(root);
  if (metadata.favicon) push(metadata.favicon, "favicon");
  if (metadata.ogImage) push(metadata.ogImage, "background-image");
  for (const face of fontFaces) {
    for (const source of face.sources) push(source.url, "font");
  }
  return out;
}

function absolutize(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return null;
  if (trimmed.startsWith("blob:")) return null;
  // SVG <use href="#id"> and similar fragment-only references resolve
  // against the base URL and produce a "https://host/%23id" which is not
  // a real asset. Filter them out.
  if (trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.pathname.startsWith("/%23") || url.pathname === "/" + url.hash.slice(1)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parseSrcset(value: string): readonly string[] {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((u): u is string => Boolean(u && !u.startsWith("data:")));
}
