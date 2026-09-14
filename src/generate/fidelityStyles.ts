import type { DesignNode } from "../normalize/types.js";
import { stripTranslation } from "./utils/transformStrip.js";

export function composeTransforms(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  // Strip translation from each transform: getBoundingClientRect already
  // captures post-transform position, so re-applying the source's matrix()
  // tx/ty would translate the element a second time. Rotation, scale, and
  // skew survive - those are visual effects we want to preserve.
  const stripped = values.map((v) => stripTranslation(v)).filter((s) => s.length > 0);
  if (stripped.length === 0) return null;
  return stripped.join(" ");
}

export function positionStyle(node: DesignNode, root: DesignNode): Record<string, string | number> {
  return {
    position: "absolute",
    left: px(node.rect.x - root.rect.x),
    top: px(node.rect.y - root.rect.y),
    width: px(node.rect.width),
    height: px(node.rect.height),
  };
}

/**
 * Type-related style for text/heading/link/p - explicitly does NOT touch
 * position/left/top/width/height because those come from positionStyle.
 */
export function typeStyle(node: DesignNode): Record<string, string | number> {
  const s: Record<string, string | number> = {};
  if (node.style.color) s.color = node.style.color;
  if (node.style.fontFamily) s.fontFamily = node.style.fontFamily;
  if (node.style.fontSize) s.fontSize = px(node.style.fontSize);
  if (node.style.fontWeight) s.fontWeight = String(node.style.fontWeight);
  if (node.style.lineHeight) s.lineHeight = String(node.style.lineHeight);
  if (node.style.letterSpacing) s.letterSpacing = node.style.letterSpacing;
  if (node.style.textAlign) s.textAlign = node.style.textAlign;
  if (node.style.whiteSpace) s.whiteSpace = node.style.whiteSpace;
  return s;
}

export function buttonExtras(node: DesignNode): Record<string, string | number> {
  const s = typeStyle(node);
  s.display = "inline-flex";
  s.alignItems = "center";
  s.justifyContent = "center";
  if (node.style.backgroundColor) s.backgroundColor = node.style.backgroundColor;
  if (node.style.borderRadius) s.borderRadius = node.style.borderRadius;
  s.textDecoration = "none";
  return s;
}

export function decorativeStyle(node: DesignNode): Record<string, string | number> {
  const s: Record<string, string | number> = {};
  if (node.style.backgroundColor) s.backgroundColor = node.style.backgroundColor;
  if (node.style.borderRadius && node.style.borderRadius !== "0px") {
    s.borderRadius = node.style.borderRadius;
  }
  if (node.style.boxShadow) s.boxShadow = node.style.boxShadow;
  if (node.style.border) s.border = node.style.border;
  if (node.style.opacity !== undefined && node.style.opacity < 1) s.opacity = node.style.opacity;
  if (node.style.transform) {
    const stripped = stripTranslation(node.style.transform);
    if (stripped) s.transform = stripped;
  }
  return s;
}

export function mergeStyle(
  base: Record<string, string | number>,
  extras: Record<string, string | number>,
): Record<string, string | number> {
  return { ...base, ...extras };
}

export function chooseTag(node: DesignNode): string {
  if (node.type === "text") {
    const fs = node.style.fontSize ?? 0;
    if (node.metadata.isLikelyHeading) {
      if (fs >= 40) return "h1";
      if (fs >= 28) return "h2";
      return "h3";
    }
    return "p";
  }
  if (node.type === "card") return "li";
  if (node.type === "section") return "section";
  return "div";
}

export function isVisible(n: DesignNode): boolean {
  if (n.rect.width <= 0 || n.rect.height <= 0) return false;
  if (n.style.opacity !== undefined && n.style.opacity === 0) return false;
  return true;
}

export function hasVisibleDescendant(n: DesignNode): boolean {
  if (n.text && n.text.length > 0) return true;
  for (const c of n.children) {
    if (isVisible(c)) return true;
    if (hasVisibleDescendant(c)) return true;
  }
  return false;
}

export function px(value: number): string {
  return `${Math.round(value)}px`;
}

export function jsonStyle(style: Record<string, string | number>): string {
  const entries = Object.entries(style)
    .map(([k, v]) => `${JSON.stringify(k)}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join(", ");
  return `{${entries}}`;
}

export function spaces(n: number): string {
  return " ".repeat(n);
}

export function escape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

export function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}
