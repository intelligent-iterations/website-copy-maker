/**
 * Pure: emit a high-fidelity JSX rebuild of the entire visible DesignNode
 * tree. Activated when mode === "exact".
 *
 * Strategy: render every visible descendant FLATLY into the body, each
 * pinned to its page-coordinate `rect` via position: absolute. This ignores
 * the source's nested DOM hierarchy entirely; the *positions* are what
 * matter for fidelity, not the wrapper graph.
 *
 * Why: the source uses nested position-relative wrappers + absolute
 * children whose `left`/`top` are computed against the nearest positioned
 * ancestor. Recreating that nesting faithfully is fragile (every ancestor's
 * flexbox/padding/transform shifts the children's resolved coords). Pinning
 * to absolute page coordinates sidesteps the whole problem and produces a
 * 1:1 spatial match.
 *
 * Anti-cheat is enforced by construction:
 *   - Every text node renders as a real <h*>/<p> with the source's text.
 *   - <img> tags reference downloaded /assets/ paths only; data:/blob:/
 *     remote URIs are dropped.
 *   - <img> whose width AND height are >=70% of its parent section is
 *     dropped - that's the "screenshot embedded as content" cheat.
 */

import type { AssetMap } from "../extract/downloadAssets.js";
import type { DesignNode } from "../normalize/types.js";
import { rewriteHref } from "../normalize/normalizeLinks.js";
import { localize, localizeBackgroundImage } from "./utils/localize.js";
import {
  composeTransforms,
  positionStyle,
  typeStyle,
  buttonExtras,
  decorativeStyle,
  mergeStyle,
  chooseTag,
  isVisible,
  hasVisibleDescendant,
  px,
  jsonStyle,
  spaces,
  escape,
  escapeAttr,
} from "./fidelityStyles.js";
import { renderFlatImage, backgroundImageStyle } from "./fidelityImage.js";

export type FidelityCtx = {
  readonly sourceUrl: string;
  readonly assetMap: AssetMap;
};

export function renderFidelity(root: DesignNode, ctx: FidelityCtx, indent = 8): string {
  const flat = collectFlatNodes(root);
  const inner = flat
    .map((entry) => renderFlatNode(entry, ctx, root, indent))
    .filter(Boolean)
    .join("\n");
  // Two-tier shell so the page scales down to fit narrower viewports
  // instead of clipping. Globals.css carries the matching media query:
  //   @media (max-width: <canvas-w>) {
  //     .fidelity-canvas-outer { height: calc(var(--canvas-h) * 1px * (100vw / var(--canvas-w))); }
  //     .fidelity-canvas-inner { transform: scale(calc(100vw / var(--canvas-w))); }
  //   }
  // Outer carries the variables; inner is the original 1440-wide layout
  // canvas with all absolute children pinned to source coordinates.
  const canvasW = Math.round(root.rect.width);
  const canvasH = Math.round(root.rect.height);
  // The CSS custom properties --canvas-w / --canvas-h drive the
  // viewport-scaling math in globals.css. React's strict CSSProperties
  // types reject `--*` keys at compile time even though they're valid at
  // runtime, so cast through React.CSSProperties on this one wrapper.
  // Emit the custom props as `<N>px` strings, NOT bare numbers. CSS
  // calc() needs them as lengths so `100vw / var(--canvas-w)` produces
  // a unitless ratio (length / length = number) usable in transform:scale.
  // With bare numbers the result is a length and scale(<length>) is
  // invalid syntax - the browser falls back to no transform, which is
  // why the scaling shell rendered as a no-op until now.
  const outerStyle = jsonStyle({
    "--canvas-w": `${canvasW}px`,
    "--canvas-h": `${canvasH}px`,
  });
  const innerStyle = jsonStyle({
    position: "relative",
    width: px(canvasW),
    minHeight: px(canvasH),
    backgroundColor: root.style.backgroundColor ?? "transparent",
  });
  // React's strict CSSProperties type rejects custom properties
  // (`--canvas-w`, `--canvas-h`) at compile time even though they're valid
  // at runtime. The cast bypasses the typecheck without requiring a
  // `React` import in the generated page.
  return `      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div className="fidelity-canvas-outer" style={${outerStyle} as any}>
        <div className="fidelity-canvas-inner" style={${innerStyle}}>
${inner}
        </div>
      </div>`;
}

