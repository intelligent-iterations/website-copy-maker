/**
 * Pure: group the top-level children of the body into vertical visual bands.
 * Each band becomes a Section in the generated page. The classifier then
 * labels only structural patterns needed by the generated-output adapter.
 */

import type { DesignNode } from "./types.js";

export type SectionKind = "navigation" | "repeated" | "footer" | "generic";

export type Section = {
  readonly kind: SectionKind;
  readonly index: number;
  readonly node: DesignNode;
};

const NAV_RE = /(nav|menu|header)/i;
const FOOTER_RE = /(footer)/i;

export function groupSections(root: DesignNode): readonly Section[] {
  // Descend through pure wrappers until we find a layer with enough vertical
  // bands to be a meaningful page. Component-based pages often wrap the
  // whole page in outer containers, so the body's direct children are
  // useless for section detection - we need to peel.
  const layer = peelToBandedLayer(root);

  // Some pages render every section as an absolute-positioned sibling
  // inside one canvas wrapper. The standard "filter by height + classify"
  // path treats those siblings as flat sections, which produces a meaningless
  // grouping. Detect this case and switch to vertical Y-banding.
  const absoluteChildren = layer.children.filter(
    (c) => c.layout.mode === "absolute" || c.layout.mode === undefined,
  );
  const absoluteRatio =
    layer.children.length > 0 ? absoluteChildren.length / layer.children.length : 0;
  const looksLikeAbsoluteCanvas =
    layer.children.length >= 3 &&
    absoluteRatio >= 0.6 &&
    layer.children.filter((c) => c.layout.mode === "absolute").length >= 2;

  const grouped: readonly DesignNode[] = looksLikeAbsoluteCanvas ? bandByY(layer) : layer.children;

  const candidates = grouped.filter((c) => c.rect.height > 40 && c.rect.width > 200);

  if (candidates.length === 0) {
    // Fallback: treat the root itself as one generic section so generation
    // has something to chew on.
    return [{ kind: "generic", index: 0, node: root }];
  }

  const sections: Section[] = candidates.map((node, i) => ({
    kind: classify(node, i, candidates.length),
    index: i,
    node,
  }));

  // First navigation-like region is the primary navigation.
  const navIdx = sections.findIndex((s) => s.kind === "navigation");
  if (navIdx > 0) {
    sections[navIdx] = { ...sections[navIdx]!, kind: "navigation" };
  }
  // Last link-heavy section is the footer
  const lastIdx = sections.length - 1;
  if (
    lastIdx >= 0 &&
    sections[lastIdx]!.kind === "generic" &&
    isLinkHeavy(sections[lastIdx]!.node)
  ) {
    sections[lastIdx] = { ...sections[lastIdx]!, kind: "footer" };
  }

  return sections;
}

/**
 * Cluster a layer's children into vertical bands by Y-position. Used when
 * the layer's children are absolute-positioned in a visual canvas and
 * therefore have no semantic ordering. Synthesizes one virtual section
 * DesignNode per band whose `children` are the cluster.
 *
 * Tolerance: a child opens a new band only when its top is more than
 * `tolerancePx` below the running band bottom. Children that overlap the
 * current band (top within band's [yStart, bottom + tol]) join it.
 */
export function bandByY(
  layer: DesignNode,
  tolerancePx = 24,
  minHeight = 40,
): readonly DesignNode[] {
  const visible = layer.children.filter((c) => c.rect.width > 0 && c.rect.height >= minHeight);
  if (visible.length === 0) return [];
  const sorted = [...visible].sort((a, b) => a.rect.y - b.rect.y);

  type Band = { yStart: number; bottom: number; children: DesignNode[] };
  const bands: Band[] = [];
  for (const child of sorted) {
    const top = child.rect.y;
    const bottom = child.rect.y + child.rect.height;
    const last = bands[bands.length - 1];
    if (!last || top > last.bottom + tolerancePx) {
      bands.push({ yStart: top, bottom, children: [child] });
    } else {
      last.children.push(child);
      if (bottom > last.bottom) last.bottom = bottom;
      if (top < last.yStart) last.yStart = top;
    }
  }

  return bands.map((band, i) => synthesizeSection(band, layer, i));
}

function synthesizeSection(
  band: { yStart: number; bottom: number; children: DesignNode[] },
  parent: DesignNode,
  index: number,
): DesignNode {
  const xs = band.children.map((c) => c.rect.x);
  const rights = band.children.map((c) => c.rect.x + c.rect.width);
  const x = Math.min(...xs);
  const right = Math.max(...rights);
  const width = Math.max(0, right - x);
  const height = Math.max(0, band.bottom - band.yStart);
  return {
    id: `band-${parent.id}-${index}`,
    type: "section",
    name: `band-${index}`,
    rect: { x, y: band.yStart, width, height },
    style: {},
    layout: { mode: "normal" },
    metadata: {
      isLikelyHeading: false,
      isLikelyParagraph: false,
      isLikelyButton: false,
      isLikelyCard: false,
      isLikelyNav: false,
      isLikelyDecorative: false,
      visualImportance: Math.round(Math.log10(Math.max(1, width * height)) * 10) / 10,
    },
    children: band.children,
  };
}

function peelToBandedLayer(root: DesignNode, maxDepth = 6): DesignNode {
  let layer = root;
  for (let i = 0; i < maxDepth; i++) {
    const banded = layer.children.filter((c) => c.rect.height > 60 && c.rect.width > 200);
    if (banded.length >= 3) return layer;
    // Otherwise descend into the largest child.
    const largest = layer.children
      .filter((c) => c.rect.height > 0 && c.rect.width > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
    if (!largest) return layer;
    layer = largest;
  }
  return layer;
}

function classify(node: DesignNode, index: number, total: number): SectionKind {
  const name = node.name.toLowerCase();
  if (index === 0 && (NAV_RE.test(name) || node.metadata.isLikelyNav)) return "navigation";
  if (index === total - 1 && FOOTER_RE.test(name)) return "footer";
  if (looksLikeRepeatedGrid(node)) return "repeated";
  return "generic";
}

function isLinkHeavy(node: DesignNode): boolean {
  let count = 0;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "link") count++;
    stack.push(...n.children);
  }
  return count >= 3;
}

function looksLikeRepeatedGrid(node: DesignNode): boolean {
  // Three or more siblings of the same type with similar heights.
  const counts = new Map<string, { n: number; heights: number[] }>();
  for (const c of node.children) {
    const key = c.type;
    const acc = counts.get(key) ?? { n: 0, heights: [] };
    acc.n += 1;
    acc.heights.push(c.rect.height);
    counts.set(key, acc);
  }
  for (const [, acc] of counts) {
    if (acc.n >= 3) {
      const min = Math.min(...acc.heights);
      const max = Math.max(...acc.heights);
      if (max === 0) continue;
      if ((max - min) / max < 0.25) return true;
    }
  }
  return false;
}
