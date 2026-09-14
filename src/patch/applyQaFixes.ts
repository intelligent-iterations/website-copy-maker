/**
 * Region-driven patcher: for each diagnosed pixel-diff hot-zone, find the
 * owning DesignNode and apply a targeted fix to the model so the next
 * generation iteration emits corrected JSX.
 *
 *   - wrong-color    → set the owner's `style.backgroundColor` (or text
 *                      `color`) to the source-sampled expected RGB.
 *   - position-shift → adjust the owner's `rect.x` / `rect.y` by the
 *                      detected `(dx, dy)`.
 *   - size-shift     → scale the owner's `rect.width` / `rect.height`.
 *   - missing-element→ no-op for now (needs an injection helper that
 *                      reads from the source extraction tree). Logged.
 *   - extra-element  → mark `metadata.isLikelyDecorative` so the
 *                      renderer drops it.
 *   - anti-aliasing  → no patch.
 *   - unknown        → no patch.
 *
 * Pure: returns a new ProjectModel with structural sharing.
 */

import type { ProjectModel, ProjectPage } from "../generate/createProject.js";
import type { DesignNode } from "../normalize/types.js";
import type { RegionDiagnosis, Rgb } from "../qa/diagnoseRegion.js";
import type { HotZone } from "../qa/regionReport.js";

export type RegionPatch = {
  readonly region: HotZone;
  readonly diagnosis: RegionDiagnosis;
  /** Owner DesignNode id (resolved via regionToElement.findElementForRegion). */
  readonly ownerId: string | null;
};

export type ApplyRegionPatchesInput = {
  readonly model: ProjectModel;
  /** Hot-zone diagnoses keyed by `<routePath>::<viewport>` (route "" for root). */
  readonly patchesByPageViewport: Readonly<Record<string, readonly RegionPatch[]>>;
};

export function applyRegionPatches(input: ApplyRegionPatchesInput): ProjectModel {
  const { model, patchesByPageViewport } = input;

  const patchPage = (page: ProjectPage): ProjectPage => {
    let next = page;
    let updatedRoot = page.root;
    let updatedRootsByViewport = page.rootsByViewport ? { ...page.rootsByViewport } : undefined;

    // Apply each viewport's patches against that viewport's tree (or the
    // shared `root` if per-viewport trees aren't present).
    for (const vp of ["desktop", "tablet", "mobile"] as const) {
      const key = `${page.routePath}::${vp}`;
      const patches = patchesByPageViewport[key];
      if (!patches || patches.length === 0) continue;
      console.warn(
        `[patchPage] route="${page.routePath}" vp=${vp} patches=${patches.length} hasRootsByViewport=${!!updatedRootsByViewport} hasViewportRoot=${!!updatedRootsByViewport?.[vp]}`,
      );
      if (updatedRootsByViewport?.[vp]) {
        const before = updatedRootsByViewport[vp];
        updatedRootsByViewport[vp] = applyPatches(updatedRootsByViewport[vp]!, patches);
        console.warn(
          `[patchPage]   → rootsByViewport[${vp}] changed identity? ${before !== updatedRootsByViewport[vp]}`,
        );
      } else if (vp === "desktop" || !updatedRootsByViewport) {
        // Single-canvas page (no per-viewport trees). Apply to the shared
        // root. Skip non-desktop patches to avoid clobbering desktop with
        // mobile-extraction fixes.
        if (vp === "desktop") {
          updatedRoot = applyPatches(updatedRoot, patches);
        }
      }
    }

    if (updatedRoot !== page.root || updatedRootsByViewport !== page.rootsByViewport) {
      next = {
        ...page,
        root: updatedRoot,
        ...(updatedRootsByViewport ? { rootsByViewport: updatedRootsByViewport } : {}),
      };
    }
    return next;
  };

  return {
    ...model,
    pages: model.pages.map(patchPage),
    root: patchPage(model.pages[0] ?? toPseudoPage(model.root)).root,
  };
}

/**
 * Walk the DesignNode tree applying every patch in a single pass.
 * Structural sharing: nodes that aren't on a patch path are returned by
 * reference identity.
 */