type FlatEntry = {
  node: DesignNode;
  section: DesignNode;
  /** Ancestor transforms (outer-to-inner) that should compose onto this leaf. */
  ancestorTransforms: readonly string[];
  /** Effective z-index inherited from the nearest stacking-context ancestor
   * (max along the chain). Used to recreate source z-stacking after the
   * tree is flattened: the source's white "Despite evidence..." heading sits in
   * a wrapper with z-index:1 above a sibling overlay; without propagating
   * that into the flat emit, the overlay paints over the text. */
  effectiveZ: number;
};

function collectFlatNodes(root: DesignNode): FlatEntry[] {
  const out: FlatEntry[] = [];
  const visit = (
    n: DesignNode,
    currentSection: DesignNode,
    ancestorTransforms: readonly string[],
    inheritedZ: number,
    inTextAncestor: boolean,
  ): void => {
    if (!isVisible(n)) {
      if (hasVisibleDescendant(n)) {
        for (const c of n.children)
          visit(c, currentSection, ancestorTransforms, inheritedZ, inTextAncestor);
      }
      return;
    }
    // Inline text inside a text-bearing ancestor (e.g. `<strong>` inside
    // `<p>`) is already part of the parent's rendered text. Emitting it
    // again places it on top of the parent at the same coordinates, which
    // looks like overlapping double-text in the rebuild (visible on
    // bullet lists where the bold word stacks over the line). Skip
    // descendants of a text emit unless they're block-level content
    // (image / video / button / link).
    if (
      inTextAncestor &&
      (n.type === "text" || n.type === "container") &&
      !hasMediaOrLinkDescendant(n)
    ) {
      return;
    }
    const nextSection = n.type === "section" ? n : currentSection;
    // Accumulate transforms from non-leaf ancestors so leaves can inherit
    // the source's wrapper rotations / scales.
    const nextTransforms =
      n.style.transform && n.style.transform !== "none"
        ? [...ancestorTransforms, n.style.transform]
        : ancestorTransforms;
    const ownZ =
      n.style.zIndex !== undefined && Number.isFinite(n.style.zIndex) ? n.style.zIndex : null;
    const nextZ = ownZ !== null ? Math.max(inheritedZ, ownZ) : inheritedZ;

    if ((n.type === "link" || n.type === "button") && hasRichDescendants(n)) {
      out.push({ node: n, section: nextSection, ancestorTransforms, effectiveZ: nextZ });
      for (const c of n.children) visit(c, nextSection, nextTransforms, nextZ, inTextAncestor);
      return;
    }

    if (isLeafForFlat(n)) {
      out.push({ node: n, section: nextSection, ancestorTransforms, effectiveZ: nextZ });
      const isMediaLeaf = n.type === "image" || n.type === "video";
      const isLinkButtonLeaf = (n.type === "link" || n.type === "button") && !hasRichDescendants(n);
      if (!isMediaLeaf && !isLinkButtonLeaf) {
        // Track text-emitting ancestor so inline text descendants get
        // skipped (their text is already part of this node's emit).
        const childrenInText = inTextAncestor || (n.type === "text" && !!n.text?.trim());
        for (const c of n.children) visit(c, nextSection, nextTransforms, nextZ, childrenInText);
      }
      return;
    }
    const ownText = !!(n.text && n.text.trim().length > 0);
    if (ownText) {
      out.push({ node: n, section: nextSection, ancestorTransforms, effectiveZ: nextZ });
    }
    const childrenInText = inTextAncestor || ownText;
    for (const c of n.children) visit(c, nextSection, nextTransforms, nextZ, childrenInText);
  };
  visit(root, root, [], 0, false);
  return out;
}

function hasMediaOrLinkDescendant(n: DesignNode): boolean {
  if (n.type === "image" || n.type === "video" || n.type === "link" || n.type === "button") {
    return true;
  }
  for (const c of n.children) {
    if (hasMediaOrLinkDescendant(c)) return true;
  }
  return false;
}

/**
 * A link/button has "rich descendants" if it wraps at least one image,
 * heading, or paragraph that we'd want to render in its own right. An
 * image-backed link with no text or content children is the opposite: render
 * the link itself as a leaf so its background remains visible.
 */
