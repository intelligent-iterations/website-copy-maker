/**
 * Pure: emit a JSX string for a section's children based on the *measured*
 * structure of the source page. This replaces fixed-shape section templates
 * that ignored every spatial signal we captured.
 *
 * Responsibilities:
 *   - Render real HTML elements (h1..h3, p, a, button, img, ul/li) - never
 *     embed screenshots, never produce base64 image content.
 *   - Localize image src via the AssetMap so the copy is portable.
 *   - Rewrite same-host hrefs via rewriteHref so links don't bounce back to
 *     the source domain.
 *   - Use measured fontSize / fontWeight as Tailwind arbitrary values for
 *     type fidelity.
 *   - Choose grid column count from sibling counts and median width.
 *   - Choose two-column flex when an image is >= 30% of the section width.
 *   - Reject "section-as-image" by treating any image whose width AND height
 *     are >= 70% of the section's as decorative / cropped to a sane size.
 */

import type { AssetMap } from "../extract/downloadAssets.js";
import type { DesignNode } from "../normalize/types.js";
import { rewriteHref } from "../normalize/normalizeLinks.js";
import { localize, localizeBackgroundImage } from "./utils/localize.js";
import type { Mode } from "../agent/thresholds.js";

export type RenderCtx = {
  readonly sourceUrl: string;
  readonly assetMap: AssetMap;
  readonly mode: Mode;
};

export function renderSection(node: DesignNode, ctx: RenderCtx): string {
  const inner = renderChildren(node, ctx, 4);
  const padding = paddingClass(node);
  const wrapperClass = ["py-12 md:py-16", padding].filter(Boolean).join(" ");
  return `      <section className="${wrapperClass}">
        <div className="mx-auto w-full max-w-page px-6 md:px-8">
${inner}
        </div>
      </section>`;
}

export function renderChildren(node: DesignNode, ctx: RenderCtx, indent: number): string {
  // Flatten away zero-rect ghost wrappers. Their immediate children carry
  // real positions and content,
  // so we surface them as direct children rather than filtering the whole
  // subtree out via the standard visibility check.
  const visible = collectVisibleChildren(node);
  if (visible.length === 0) return renderLeaf(node, ctx, indent);

  // Repeating-card grid: 3+ similarly-sized siblings with text content.
  if (looksLikeGrid(visible)) {
    const cols = clamp(
      Math.round(node.rect.width / median(visible.map((c) => c.rect.width))),
      1,
      4,
    );
    const cells = visible.map((c) => renderGridCell(c, ctx, indent + 2)).join("\n");
    return (
      spaces(indent) +
      `<ul className="grid gap-6 md:grid-cols-${cols}">\n${cells}\n${spaces(indent)}</ul>`
    );
  }

  // Two-column: image + text where image dominates ≥30% of section width.
  if (visible.length === 2) {
    const imgIdx = visible.findIndex((c) => isLargeImage(c, node));
    if (imgIdx !== -1) {
      const img = visible[imgIdx]!;
      const other = visible[1 - imgIdx]!;
      const left = imgIdx === 0 ? img : other;
      const right = imgIdx === 0 ? other : img;
      return [
        spaces(indent) + `<div className="grid items-center gap-10 md:grid-cols-2">`,
        renderChild(left, ctx, indent + 2),
        renderChild(right, ctx, indent + 2),
        spaces(indent) + `</div>`,
      ].join("\n");
    }
  }

  // Default: stacked vertical flow. Render each child in source order.
  return visible.map((c) => renderChild(c, ctx, indent)).join("\n");
}

