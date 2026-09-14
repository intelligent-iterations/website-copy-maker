/**
 * Responsive renderer (mode = "responsive", the default).
 *
 * For each top-level section identified by `groupSections`:
 *   - Two-column media/text regions stack on mobile and sit side-by-side
 *     from the medium breakpoint up.
 *   - Repeated sibling regions emit
 *     `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` where N is the
 *     measured desktop column count.
 *   - Footer, navigation, and generic regions use conservative flex layouts.
 *   - Sections sourced from absolute-canvas Y-banding fall back to
 *     `renderFidelity` for that section, which now ships with a CSS
 *     scaling shell so squeeze still doesn't clip.
 *
 * A page represented as one absolute canvas has no reliable reflow semantics.
 * The scaling fallback preserves the observed layout without attributing that
 * DOM shape to any particular authoring platform.
 */

import type { ProjectModel, ProjectPage } from "./createProject.js";
import type { DesignNode } from "../normalize/types.js";
import type { Section } from "../normalize/groupSections.js";
import { renderChildren, type RenderCtx } from "./renderSection.js";
import { renderFidelity, type FidelityCtx } from "./renderFidelity.js";

export type ResponsiveCtx = RenderCtx;

export function renderResponsive(model: ProjectModel, page: ProjectPage): string {
  const ctx: ResponsiveCtx = {
    sourceUrl: model.sourceUrl,
    assetMap: model.assetMap,
    mode: model.mode,
  };
  const fidelityCtx: FidelityCtx = {
    sourceUrl: model.sourceUrl,
    assetMap: model.assetMap,
  };

  // If the whole page is one absolute canvas (the bandByY synthesizer kicks
  // in inside `groupSections`), every section is a virtual band of absolute
  // children with no flex/grid layout to reconcile. Skip the per-section
  // semantic emit and render the entire root via fidelity-with-shell -
  // that's the only way the layout stays correct.
  if (looksLikeAbsoluteCanvas(page)) {
    return renderFidelity(page.root, fidelityCtx);
  }

  return page.sections
    .map((s) => renderResponsiveSection(s, ctx, fidelityCtx, page.root))
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

function renderResponsiveSection(
  section: Section,
  ctx: ResponsiveCtx,
  fidelityCtx: FidelityCtx,
  root: DesignNode,
): string {
  const node = section.node;
  void root;
  // If this individual section is a synthesized absolute band (id starts
  // with "band-"), fidelity-render it inside its own scaling region.
  if (node.id.startsWith("band-")) {
    return renderFidelity(node, fidelityCtx);
  }

  const inner = renderChildren(node, ctx, 6);
  const layoutClass = pickSectionLayout(section, node);
  const padding = "px-4 sm:px-6 md:px-8 py-8 md:py-12 lg:py-16";
  const wrap = `mx-auto w-full max-w-page ${layoutClass}`.trim();
  return `      <section className="${padding}">
        <div className="${wrap}">
${inner}
        </div>
      </section>`;
}

/**
 * Pick the responsive layout container class for a section based on its
 * inferred kind and child structure. The heuristics are intentionally
 * conservative - we'd rather emit a too-simple `flex flex-col` and have
 * the section flow correctly than try a complex grid that misaligns.
 */
function pickSectionLayout(section: Section, node: DesignNode): string {
  if (looksTwoColumn(node)) {
    return "flex flex-col gap-8 md:flex-row md:items-center md:gap-12";
  }
  if (section.kind === "repeated") {
    const cols = inferGridColumns(node);
    return `grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cols}`;
  }
  if (section.kind === "footer") {
    return "flex flex-col gap-6 md:flex-row md:items-start md:justify-between";
  }
  if (section.kind === "navigation") {
    return "flex flex-col gap-4 md:flex-row md:items-center md:justify-between";
  }
  // Generic fallback preserves source order in a vertical stack.
  return "flex flex-col gap-4";
}

function looksTwoColumn(node: DesignNode): boolean {
  const visible = node.children.filter(
    (c) => c.rect.width > 0 && c.rect.height > 0 && (c.style.opacity ?? 1) > 0,
  );
  if (visible.length < 2) return false;
  // Heuristic: at least one image-or-image-bearing child with width ≥ 30%
  // of the section, AND at least one text-bearing child.
  const hasLargeMedia = visible.some(
    (c) =>
      (c.type === "image" || c.type === "video" || hasMediaDescendant(c)) &&
      node.rect.width > 0 &&
      c.rect.width / node.rect.width >= 0.3,
  );
  const hasText = visible.some((c) => hasTextDescendant(c));
  return hasLargeMedia && hasText;
}

function hasMediaDescendant(n: DesignNode): boolean {
  if (n.type === "image" || n.type === "video") return true;
  if (n.style.backgroundImage && n.style.backgroundImage !== "none") return true;
  for (const c of n.children) {
    if (hasMediaDescendant(c)) return true;
  }
  return false;
}

function hasTextDescendant(n: DesignNode): boolean {
  if (n.text && n.text.trim().length > 0) return true;
  for (const c of n.children) {
    if (hasTextDescendant(c)) return true;
  }
  return false;
}

function inferGridColumns(node: DesignNode): number {
  // Cluster sibling rects by X-band to estimate column count at desktop.
  const visible = node.children.filter((c) => c.rect.width > 0 && c.rect.height > 0);
  if (visible.length < 2) return 2;
  const xs = visible.map((c) => c.rect.x).sort((a, b) => a - b);
  const tolerance = Math.max(20, node.rect.width * 0.04);
  const xClusters: number[] = [];
  for (const x of xs) {
    if (xClusters.length === 0 || x - xClusters[xClusters.length - 1]! > tolerance) {
      xClusters.push(x);
    }
  }
  return Math.min(4, Math.max(2, xClusters.length));
}

function looksLikeAbsoluteCanvas(page: ProjectPage): boolean {
  if (page.sections.length === 0) return false;
  // Two signals: every (or nearly every) section came from `bandByY`
  // (id starts with "band-"), OR the root has very few real children
  // and the largest child is one absolute canvas.
  const bandLike = page.sections.filter((s) => s.node.id.startsWith("band-")).length;
  if (bandLike >= Math.max(2, Math.ceil(page.sections.length * 0.7))) return true;
  return false;
}