function hasRichDescendants(n: DesignNode): boolean {
  for (const c of n.children) {
    if (!isVisible(c)) {
      if (hasRichDescendants(c)) return true;
      continue;
    }
    if (c.type === "image" || c.type === "video") return true;
    if (c.type === "text" && c.text && c.text.trim().length > 0) return true;
    if (hasRichDescendants(c)) return true;
  }
  return false;
}

function isLeafForFlat(n: DesignNode): boolean {
  if (n.type === "image" || n.type === "video") return true;
  if (n.type === "link" || n.type === "button") return true;
  // Text nodes: only act as leaves when they have actual text content.
  // Empty <p> wrappers around inner <a>Home</a> tags are normalized to
  // type="text" but their `text` is empty - the text is inside the child
  // `<a>`. Treating them as leaves would emit nothing and drop the inner
  // anchor. Recurse instead.
  if (n.type === "text" && n.text && n.text.trim().length > 0) return true;
  // Containers with no children but background / border styling (decorative
  // bands or icon buttons backed by background-image SVGs) get emitted too.
  if (
    n.children.length === 0 &&
    (n.style.backgroundColor ||
      n.style.backgroundImage ||
      n.style.borderRadius ||
      n.style.boxShadow)
  ) {
    return true;
  }
  // Containers whose ONLY purpose is to hold a background-image (SVG icon,
  // CSS-only decorative element). These have visible visual effect even
  // when their children are zero or non-renderable.
  if (n.style.backgroundImage && hasNonNoneBackground(n.style.backgroundImage)) {
    return true;
  }
  // Containers with a visible background-color treatment AND children
  // (card wrappers - a colored rounded rect that contains an
  // image + heading + paragraph). Emit them as a leaf so the card bg
  // renders, then the visit logic will continue into children so the
  // content paints on top. Skips fully-transparent backgrounds and the
  // page's own canvas color (which is already painted by the body).
  if (
    n.children.length > 0 &&
    n.style.backgroundColor &&
    n.style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
    n.style.backgroundColor !== "transparent"
  ) {
    return true;
  }
  // Containers with rounded corners or a box-shadow but no bg-color - also
  // a card wrapper pattern (e.g. white card with shadow on a colored page).
  if (
    n.children.length > 0 &&
    ((n.style.borderRadius && n.style.borderRadius !== "0px") ||
      (n.style.boxShadow && n.style.boxShadow !== "none"))
  ) {
    return true;
  }
  return false;
}

function hasNonNoneBackground(value: string): boolean {
  return value !== "none" && value.trim().length > 0;
}

/** True when the source rendered the node's text on a single line (rect
 * height is close to its line-height). Used to emit `whiteSpace: nowrap`
 * so the rebuild can't wrap the same text differently due to sub-pixel
 * font metric drift. */
function isSingleLineText(n: DesignNode): boolean {
  if (!n.text) return false;
  const fontSize = n.style.fontSize ?? 0;
  if (!fontSize) return false;
  const lh = parseLineHeight(n.style.lineHeight, fontSize);
  if (lh <= 0) return false;
  // 1.3x tolerance to absorb descender/ascender padding.
  return n.rect.height <= lh * 1.3;
}

function parseLineHeight(lh: string | number | undefined, fontSize: number): number {
  if (lh === undefined) return fontSize * 1.2;
  if (typeof lh === "number") return lh;
  if (lh === "normal") return fontSize * 1.2;
  const numeric = parseFloat(lh);
  if (Number.isFinite(numeric)) {
    if (lh.endsWith("px")) return numeric;
    return numeric > 4 ? numeric : numeric * fontSize;
  }
  return fontSize * 1.2;
}