function renderChild(child: DesignNode, ctx: RenderCtx, indent: number): string {
  switch (child.type) {
    case "text":
      return renderText(child, indent);
    case "image":
      return renderImage(child, ctx, indent);
    case "video":
      return renderVideo(child, ctx, indent);
    case "link":
      return renderLink(child, ctx, indent);
    case "button":
      return renderButton(child, ctx, indent);
    default: {
      // Container / stack / grid / card / decorative / unknown
      const inner = renderChildren(child, ctx, indent + 2);
      const className = containerClass(child);
      const tag = child.type === "card" ? "li" : "div";
      return [
        spaces(indent) + `<${tag} className="${className}">`,
        inner || spaces(indent + 2) + renderTextLeaf(child),
        spaces(indent) + `</${tag}>`,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
}

function renderGridCell(cell: DesignNode, ctx: RenderCtx, indent: number): string {
  const inner = renderChildren(cell, ctx, indent + 2);
  return [
    spaces(indent) + `<li className="rounded-card bg-white/60 p-6 shadow-soft">`,
    inner,
    spaces(indent) + `</li>`,
  ].join("\n");
}

function renderLeaf(node: DesignNode, ctx: RenderCtx, indent: number): string {
  if (node.type === "text") return renderText(node, indent);
  if (node.type === "image") return renderImage(node, ctx, indent);
  return spaces(indent) + renderTextLeaf(node);
}

function renderText(node: DesignNode, indent: number): string {
  const text = escapeJsx(node.text ?? "");
  if (!text) return "";
  const tag = headingTagFor(node);
  const cls = textClassFor(node);
  return spaces(indent) + `<${tag} className="${cls}">${text}</${tag}>`;
}

function renderTextLeaf(node: DesignNode): string {
  const text = escapeJsx(node.text ?? "");
  return text ? `<span>${text}</span>` : "";
}

function renderImage(node: DesignNode, ctx: RenderCtx, indent: number): string {
  const src = node.src ?? null;
  if (!src) return "";
  // Anti-cheat: never emit data: or blob: URIs. The pipeline downloads
  // every image to /assets/<...>; if a data URI got this far, it means the
  // source had an inlined raster we don't want to ship as content.
  if (/^(data|blob):/i.test(src)) return "";
  const local = localize(src, ctx.assetMap);
  if (!local) return "";
  // If localize returned the original URL (not in the map), and the URL
  // points to a non-local domain, drop it - unresolved remote assets would
  // make the copy incomplete and environment-dependent.
  if (!local.startsWith("/")) return "";
  const alt = escapeAttr(siblingHeadingText(node) ?? "");
  // Anti-cheat: refuse only page-screenshot-sized rasters; legitimate
  // section-sized media is fine.
  const w = Math.max(1, Math.round(node.rect.width));
  const h = Math.max(1, Math.round(node.rect.height));
  if (w >= 1400 && h >= 1500) return "";
  return (
    spaces(indent) +
    `<img src="${local}" alt="${alt}" width={${w}} height={${h}} className="block max-w-full h-auto" />`
  );
}

function renderVideo(node: DesignNode, ctx: RenderCtx, indent: number): string {
  const src = node.src ?? null;
  const local = src ? localize(src, ctx.assetMap) : null;
  if (!local) return "";
  return (
    spaces(indent) +
    `<video src="${local}" controls playsInline className="block max-w-full h-auto" />`
  );
}

function renderLink(node: DesignNode, ctx: RenderCtx, indent: number): string {
  const text = escapeJsx(node.text ?? "");
  if (!text) return "";
  const href = escapeAttr(rewriteHref(node.href ?? "#", ctx.sourceUrl));
  return (
    spaces(indent) + `<a href="${href}" className="underline-offset-4 hover:underline">${text}</a>`
  );
}

function renderButton(node: DesignNode, ctx: RenderCtx, indent: number): string {
  const text = escapeJsx(node.text ?? "");
  if (!text) return "";
  const href = escapeAttr(rewriteHref(node.href ?? "#", ctx.sourceUrl));
  return (
    spaces(indent) +
    `<a href="${href}" className="inline-flex h-12 items-center justify-center rounded-full bg-ink px-6 text-sm font-semibold text-white transition hover:bg-ink/90">${text}</a>`
  );
}

// ── helpers ──

function isVisible(n: DesignNode): boolean {
  if (n.rect.width <= 0 || n.rect.height <= 0) return false;
  if (n.style.opacity !== undefined && n.style.opacity === 0) return false;
  return true;
}

/**
 * Walk children once, eliding zero-rect "ghost" wrappers (responsive
 * stand-ins, deferred placeholders, etc.) by recursing into
 * them and surfacing the first layer of visible descendants. Stops at the
 * first visible layer per branch so we don't strip real wrappers.
 */
function collectVisibleChildren(node: DesignNode): readonly DesignNode[] {
  const out: DesignNode[] = [];
  const stack = [...node.children];
  while (stack.length) {
    const c = stack.shift()!;
    if (isVisible(c)) {
      out.push(c);
    } else if (hasVisibleDescendant(c)) {
      stack.unshift(...c.children);
    }
  }
  return out;
}

function hasVisibleDescendant(n: DesignNode): boolean {
  if (n.text && n.text.length > 0) return true;
  for (const c of n.children) {
    if (isVisible(c)) return true;
    if (hasVisibleDescendant(c)) return true;
  }
  return false;
}

function isLargeImage(child: DesignNode, parent: DesignNode): boolean {
  if (child.type !== "image") return false;
  if (parent.rect.width <= 0) return false;
  return child.rect.width / parent.rect.width >= 0.3;
}

function looksLikeGrid(siblings: readonly DesignNode[]): boolean {
  const cards = siblings.filter((c) => c.type === "card" || c.type === "container");
  if (cards.length < 3) return false;
  const widths = cards.map((c) => c.rect.width);
  const heights = cards.map((c) => c.rect.height);
  const wRange = (Math.max(...widths) - Math.min(...widths)) / Math.max(1, Math.max(...widths));
  const hRange = (Math.max(...heights) - Math.min(...heights)) / Math.max(1, Math.max(...heights));
  return wRange < 0.25 && hRange < 0.4;
}

function headingTagFor(node: DesignNode): "h1" | "h2" | "h3" | "p" {
  const fs = node.style.fontSize ?? 0;
  if (node.metadata.isLikelyHeading) {
    if (fs >= 40) return "h1";
    if (fs >= 28) return "h2";
    return "h3";
  }
  if (fs >= 28) return "h2";
  if (fs >= 22) return "h3";
  return "p";
}

function textClassFor(node: DesignNode): string {
  const cls: string[] = [];
  if (node.style.fontSize) cls.push(`text-[${Math.round(node.style.fontSize)}px]`);
  if (node.style.fontWeight) {
    const weight =
      typeof node.style.fontWeight === "number" ? node.style.fontWeight : node.style.fontWeight;
    cls.push(`font-[${weight}]`);
  }
  if (node.style.lineHeight) {
    const lh = String(node.style.lineHeight).trim();
    if (lh && lh !== "normal" && !lh.includes(" ")) cls.push(`leading-[${lh}]`);
  }
  if (node.style.letterSpacing && node.style.letterSpacing !== "normal") {
    const ls = String(node.style.letterSpacing).trim();
    if (ls && !ls.includes(" ")) cls.push(`tracking-[${ls}]`);
  }
  if (node.style.color) cls.push(`text-[${cssColor(node.style.color)}]`);
  if (node.metadata.isLikelyHeading) cls.push("tracking-tight");
  return cls.join(" ");
}

function containerClass(node: DesignNode): string {
  const cls: string[] = [];
  if (node.layout.mode === "flex") {
    cls.push("flex");
    if (node.layout.direction === "column") cls.push("flex-col");
    // Tailwind v3 doesn't accept arbitrary values for items-/justify- -
    // map common CSS keywords to its predefined classes.
    const itemsClass = mapAlign(node.layout.align);
    if (itemsClass) cls.push(itemsClass);
    const justifyClass = mapJustify(node.layout.justify);
    if (justifyClass) cls.push(justifyClass);
    if (node.layout.gap) cls.push(`gap-[${node.layout.gap}px]`);
  } else if (node.layout.mode === "grid") {
    cls.push("grid");
    if (node.layout.gap) cls.push(`gap-[${node.layout.gap}px]`);
  }
  if (node.style.backgroundColor) cls.push(`bg-[${cssColor(node.style.backgroundColor)}]`);
  if (node.style.borderRadius && node.style.borderRadius !== "0px") {
    cls.push(`rounded-[${node.style.borderRadius}]`);
  }
  return cls.join(" ");
}

function mapAlign(align: string | undefined): string | null {
  switch (align) {
    case "center":
      return "items-center";
    case "flex-start":
    case "start":
      return "items-start";
    case "flex-end":
    case "end":
      return "items-end";
    case "baseline":
      return "items-baseline";
    case "stretch":
    case undefined:
      return null;
    default:
      return null;
  }
}

function mapJustify(justify: string | undefined): string | null {
  switch (justify) {
    case "center":
      return "justify-center";
    case "flex-start":
    case "start":
    case "normal":
      return "justify-start";
    case "flex-end":
    case "end":
      return "justify-end";
    case "space-between":
      return "justify-between";
    case "space-around":
      return "justify-around";
    case "space-evenly":
      return "justify-evenly";
    case undefined:
      return null;
    default:
      return null;
  }
}

function cssColor(value: string): string {
  // Tailwind arbitrary values can't contain spaces or commas. Convert
  // rgb(R, G, B) / rgba(R, G, B, A) to a hex / rgba(...) without spaces.
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(value);
  if (!rgba) return value;
  const r = Number(rgba[1]);
  const g = Number(rgba[2]);
  const b = Number(rgba[3]);
  const a = rgba[4] !== undefined ? Number(rgba[4]) : 1;
  if (a >= 1) {
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${r},${g},${b},${a})`;
}

function paddingClass(node: DesignNode): string {
  const p = node.layout.padding;
  if (!p) return "";
  const horiz = Math.max(p.left, p.right);
  const vert = Math.max(p.top, p.bottom);
  const cls: string[] = [];
  if (horiz > 0) cls.push(`px-[${horiz}px]`);
  if (vert > 0) cls.push(`py-[${vert}px]`);
  return cls.join(" ");
}

function siblingHeadingText(node: DesignNode): string | null {
  return node.text ?? null;
}

function spaces(n: number): string {
  return " ".repeat(n);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function escapeJsx(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

// Re-export for the patcher / fidelity renderer
export { localizeBackgroundImage };
