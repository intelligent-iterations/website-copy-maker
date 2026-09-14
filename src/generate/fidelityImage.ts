import type { DesignNode } from "../normalize/types.js";
import type { FidelityCtx } from "./renderFidelity.js";
import { localize, localizeBackgroundImage } from "./utils/localize.js";
import { mergeStyle, spaces, jsonStyle, escapeAttr, px } from "./fidelityStyles.js";

const SCREENSHOT_MIN_W = 1400;
const SCREENSHOT_MIN_H = 1500;

export function renderFlatImage(
  node: DesignNode,
  section: DesignNode,
  ctx: FidelityCtx,
  baseStyle: Record<string, string | number>,
  indent: number,
): string {
  const src = node.src ?? null;
  if (!src) {
    // Src-less image-type node - typically an inline <svg> whose markup
    // was converted to a data: URL background-image in extractDom. Emit
    // it as a decorative div so the icon renders.
    const bg = backgroundImageStyle(node, ctx);
    if (!bg) return "";
    const style = mergeStyle(baseStyle, {
      ...bg,
      display: "block",
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
    return `${spaces(indent)}<div style={${jsonStyle(style)}} />`;
  }
  // Inline SVG data: URLs are allowed (the integrity check only rejects
  // base64 image rasters). normalizeTree may have promoted the SVG bg
  // image to `src`; emit it as a decorative div with backgroundImage so
  // the SVG icon renders at the right rect.
  if (/^data:image\/svg\+xml[,;]/i.test(src)) {
    const style = mergeStyle(baseStyle, {
      backgroundImage: `url("${src}")`,
      display: "block",
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
    return `${spaces(indent)}<div style={${jsonStyle(style)}} />`;
  }
  if (/^(data|blob):/i.test(src)) return "";
  const local = localize(src, ctx.assetMap);
  if (!local || !local.startsWith("/")) return "";
  // Reject full-page-screenshot-sized rasters. Section-fill is fine;
  // page-fill is the cheat we're guarding against.
  void section;
  if (node.rect.width >= SCREENSHOT_MIN_W && node.rect.height >= SCREENSHOT_MIN_H) {
    return "";
  }
  // Zero-rect images: lazy-load probably didn't fire even after the
  // scroll-walk pass. Fall back to natural dimensions so the image
  // renders at a sane size instead of being a 0×0 ghost.
  const fallbackStyle = applyZeroRectFallback(node, baseStyle);
  const alt = escapeAttr(node.text ?? "");
  const extras: Record<string, string | number> = { display: "block", maxWidth: "100%" };
  if (node.style.borderRadius) extras.borderRadius = node.style.borderRadius;
  // Note: transforms are NOT applied to the <img> itself. When a source
  // places the image inside a transformed wrapper div, the image is laid
  // out unrotated in its own box, then the wrapper rotates the whole
  // rectangle. Applying the transform to the <img> directly produces a
  // sub-pixel-different rasterization (the rotated image is sampled vs
  // the rotated box of an unrotated image). The wrapper-emit path below
  // handles transforms correctly.
  if (node.style.boxShadow) extras.boxShadow = node.style.boxShadow;
  // object-fit is critical: when display aspect ≠ natural aspect (e.g. a
  // 1440x600 banner cropped from 1440x959 source), browser default
  // object-fit:fill stretches the pixels. We propagate the source value
  // verbatim. If the source didn't set objectFit but the aspect ratios
  // diverge, default to cover for full-bleed images.
  //
  // BUT: if the IMG's CSS layout box (offsetWidth/Height) matches its
  // natural dimensions, the image is at its true intrinsic size - no
  // scaling, no cover needed. Don't trigger cover solely from a visual
  // bounding box enlarged by an ancestor transform.
  const sourceFit = node.style.objectFit;
  const naturalAspect =
    node.naturalWidth && node.naturalHeight ? node.naturalWidth / node.naturalHeight : null;
  const displayAspect =
    node.rect.width > 0 && node.rect.height > 0 ? node.rect.width / node.rect.height : null;
  const cssMatchesNatural =
    node.cssWidth !== undefined &&
    node.cssHeight !== undefined &&
    node.naturalWidth !== undefined &&
    node.naturalHeight !== undefined &&
    Math.abs(node.cssWidth - node.naturalWidth) < 2 &&
    Math.abs(node.cssHeight - node.naturalHeight) < 2;
  const aspectMismatch =
    naturalAspect !== null &&
    displayAspect !== null &&
    Math.abs(naturalAspect - displayAspect) / Math.max(naturalAspect, displayAspect) > 0.05;
  if (sourceFit) {
    extras.objectFit = sourceFit;
  } else if (aspectMismatch && !cssMatchesNatural) {
    extras.objectFit = "cover";
  }
  if (node.style.objectPosition) extras.objectPosition = node.style.objectPosition;
  const style = mergeStyle(fallbackStyle, extras);
  // Explicit HTML width/height attributes stabilize the browser's
  // intrinsic-size handling. Without
  // them, Chrome occasionally picks a slightly different rasterization
  // path for the same source bytes, accumulating sub-pixel diffs that
  // the tile gate sees. Use the rendered rect if present, else the
  // natural dimensions.
  const widthAttr = Math.round(node.rect.width > 0 ? node.rect.width : (node.naturalWidth ?? 0));
  const heightAttr = Math.round(
    node.rect.height > 0 ? node.rect.height : (node.naturalHeight ?? 0),
  );
  const dimAttrs =
    widthAttr > 0 && heightAttr > 0 ? ` width="${widthAttr}" height="${heightAttr}"` : "";

  // If there's a transform (composed from ancestors + own), wrap the image
  // in a transformed div with the image laid out inside unrotated. This
  // emission shape keeps the rasterization paths
  // align. The img inherits position from the wrapper (so we strip
  // position from the inner img and put it on the wrapper).
  //
  // KEY: when the IMG has a known CSS layout size (cssWidth/cssHeight)
  // that differs from rect.width/height, the wrapper should be sized to
  // the CSS box (NOT the post-transform visual bbox). Position is
  // shifted so rotation around the wrapper's center keeps the visual
  // bbox at the originally-extracted rect. Without this, our wrapper
  // ends up ~16% larger than source's, scaling the inner image.
  const composedTransform = (style.transform as string | undefined) ?? null;
  if (composedTransform) {
    const cssW = node.cssWidth && node.cssWidth > 0 ? node.cssWidth : null;
    const cssH = node.cssHeight && node.cssHeight > 0 ? node.cssHeight : null;
    const visualW = node.rect.width;
    const visualH = node.rect.height;
    const wrapperW = cssW ?? visualW;
    const wrapperH = cssH ?? visualH;
    // Compensate position so the rotated wrapper's visual bbox stays at
    // the originally-extracted rect (assumes the default 50% 50%
    // transform-origin).
    const dx = (visualW - wrapperW) / 2;
    const dy = (visualH - wrapperH) / 2;
    const left = node.rect.x + dx;
    const top = node.rect.y + dy;
    const wrapperStyle: Record<string, string | number> = {
      position: style.position ?? "absolute",
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(wrapperW)}px`,
      height: `${Math.round(wrapperH)}px`,
      transform: composedTransform,
    };
    if (style.zIndex !== undefined) wrapperStyle.zIndex = style.zIndex;
    const innerStyle: Record<string, string | number> = {
      width: "100%",
      height: "100%",
      display: "block",
      maxWidth: "100%",
    };
    if (extras.objectFit) innerStyle.objectFit = extras.objectFit as string;
    if (extras.objectPosition) innerStyle.objectPosition = extras.objectPosition as string;
    if (node.style.borderRadius) innerStyle.borderRadius = node.style.borderRadius;
    const innerW = cssW ?? widthAttr;
    const innerH = cssH ?? heightAttr;
    const innerDimAttrs =
      innerW > 0 && innerH > 0
        ? ` width="${Math.round(innerW)}" height="${Math.round(innerH)}"`
        : "";
    return (
      `${spaces(indent)}<div style={${jsonStyle(wrapperStyle)}}>\n` +
      `${spaces(indent + 2)}<img src="${local}"${innerDimAttrs} alt="${alt}" style={${jsonStyle(innerStyle)}} />\n` +
      `${spaces(indent)}</div>`
    );
  }

  return `${spaces(indent)}<img src="${local}"${dimAttrs} alt="${alt}" style={${jsonStyle(style)}} />`;
}

/**
 * Fallback for images whose rect was zero at extraction time (lazy-load
 * triggered too late). If we have natural dimensions, use them so the image
 * gets a real size in the rendered output. Position stays at the rect's
 * possibly stale left/top; image coverage and visual comparison catch a
 * missing result.
 */
function applyZeroRectFallback(
  node: DesignNode,
  baseStyle: Record<string, string | number>,
): Record<string, string | number> {
  if (node.rect.width > 0 && node.rect.height > 0) return baseStyle;
  if (!node.naturalWidth || !node.naturalHeight) return baseStyle;
  return {
    ...baseStyle,
    width: px(node.naturalWidth),
    height: px(node.naturalHeight),
  };
}

export function backgroundImageStyle(
  node: DesignNode,
  ctx: FidelityCtx,
): Record<string, string | number> | null {
  const bg = node.style.backgroundImage;
  if (!bg || bg === "none") return null;
  // Resolve any url() references against the asset map. data:image/svg+xml
  // URIs pass through unchanged (they're inline SVG, not a remote raster
  // - anti-cheat only rejects base64 image rasters).
  const localized = localizeBackgroundImage(bg, ctx.assetMap);
  if (!localized) return null;
  return { backgroundImage: localized };
}
