/**
 * Pure: walk an extracted DOM tree and collect every same-host URL we'd
 * want to rebuild as a separate route. Used by runAgent to do a depth-1
 * crawl of the source site so internal links land on real rebuilt pages,
 * not "/#anchor" placeholders.
 */

import type { ExtractedNode } from "../extract/types.js";
import { urlToRoutePath } from "./normalizeLinks.js";

export function discoverInternalUrls(args: {
  readonly root: ExtractedNode;
  readonly sourceUrl: string;
  readonly maxUrls?: number;
}): readonly string[] {
  const { root, sourceUrl } = args;
  const maxUrls = args.maxUrls ?? 24;

  const found = new Map<string, string>(); // routePath → absolute URL
  const visit = (n: ExtractedNode): void => {
    if (n.tag === "a" && n.href) {
      const absolute = absolutize(n.href, sourceUrl);
      if (absolute) {
        const routePath = urlToRoutePath(absolute, sourceUrl);
        if (routePath !== null && routePath !== "" && !found.has(routePath)) {
          found.set(routePath, stripHash(absolute));
        }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);

  return Array.from(found.values()).slice(0, maxUrls);
}

function absolutize(rawHref: string, sourceUrl: string): string | null {
  try {
    return new URL(rawHref, sourceUrl).toString();
  } catch {
    return null;
  }
}

function stripHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