function renderFlatNode(
  entry: FlatEntry,
  ctx: FidelityCtx,
  root: DesignNode,
  indent: number,
): string {
  const { node, section, ancestorTransforms, effectiveZ } = entry;
  const baseStyle = positionStyle(node, root);
  // Compose accumulated ancestor transforms with the node's own transform
  // so wrapper rotations reach the rendered leaf.
  const ownTransform =
    node.style.transform && node.style.transform !== "none" ? node.style.transform : null;
  const combinedTransform = composeTransforms(
    [...ancestorTransforms, ownTransform].filter(Boolean) as string[],
  );
  if (combinedTransform) baseStyle.transform = combinedTransform;
  // Propagate effective z-index so leaves stack like the source did even
  // after we flatten the wrapper hierarchy. Skip 0 (the default).
  if (effectiveZ !== 0) baseStyle.zIndex = effectiveZ;

  if (node.type === "image") {
    return renderFlatImage(node, section, ctx, baseStyle, indent);
  }
  if (node.type === "video") {
    return renderFlatVideo(node, ctx, baseStyle, indent);
  }
  if (node.type === "link") {
    return renderFlatLink(node, ctx, baseStyle, indent);
  }
  if (node.type === "button") {
    return renderFlatButton(node, ctx, baseStyle, indent);
  }
  if (node.type === "text" || node.text) {
    const rawText = node.text ?? "";
    if (!rawText) return "";
    const tag = chooseTag(node);
    const extras: Record<string, string | number> = { ...typeStyle(node) };
    // Hard line breaks: if the extracted text contains \n (preserved
    // from source <br> elements), we MUST render with whiteSpace
    // pre-line / pre-wrap so the breaks survive. Source element's
    // own whiteSpace (if any) wins; otherwise default to pre-line.
    const hasHardBreak = rawText.includes("\n");
    if (hasHardBreak && !extras.whiteSpace) {
      extras.whiteSpace = "pre-line";
    }
    // If the source rendered this text on a single line (rect height is
    // close to one line-height), force `whiteSpace: nowrap` so the
    // rebuild can't wrap it. Captured rect.width is the post-layout
    // rendered width - sub-pixel font metric drift makes the same text
    // wrap differently in the rebuild even with identical styling.
    if (!hasHardBreak && !extras.whiteSpace && isSingleLineText(node)) {
      extras.whiteSpace = "nowrap";
    }
    const style = mergeStyle(baseStyle, extras);
    // Rich text: emit each chunk inline. Plain chunks go in as JSX
    // string expressions; chunks with overrides (color/font-weight/etc.)
    // are wrapped in `<span style="...">`. This preserves source's
    // inline highlighting like `<span style="color:red">demo</span>`.
    if (node.richText && node.richText.length > 0) {
      const inner = node.richText
        .map((c) => {
          const spanStyle: Record<string, string | number> = {};
          if (c.color) spanStyle.color = c.color;
          if (c.fontWeight) spanStyle.fontWeight = c.fontWeight;
          if (c.fontStyle) spanStyle.fontStyle = c.fontStyle;
          const hasStyle = Object.keys(spanStyle).length > 0;
          // Inline anchor: emit `<a>` with href so the link is part of
          // the text run instead of a separately-positioned absolute node.
          if (c.href) {
            const href = escapeAttr(rewriteHref(c.href, ctx.sourceUrl));
            const styleAttr = hasStyle ? ` style={${jsonStyle(spanStyle)}}` : "";
            return `<a href="${href}"${styleAttr}>{${JSON.stringify(c.text)}}</a>`;
          }
          if (hasStyle) {
            return `<span style={${jsonStyle(spanStyle)}}>{${JSON.stringify(c.text)}}</span>`;
          }
          return `{${JSON.stringify(c.text)}}`;
        })
        .join("");
      return `${spaces(indent)}<${tag} style={${jsonStyle(style)}}>${inner}</${tag}>`;
    }
    // Use a JSX string expression so explicit whitespace survives.
    // JSX text nodes collapse multiple spaces and newlines; the source's
    // intentional spacing (e.g. `🍎   demo`) gets lost without an
    // expression. Plain text without breaks or extra spacing goes straight in.
    const hasExplicitSpacing = /( {2,}|\t)/.test(rawText);
    if (hasHardBreak || hasExplicitSpacing) {
      return `${spaces(indent)}<${tag} style={${jsonStyle(style)}}>{${JSON.stringify(rawText)}}</${tag}>`;
    }
    return `${spaces(indent)}<${tag} style={${jsonStyle(style)}}>${escape(rawText)}</${tag}>`;
  }
  // Decorative band - possibly with a background-image (icon button-style
  // div). Localize the background-image url() if it points at a downloaded
  // asset; data:image/svg+xml URIs flow through unchanged.
  const decoExtras: Record<string, string | number> = { ...decorativeStyle(node) };
  const bg = backgroundImageStyle(node, ctx);
  if (bg) {
    Object.assign(decoExtras, bg);
    decoExtras.backgroundSize = decoExtras.backgroundSize ?? "contain";
    decoExtras.backgroundRepeat = decoExtras.backgroundRepeat ?? "no-repeat";
    decoExtras.backgroundPosition = decoExtras.backgroundPosition ?? "center";
  }
  const style = mergeStyle(baseStyle, decoExtras);
  return `${spaces(indent)}<div style={${jsonStyle(style)}} />`;
}

