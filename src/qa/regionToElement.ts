/**
 * Map a pixel-diff hot-zone bounding box back to the DesignNode that owns
 * those pixels. The patcher uses this to know which element's style /
 * position / existence is wrong, instead of nudging tokens blindly.
 *
 * Strategy:
 *   1. Walk the tree, collecting every node whose rect overlaps the region.
 *   2. Score each candidate by `IoU(rect, region) * visualImportance`.
 *   3. Return the highest-scoring node plus its ancestor chain (so the
 *      patcher can reach a wrapper if the leaf itself isn't decisive).
 *
 * Pure: no IO, no side effects.
 */

import type { DesignNode, DesignRect } from "../normalize/types.js";

export type RegionBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ElementMatch = {
  readonly node: DesignNode | null;
  /** Outer-to-inner ancestor chain (including `node` itself last). Empty if
   * `node` is null. */
  readonly ancestors: readonly DesignNode[];
  /** IoU * importance, useful for ranking matches across regions. */
  readonly score: number;
};

export function findElementForRegion(region: RegionBox, root: DesignNode): ElementMatch {
  const candidates: { node: DesignNode; ancestors: DesignNode[]; score: number }[] = [];

  const visit = (n: DesignNode, ancestors: readonly DesignNode[]): void => {
    const iou = computeIoU(n.rect, region);
    if (iou > 0) {
      const score = iou * Math.max(1, n.metadata.visualImportance);
      candidates.push({ node: n, ancestors: [...ancestors, n], score });
    }
    for (const c of n.children) visit(c, [...ancestors, n]);
  };
  visit(root, []);

  if (candidates.length === 0) return { node: null, ancestors: [], score: 0 };

  // Prefer the deepest non-trivial overlap. Among candidates within 5% of
  // top score, pick the deepest in the tree (most-specific) so the patcher
  // touches the owning leaf rather than a giant wrapper.
  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.05 * Math.max(a.score, b.score, 1e-6)) {
      return b.ancestors.length - a.ancestors.length;
    }
    return b.score - a.score;
  });

  const winner = candidates[0]!;
  return { node: winner.node, ancestors: winner.ancestors, score: winner.score };
}

/** Intersection-over-union of two axis-aligned boxes. */
export function computeIoU(a: DesignRect, b: RegionBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  if (intersection <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

/**
 * Best-effort match including coverage, useful when one box is much larger
 * than the other (e.g., a wrapper rect vs a tiny diff zone). Returns the
 * fraction of `region` that's covered by `rect` - an asymmetric measure
 * that complements IoU when the patcher wants to ask "does this element
 * fully contain the region?"
 */
export function regionContainment(rect: DesignRect, region: RegionBox): number {
  const ix = Math.max(
    0,
    Math.min(rect.x + rect.width, region.x + region.width) - Math.max(rect.x, region.x),
  );
  const iy = Math.max(
    0,
    Math.min(rect.y + rect.height, region.y + region.height) - Math.max(rect.y, region.y),
  );
  const intersection = ix * iy;
  const regionArea = region.width * region.height;
  if (regionArea <= 0) return 0;
  return intersection / regionArea;
}
