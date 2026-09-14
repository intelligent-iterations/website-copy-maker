/**
 * Owner-overwrite patcher: a catch-all that runs after the diagnose-then-
 * patch loop. For every still-failing tile, it finds the owning DesignNode
 * (via `findElementForRegion`), samples the source PNG's mean color in the
 * tile area, and forces that color onto the owner's style - `color` for
 * text-bearing nodes, `backgroundColor` otherwise.
 *
 * Why this exists: the diagnoser classifies most homepage mismatches as
 * `unknown` (text-wrap / layout differences it can't categorize), so the
 * diagnose-then-patch loop produces zero patches for the homepage. This
 * patcher doesn't need a classification - given (a) the failing tile,
 * (b) the owner DesignNode, and (c) the source pixels, it directly sets
 * the owner's color to the source's measured value.
 *
 * It also resets the owner's `rect` and non-color `style` fields from the
 * pristine source tree (`page.sourceRootsByViewport[vp]`) before applying
 * the sampled color, so the owner never accumulates drift from prior
 * iterations of the diagnose-then-patch loop.
 *
 * Pure (modulo `sharp`-backed `cropRegion`); returns a new ProjectModel
 * with structural sharing.
 */

import { cropRegion } from "../qa/diagnoseRegion.js";
import type { ProjectModel, ProjectPage } from "../generate/createProject.js";
import type { DesignNode } from "../normalize/types.js";
import type { TileResult } from "../qa/compareScreenshots.js";
import { findElementForRegion } from "../qa/regionToElement.js";

export type OwnerOverwriteInput = {
  readonly model: ProjectModel;
  /** Failing tiles per `${routePath}::${viewport}` - caller filters to
   * tiles whose `ratio > TILE_MAX_RATIO`. */
  readonly failingTilesByPageViewport: Readonly<Record<string, readonly TileResult[]>>;
  /** Source PNG buffers per `${routePath}::${viewport}`. */
  readonly sourceBuffersByPageViewport: Readonly<Record<string, Buffer>>;
};

export async function applyOwnerOverwrites(input: OwnerOverwriteInput): Promise<ProjectModel> {
  const { model, failingTilesByPageViewport, sourceBuffersByPageViewport } = input;

  const patchPage = async (page: ProjectPage): Promise<ProjectPage> => {
    const sourceTrees = page.sourceRootsByViewport;
    const workingTrees = page.rootsByViewport;
    if (!sourceTrees || !workingTrees) return page;

    let updatedRootsByViewport: Record<string, DesignNode> | null = null;

    for (const vp of ["desktop", "tablet", "mobile"] as const) {
      const key = `${page.routePath}::${vp}`;
      const tiles = failingTilesByPageViewport[key];
      const buffer = sourceBuffersByPageViewport[key];
      const workingRoot = workingTrees[vp];
      const sourceRoot = sourceTrees[vp];
      if (!tiles || tiles.length === 0 || !buffer || !workingRoot || !sourceRoot) continue;

      const ops = await collectOwnerOps(tiles, workingRoot, buffer);
      if (ops.size === 0) continue;

      // Reset rect + non-color style on each owner from the pristine
      // source tree, then apply the sampled color. The reset ensures we
      // don't compound drift across iterations; the only deliberate
      // change is the sampled color.
      const sourceById = indexById(sourceRoot);
      const patched = applyOps(workingRoot, ops, sourceById);
      if (patched !== workingRoot) {
        updatedRootsByViewport ??= { ...workingTrees };
        updatedRootsByViewport[vp] = patched;
      }
    }

    if (!updatedRootsByViewport) return page;
    return { ...page, rootsByViewport: updatedRootsByViewport };
  };

  const newPages = await Promise.all(model.pages.map(patchPage));
  // If no page changed, return original by reference.
  const anyChanged = newPages.some((p, i) => p !== model.pages[i]);
  if (!anyChanged) return model;
  return { ...model, pages: newPages };
}

type OwnerOp = {
  readonly ownerId: string;
  readonly styleKey: "color" | "backgroundColor";
  readonly value: string;
};

async function collectOwnerOps(
  tiles: readonly TileResult[],
  workingRoot: DesignNode,
  sourceBuffer: Buffer,
): Promise<Map<string, OwnerOp>> {
  // Last-write-wins per (ownerId, styleKey). When multiple failing tiles
  // share an owner, the worst-ratio tile's color is the most likely
  // ground truth (highest signal-to-noise). Pre-sort.
  const sorted = [...tiles].sort((a, b) => a.ratio - b.ratio); // ascending; worst applied last
  const ops = new Map<string, OwnerOp>();
  for (const t of sorted) {
    const ownerMatch = findElementForRegion(
      { x: t.x, y: t.y, width: t.width, height: t.height },
      workingRoot,
    );
    if (!ownerMatch.node) continue;
    const owner = ownerMatch.node;
    const crop = await cropRegion(sourceBuffer, {
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
    });
    if (crop.width === 0 || crop.height === 0) continue;
    const mean = meanRgb(crop.data, crop.width, crop.height);
    if (!mean) continue;
    const styleKey = chooseStyleKey(owner);
    const value = `rgb(${mean.r}, ${mean.g}, ${mean.b})`;
    ops.set(`${owner.id}::${styleKey}`, { ownerId: owner.id, styleKey, value });
  }
  return ops;
}

