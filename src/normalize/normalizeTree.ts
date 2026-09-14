/**
 * Pure: ExtractedNode → DesignNode tree.
 * Drops obviously-decorative wrappers and attaches semantic metadata.
 */

import { parsePx, parseBox, extractUrls } from "../utils/css.js";
import type { ExtractedNode, ExtractedStyles } from "../extract/types.js";
import type {
  DesignLayout,
  DesignMetadata,
  DesignNode,
  DesignNodeType,
  DesignStyle,
} from "./types.js";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_TAGS = new Set(["p", "span", "small", "blockquote", "li", "label", "strong", "em"]);
const BUTTON_HINTS = /(btn|button)/i;

export function normalizeTree(root: ExtractedNode): DesignNode {
  return toDesignNode(root);
}

function toDesignNode(n: ExtractedNode): DesignNode {
  const children = n.children.map(toDesignNode);
  const type = classify(n);
  const style = pickStyle(n.styles);
  const layout = pickLayout(n.styles);
  const metadata = computeMetadata(n, type);

  const node: {
    id: string;
    type: DesignNodeType;
    name: string;
    rect: DesignNode["rect"];
    style: DesignStyle;
    layout: DesignLayout;
    metadata: DesignMetadata;
    children: readonly DesignNode[];
    text?: string;
    richText?: NonNullable<DesignNode["richText"]>;
    href?: string;
    src?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    cssWidth?: number;
    cssHeight?: number;
  } = {
    id: n.id,
    type,
    name: nameFor(n, type),
    rect: { x: n.rect.x, y: n.rect.y, width: n.rect.width, height: n.rect.height },
    style,
    layout,
    metadata,
    children,
  };

  if (n.text) node.text = n.text;
  if (n.richText && n.richText.length > 0) node.richText = n.richText;
  if (n.href) node.href = n.href;
  const src = n.src ?? n.currentSrc ?? extractUrls(n.styles.backgroundImage)[0];
  if (src) node.src = src;
  if (n.naturalWidth !== undefined && n.naturalWidth > 0) node.naturalWidth = n.naturalWidth;
  if (n.naturalHeight !== undefined && n.naturalHeight > 0) node.naturalHeight = n.naturalHeight;
  if (n.cssWidth !== undefined && n.cssWidth > 0) node.cssWidth = n.cssWidth;
  if (n.cssHeight !== undefined && n.cssHeight > 0) node.cssHeight = n.cssHeight;

  return node;
}

function classify(n: ExtractedNode): DesignNodeType {
  const tag = n.tag.toLowerCase();
  const cls = (n.attributes.class ?? "").toLowerCase();
  const role = n.role ?? "";

  if (tag === "img" || tag === "svg" || tag === "picture") return "image";
  if (tag === "video") return "video";
  if (tag === "a") {
    if (BUTTON_HINTS.test(cls) || role === "button") return "button";
    return "link";
  }
  if (tag === "button" || role === "button") return "button";
  if (HEADING_TAGS.has(tag) || TEXT_TAGS.has(tag)) return "text";
  if (tag === "section" || tag === "header" || tag === "footer" || tag === "main") return "section";
  if (tag === "article") return "card";
  if (tag === "nav") return "section";
  if (n.styles.display === "grid") return "grid";
  if (n.styles.display === "flex") return "stack";
  if (tag === "div" || tag === "span") return "container";
  return "unknown";
}

function nameFor(n: ExtractedNode, type: DesignNodeType): string {
  const cls = n.attributes.class;
  if (cls) {
    const first = cls.split(/\s+/)[0];
    if (first) return first;
  }
  return `${type}-${n.id}`;
}

function pickStyle(styles: ExtractedStyles): DesignStyle {
  const out: { -readonly [K in keyof DesignStyle]?: DesignStyle[K] } = {};
  if (styles.color && styles.color !== "rgba(0, 0, 0, 0)") out.color = styles.color;
  if (styles.backgroundColor && styles.backgroundColor !== "rgba(0, 0, 0, 0)")
    out.backgroundColor = styles.backgroundColor;
  if (styles.backgroundImage && styles.backgroundImage !== "none")
    out.backgroundImage = styles.backgroundImage;
  if (styles.fontFamily) out.fontFamily = styles.fontFamily;
  const fs = parsePx(styles.fontSize);
  if (fs !== null) out.fontSize = fs;
  if (styles.fontWeight) out.fontWeight = styles.fontWeight;
  if (styles.lineHeight) out.lineHeight = styles.lineHeight;
  if (styles.letterSpacing) out.letterSpacing = styles.letterSpacing;
  if (styles.borderRadius && styles.borderRadius !== "0px") out.borderRadius = styles.borderRadius;
  if (styles.boxShadow && styles.boxShadow !== "none") out.boxShadow = styles.boxShadow;
  if (styles.border && !/^0px/.test(styles.border)) out.border = styles.border;
  const opacity = Number(styles.opacity);
  if (!Number.isNaN(opacity) && opacity < 1) out.opacity = opacity;
  if (styles.transform && styles.transform !== "none") out.transform = styles.transform;
  if (styles.zIndex && styles.zIndex !== "auto") {
    const z = Number(styles.zIndex);
    if (Number.isFinite(z)) out.zIndex = z;
  }
  // Image fit. Browser default is `fill` (stretches); only carry over
  // explicit non-default values.
  const objectFit = (styles as unknown as Record<string, string>).objectFit;
  if (objectFit && objectFit !== "fill") out.objectFit = objectFit;
  const objectPosition = (styles as unknown as Record<string, string>).objectPosition;
  if (objectPosition && objectPosition !== "50% 50%") out.objectPosition = objectPosition;
  // text-align - only carry over non-default values (start/left).
  if (styles.textAlign && styles.textAlign !== "start" && styles.textAlign !== "left") {
    out.textAlign = styles.textAlign;
  }
  // white-space - only carry non-default. Browser default is `normal`.
  const ws = (styles as unknown as Record<string, string>).whiteSpace;
  if (ws && ws !== "normal") out.whiteSpace = ws;
  return out;
}

function pickLayout(styles: ExtractedStyles): DesignLayout {
  const out: { -readonly [K in keyof DesignLayout]?: DesignLayout[K] } = {};
  if (styles.display === "flex") {
    out.mode = "flex";
    out.direction = styles.flexDirection === "column" ? "column" : "row";
    out.align = styles.alignItems;
    out.justify = styles.justifyContent;
  } else if (styles.display === "grid") {
    out.mode = "grid";
  } else if (styles.position === "absolute" || styles.position === "fixed") {
    out.mode = "absolute";
  } else {
    out.mode = "normal";
  }
  const gap = parsePx(styles.gap);
  if (gap !== null) out.gap = gap;
  const padding = parseBox(styles.padding);
  if (padding) out.padding = padding;
  return out;
}

function computeMetadata(n: ExtractedNode, type: DesignNodeType): DesignMetadata {
  const tag = n.tag.toLowerCase();
  return {
    isLikelyHeading: HEADING_TAGS.has(tag),
    isLikelyParagraph: tag === "p" || (TEXT_TAGS.has(tag) && (n.text?.length ?? 0) > 30),
    isLikelyButton: type === "button",
    isLikelyCard: type === "card",
    isLikelyNav: tag === "nav" || n.role === "navigation",
    isLikelyDecorative: type === "decorative",
    visualImportance: importanceOf(n),
  };
}

function importanceOf(n: ExtractedNode): number {
  const area = n.rect.width * n.rect.height;
  return Math.round(Math.log10(Math.max(1, area)) * 10) / 10;
}