function applyPatches(root: DesignNode, patches: readonly RegionPatch[]): DesignNode {
  const byOwner = new Map<string, RegionPatch>();
  for (const p of patches) {
    if (p.ownerId) byOwner.set(p.ownerId, p);
  }
  if (byOwner.size === 0) return root;

  let appliedCount = 0;
  const appliedSummaries: string[] = [];
  const visit = (n: DesignNode): DesignNode => {
    const patch = byOwner.get(n.id);
    let mutated: DesignNode = n;
    if (patch) {
      mutated = applyDiagnosis(mutated, patch.diagnosis);
      if (mutated !== n) {
        appliedCount++;
        const k = patch.diagnosis.kind;
        if (k === "wrong-color")
          appliedSummaries.push(
            `${n.id}:${k}→${(patch.diagnosis as any).expected.r},${(patch.diagnosis as any).expected.g},${(patch.diagnosis as any).expected.b}`,
          );
        else if (k === "position-shift")
          appliedSummaries.push(
            `${n.id}:${k}→dx=${(patch.diagnosis as any).dx},dy=${(patch.diagnosis as any).dy}`,
          );
        else if (k === "size-shift")
          appliedSummaries.push(`${n.id}:${k}→scale=${(patch.diagnosis as any).scale}`);
        else appliedSummaries.push(`${n.id}:${k}`);
      }
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
  const result = visit(root);
  if (appliedCount === 0 && patches.length > 0) {
    console.warn(
      `[applyPatches] WARNING: ${patches.length} patches generated, 0 applied - owner ids don't match the tree. First patch ownerId=${patches[0]?.ownerId}, first 5 tree ids=${collectIds(root, 5).join(",")}`,
    );
  } else if (appliedCount > 0) {
    console.warn(
      `[applyPatches] applied ${appliedCount}/${patches.length}: ${appliedSummaries.slice(0, 8).join(" | ")}`,
    );
  }
  return result;
}

function collectIds(n: DesignNode, max: number, acc: string[] = []): string[] {
  if (acc.length >= max) return acc;
  acc.push(n.id);
  for (const c of n.children) {
    if (acc.length >= max) break;
    collectIds(c, max, acc);
  }
  return acc;
}

function applyDiagnosis(node: DesignNode, d: RegionDiagnosis): DesignNode {
  switch (d.kind) {
    case "wrong-color": {
      // Heuristic: if the node is text, the diff is its text color. If
      // it's a container/image/etc., it's a backgroundColor fix.
      const expected = rgbToCss(d.expected);
      if (node.type === "text") {
        return { ...node, style: { ...node.style, color: expected } };
      }
      return { ...node, style: { ...node.style, backgroundColor: expected } };
    }
    case "position-shift": {
      // Diff says rebuild's content is offset by (dx, dy) from source.
      // To correct, move the rebuild element by -(dx, dy).
      return {
        ...node,
        rect: { ...node.rect, x: node.rect.x - d.dx, y: node.rect.y - d.dy },
      };
    }
    case "size-shift": {
      const scale = d.scale > 0 ? d.scale : 1;
      return {
        ...node,
        rect: {
          ...node.rect,
          width: Math.max(1, node.rect.width * scale),
          height: Math.max(1, node.rect.height * scale),
        },
      };
    }
    case "extra-element": {
      return {
        ...node,
        metadata: { ...node.metadata, isLikelyDecorative: true },
      };
    }
    case "missing-element":
    case "anti-aliasing":
    case "unknown":
      return node;
  }
}

function rgbToCss(c: Rgb): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function toPseudoPage(root: DesignNode): ProjectPage {
  return {
    routePath: "",
    url: "",
    metadata: {
      title: null,
      description: null,
      ogImage: null,
      ogTitle: null,
      favicon: null,
      themeColor: null,
    },
    sections: [],
    root,
  };
}

// ─── Legacy coarse patcher (still used as a fallback) ──────────────────
// applyRegionPatches addresses specific regions. applyQaFixes complements
// it with global nudges (token rectification, mode escalation) for cases
// where the regions can't be auto-resolved.
import type { DesignTokens } from "../analyze/inferTokens.js";
import type { QaReport } from "../qa/types.js";
import type { RegionReport } from "../qa/regionReport.js";
import type { Mode } from "../agent/thresholds.js";

export type RegionReportsByViewport = Readonly<Record<string, RegionReport>>;

export function applyQaFixes(
  model: ProjectModel,
  report: QaReport,
  regionReports: RegionReportsByViewport = {},
  iteration: number = 1,
): ProjectModel {
  if (report.meetsTargets) return model;
  const desktop = report.results.find((r) => r.viewport === "desktop") ?? report.results[0];
  if (!desktop) return model;

  let next: ProjectModel = adjustTokens(model, desktop.similarity);
  if (iteration >= 2) {
    next = applyRegionPaddingNudges(next, regionReports);
  }
  if (iteration >= 3 && next.mode !== "exact") {
    next = { ...next, mode: "exact" satisfies Mode };
  }
  return next;
}

function adjustTokens(model: ProjectModel, similarity: number): ProjectModel {
  let tokens: DesignTokens = model.tokens;
  if (similarity < 0.4) {
    tokens = { ...tokens, maxContentWidth: clamp(Math.round(tokens.maxContentWidth * 1.05)) };
  } else if (similarity < 0.7) {
    tokens = { ...tokens, maxContentWidth: clamp(Math.round(tokens.maxContentWidth * 0.98)) };
  }
  if (model.root.style.backgroundColor) {
    const rootBg = canonicalize(model.root.style.backgroundColor);
    if (rootBg && rootBg.toLowerCase() !== tokens.colors.page.toLowerCase()) {
      tokens = { ...tokens, colors: { ...tokens.colors, page: rootBg } };
    }
  }
  return { ...model, tokens };
}

function applyRegionPaddingNudges(
  model: ProjectModel,
  regionReports: RegionReportsByViewport,
): ProjectModel {
  const desktopReport = regionReports.desktop;
  if (!desktopReport) return model;
  const worstBand = [...desktopReport.yBands].sort((a, b) => a.similarity - b.similarity)[0];
  if (!worstBand) return model;
  if (worstBand.similarity >= 0.85) return model;

  const nudge = (sections: typeof model.sections): typeof model.sections =>
    sections.map((section) => {
      const top = section.node.rect.y;
      const bottom = top + section.node.rect.height;
      const overlaps = bottom > worstBand.yStart && top < worstBand.yEnd;
      if (!overlaps) return section;
      const padding = section.node.layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
      return {
        ...section,
        node: {
          ...section.node,
          layout: {
            ...section.node.layout,
            padding: {
              ...padding,
              top: Math.max(0, padding.top - 8),
              bottom: Math.max(0, padding.bottom - 8),
            },
          },
        },
      };
    });
  const rootPage = model.pages[0];
  const updatedRoot = rootPage ? { ...rootPage, sections: nudge(rootPage.sections) } : rootPage;
  const pages = updatedRoot ? [updatedRoot, ...model.pages.slice(1)] : model.pages;
  return { ...model, sections: nudge(model.sections), pages };
}

function clamp(value: number): number {
  return Math.max(640, Math.min(1600, value));
}

function canonicalize(rawColor: string): string | null {
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(rawColor.trim());
  if (hex) return rawColor.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)/i.exec(rawColor);
  if (!rgb) return null;
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