/** Choose which CSS property to set on the owner based on its DesignNode
 * type. Text and headings get `color`; everything else gets
 * `backgroundColor`. Link/button defers to whether it carries text - a
 * text-link gets `color`, an icon-link gets `backgroundColor`. */
function chooseStyleKey(owner: DesignNode): "color" | "backgroundColor" {
  if (owner.type === "text") return "color";
  if (owner.type === "link" || owner.type === "button") {
    return owner.text && owner.text.trim().length > 0 ? "color" : "backgroundColor";
  }
  return "backgroundColor";
}

/** Compute mean RGB of an RGBA `Uint8ClampedArray`/`Buffer`, ignoring
 * fully-transparent pixels (alpha === 0) so we don't bias toward
 * background fill. Returns null if every pixel is transparent. */
function meanRgb(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
): { r: number; g: number; b: number } | null {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const px = width * height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const a = data[o + 3]!;
    if (a === 0) continue;
    r += data[o]!;
    g += data[o + 1]!;
    b += data[o + 2]!;
    n++;
  }
  if (n === 0) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function indexById(root: DesignNode): Map<string, DesignNode> {
  const out = new Map<string, DesignNode>();
  const visit = (n: DesignNode): void => {
    out.set(n.id, n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

/** Walk the tree applying every op. For each visited node:
 *  1. If a source-side counterpart exists, restore its `rect` and the
 *     non-color subset of its `style` (so prior diagnose-then-patch
 *     drift is undone).
 *  2. If an op targets this node, apply the sampled color.
 * Structural sharing: nodes off the patch path are returned by
 * reference identity. */
function applyOps(
  root: DesignNode,
  ops: Map<string, OwnerOp>,
  sourceById: Map<string, DesignNode>,
): DesignNode {
  const opsByOwner = new Map<string, OwnerOp[]>();
  for (const op of ops.values()) {
    const list = opsByOwner.get(op.ownerId) ?? [];
    list.push(op);
    opsByOwner.set(op.ownerId, list);
  }
  if (opsByOwner.size === 0) return root;

  const visit = (n: DesignNode): DesignNode => {
    let mutated: DesignNode = n;
    const nodeOps = opsByOwner.get(n.id);
    if (nodeOps) {
      const sourceNode = sourceById.get(n.id);
      const baseRect = sourceNode?.rect ?? n.rect;
      const baseStyle = sourceNode ? mergeNonColorStyle(n.style, sourceNode.style) : n.style;
      let nextStyle = baseStyle;
      for (const op of nodeOps) {
        nextStyle = { ...nextStyle, [op.styleKey]: op.value };
      }
      mutated = { ...n, rect: baseRect, style: nextStyle };
    }
    let childrenChanged = false;
    const newChildren: DesignNode[] = [];
    for (const c of mutated.children) {
      const updated = visit(c);
      if (updated !== c) childrenChanged = true;
      newChildren.push(updated);
    }
    if (childrenChanged) {
      return { ...mutated, children: newChildren };
    }
    return mutated;
  };
  return visit(root);
}

/** Replace every non-color style key on `working` with the corresponding
 * value from `source`, but preserve `working`'s existing color and
 * backgroundColor (those are the targets the op writes to next, so we
 * don't want to overwrite them with stale source values). */
function mergeNonColorStyle(
  working: DesignNode["style"],
  source: DesignNode["style"],
): DesignNode["style"] {
  const out: { -readonly [K in keyof DesignNode["style"]]: DesignNode["style"][K] } = {
    ...source,
  };
  const color = working.color ?? source.color;
  const bg = working.backgroundColor ?? source.backgroundColor;
  if (color !== undefined) out.color = color;
  else delete out.color;
  if (bg !== undefined) out.backgroundColor = bg;
  else delete out.backgroundColor;
  return out;
}

/** Helper for runAgent: derive the failing-tiles map from a QaReport.
 * Filters to tiles above the gate threshold and groups by
 * `${route}::${viewport}` so callers can pair with source buffers. */
export function collectFailingTiles(
  results: ReadonlyArray<{
    readonly route: string;
    readonly viewport: string;
    readonly tiles: readonly TileResult[];
  }>,
  threshold: number,
): Record<string, readonly TileResult[]> {
  const out: Record<string, readonly TileResult[]> = {};
  for (const r of results) {
    const failing = r.tiles.filter((t) => t.ratio > threshold);
    if (failing.length === 0) continue;
    out[`${r.route}::${r.viewport}`] = failing;
  }
  return out;
}