function renderFlatLink(
  node: DesignNode,
  ctx: FidelityCtx,
  baseStyle: Record<string, string | number>,
  indent: number,
): string {
  const href = escapeAttr(rewriteHref(node.href ?? "#", ctx.sourceUrl));
  const txt = escape(node.text ?? "");
  const bg = backgroundImageStyle(node, ctx);
  // Click-overlay path: link wraps rich content (image/heading/etc.). The
  // descendants emit themselves; we just provide a transparent click target
  // that covers the link's rect, on top so it captures clicks.
  if (!txt && !bg && hasRichDescendants(node)) {
    const style = mergeStyle(baseStyle, {
      display: "block",
      textDecoration: "none",
      zIndex: 1,
    });
    return `${spaces(indent)}<a href="${href}" aria-label="${escapeAttr(deriveLinkLabel(node))}" style={${jsonStyle(style)}} />`;
  }
  if (!txt && !bg) return "";
  const extras: Record<string, string | number> = { ...typeStyle(node), ...bg };
  if (!txt && bg) {
    extras.display = "block";
    extras.backgroundSize = "contain";
    extras.backgroundRepeat = "no-repeat";
    extras.backgroundPosition = "center";
    extras.textDecoration = "none";
  }
  const style = mergeStyle(baseStyle, extras);
  if (!txt) {
    return `${spaces(indent)}<a href="${href}" aria-label="${escapeAttr(deriveLinkLabel(node))}" style={${jsonStyle(style)}} />`;
  }
  return `${spaces(indent)}<a href="${href}" style={${jsonStyle(style)}}>${txt}</a>`;
}

/**
 * Pick a reasonable accessible label for a link/button that has no own
 * text. Looks at the first heading-or-paragraph descendant for a name;
 * falls back to "link".
 */
function deriveLinkLabel(node: DesignNode): string {
  const stack = [...node.children];
  while (stack.length) {
    const c = stack.shift()!;
    if (c.type === "text" && c.text && c.text.trim().length > 0) return c.text.trim();
    stack.push(...c.children);
  }
  return "link";
}

function renderFlatButton(
  node: DesignNode,
  ctx: FidelityCtx,
  baseStyle: Record<string, string | number>,
  indent: number,
): string {
  const href = escapeAttr(rewriteHref(node.href ?? "#", ctx.sourceUrl));
  const txt = escape(node.text ?? "");
  const bg = backgroundImageStyle(node, ctx);
  if (!txt && !bg && hasRichDescendants(node)) {
    const style = mergeStyle(baseStyle, {
      display: "block",
      textDecoration: "none",
      zIndex: 1,
    });
    return `${spaces(indent)}<a href="${href}" aria-label="${escapeAttr(deriveLinkLabel(node))}" style={${jsonStyle(style)}} />`;
  }
  if (!txt && !bg) return "";
  if (!txt && bg) {
    const style = mergeStyle(baseStyle, {
      ...bg,
      display: "block",
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      textDecoration: "none",
    });
    return `${spaces(indent)}<a href="${href}" aria-label="${escapeAttr(deriveLinkLabel(node))}" style={${jsonStyle(style)}} />`;
  }
  const style = mergeStyle(baseStyle, buttonExtras(node));
  return `${spaces(indent)}<a href="${href}" style={${jsonStyle(style)}}>${txt}</a>`;
}

function renderFlatVideo(
  node: DesignNode,
  ctx: FidelityCtx,
  baseStyle: Record<string, string | number>,
  indent: number,
): string {
  const src = node.src ?? null;
  if (!src) return "";
  if (/^(data|blob):/i.test(src)) return "";
  const local = localize(src, ctx.assetMap);
  if (!local || !local.startsWith("/")) return "";
  const style = mergeStyle(baseStyle, { display: "block" });
  return `${spaces(indent)}<video src="${local}" controls playsInline style={${jsonStyle(style)}} />`;
}

// Re-export for the patch loop
export { localizeBackgroundImage };
