/**
 * Pure: replace a remote asset URL with its local /assets/<...> path if the
 * AssetMap has it. Used everywhere generators emit an image src or
 * background-image URL.
 */

import type { AssetMap } from "../../extract/downloadAssets.js";

export function localize(url: string | null | undefined, assetMap: AssetMap): string | null {
  if (!url) return null;
  return assetMap.get(url) ?? url;
}

/**
 * Same as `localize` but for inline CSS like `url("https://.../x.png")`.
 * Replaces every url(...) reference whose URL is in the map; leaves the
 * rest unchanged.
 */
export function localizeBackgroundImage(
  cssValue: string | null | undefined,
  assetMap: AssetMap,
): string | null {
  if (!cssValue) return null;
  return cssValue.replace(/url\((['"]?)([^'")]+)\1\)/g, (_match, quote, raw) => {
    const localized = assetMap.get(raw);
    if (!localized) return `url(${quote}${raw}${quote})`;
    return `url(${quote}${localized}${quote})`;
  });
}
