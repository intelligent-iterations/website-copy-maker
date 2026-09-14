/**
 * Pure: infer Tailwind-shaped design tokens from a DesignNode tree.
 * Colors come back as hex; numeric tokens come back as pixel values.
 */

import { clusterColors } from "../utils/colors.js";
import type { DesignNode } from "../normalize/types.js";

export type DesignTokens = {
  readonly colors: {
    readonly page: string;
    readonly ink: string;
    readonly muted: string;
    readonly accent: string;
    readonly all: readonly string[];
  };
  readonly fontFamilies: readonly string[];
  readonly maxContentWidth: number;
  readonly radii: readonly string[];
  readonly shadows: readonly string[];
};

const DEFAULT: DesignTokens = {
  colors: {
    page: "#ffffff",
    ink: "#111111",
    muted: "#6f6a62",
    accent: "#f76b4f",
    all: [],
  },
  fontFamilies: ["system-ui", "sans-serif"],
  maxContentWidth: 1200,
  radii: [],
  shadows: [],
};

export function inferTokens(root: DesignNode): DesignTokens {
  const bgColors: string[] = [];
  const textColors: string[] = [];
  const fonts = new Map<string, number>();
  const radii: string[] = [];
  const shadows: string[] = [];
  const widths: number[] = [];

  const walk = (n: DesignNode): void => {
    if (n.style.backgroundColor) bgColors.push(n.style.backgroundColor);
    if (n.style.color) textColors.push(n.style.color);
    if (n.style.fontFamily) {
      const primary = n.style.fontFamily
        .split(",")[0]
        ?.trim()
        .replace(/^["']|["']$/g, "");
      if (primary) fonts.set(primary, (fonts.get(primary) ?? 0) + 1);
    }
    if (n.style.borderRadius) radii.push(n.style.borderRadius);
    if (n.style.boxShadow) shadows.push(n.style.boxShadow);
    if (n.rect.width > 600) widths.push(n.rect.width);
    for (const c of n.children) walk(c);
  };
  walk(root);

  const bgClusters = clusterColors(bgColors);
  const textClusters = clusterColors(textColors);
  const allClusters = clusterColors([...bgColors, ...textColors]);

  // page color: prefer the actual root background (body/html) when present,
  // otherwise fall back to the most frequent background. Without this guard
  // a page with three white feature-cards on a beige body picks "white" as
  // page and the real beige drops down to accent - wrong.
  const rootBg = root.style.backgroundColor
    ? clusterColors([root.style.backgroundColor])[0]
    : undefined;
  const page = rootBg ?? bgClusters[0] ?? DEFAULT.colors.page;
  const ink = textClusters[0] ?? DEFAULT.colors.ink;
  const muted = textClusters[1] ?? DEFAULT.colors.muted;
  // Accent: a color that's neither page/ink/muted nor a near-white surface.
  const accent =
    allClusters.find((c) => c !== page && c !== ink && c !== muted && !looksLikeSurface(c, page)) ??
    DEFAULT.colors.accent;

  const fontFamilies = Array.from(fonts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n);

  const maxContentWidth = widths.length
    ? Math.round(percentile(widths, 0.75))
    : DEFAULT.maxContentWidth;

  return {
    colors: { page, ink, muted, accent, all: allClusters },
    fontFamilies: fontFamilies.length ? fontFamilies : [...DEFAULT.fontFamilies],
    maxContentWidth,
    radii: dedupe(radii).slice(0, 5),
    shadows: dedupe(shadows).slice(0, 5),
  };
}

function dedupe<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function looksLikeSurface(candidate: string, page: string): boolean {
  // Filter out near-white card surfaces and near-page tints when picking
  // accent. Candidates within 24 RGB channels of either are "surface", not
  // "accent".
  const c = parseHex(candidate);
  const p = parseHex(page);
  if (!c) return false;
  const isNearWhite = c.r > 235 && c.g > 235 && c.b > 235;
  if (isNearWhite) return true;
  if (!p) return false;
  return Math.abs(c.r - p.r) <= 24 && Math.abs(c.g - p.g) <= 24 && Math.abs(c.b - p.b) <= 24;
}

function parseHex(value: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{6})/i.exec(value);
  if (!m) return null;
  const hex = m[1]!;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}
