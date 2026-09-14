/**
 * Collect distinct font-family declarations seen across the extracted tree.
 * The first-mentioned family in each stack is treated as the primary; the
 * rest are fallbacks.
 */

import type { ExtractedNode } from "./types.js";

export function extractFonts(root: ExtractedNode): readonly string[] {
  const counts = new Map<string, number>();

  const walk = (n: ExtractedNode): void => {
    const family = n.styles.fontFamily;
    if (family) {
      const primary = family
        .split(",")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "");
      if (primary) counts.set(primary, (counts.get(primary) ?? 0) + 1);
    }
    for (const child of n.children) walk(child);
  };
  walk(root);

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}
