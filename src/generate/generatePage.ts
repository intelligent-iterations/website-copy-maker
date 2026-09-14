/**
 * Emit a single `app/<route>/page.tsx` containing one page's sections.
 *
 * Mode dispatch:
 *   - "responsive" (default) - semantic responsive Tailwind primitives via
 *     `renderResponsive`, with a per-section fidelity fallback (and the
 *     scaling shell) for absolute-canvas sections that defy reflow.
 *   - "hybrid" - older structure-driven render via `renderSection`. Kept
 *     for backwards compatibility.
 *   - "exact" - flat absolute positioning via `renderFidelity`. When
 *     per-viewport extractions are available (ProjectPage.rootsByViewport)
 *     emits one canvas per viewport gated by media-query show/hide so
 *     mobile and tablet pixel-match the source's actual mobile layout instead
 *     of a scaled-down desktop. Each canvas ships with the scaling shell
 *     so the page never clips on resize.
 *   - "semantic" - currently routed to hybrid (fully semantic-only is
 *     a follow-up; the flag is preserved so existing scripts don't break).
 */

import type { ProjectModel, ProjectPage } from "./createProject.js";
import { renderSection, type RenderCtx } from "./renderSection.js";
import { renderFidelity, type FidelityCtx } from "./renderFidelity.js";
import { renderResponsive } from "./renderResponsive.js";
import type { DesignNode } from "../normalize/types.js";

export function generatePage(model: ProjectModel, page: ProjectPage): string {
  let rendered: string;
  if (model.mode === "exact") {
    rendered = renderExact(model, page);
  } else if (model.mode === "responsive") {
    rendered = renderResponsive(model, page);
  } else {
    rendered = renderHybrid(model, page);
  }
  return `export default function Page() {
  return (
    <main className="min-h-screen bg-page text-ink">
${rendered}
    </main>
  );
}
`;
}

function renderHybrid(model: ProjectModel, page: ProjectPage): string {
  const ctx: RenderCtx = {
    sourceUrl: model.sourceUrl,
    assetMap: model.assetMap,
    mode: model.mode,
  };
  return page.sections
    .map((s) => renderSection(s.node, ctx))
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

const VIEWPORT_VISIBILITY: ReadonlyArray<{
  readonly name: string;
  readonly className: string;
}> = [
  // Mobile is visible up to md (Tailwind's `md` is 768px) - matches the
  // pipeline's mobile viewport (390px) extraction.
  { name: "mobile", className: "block md:hidden" },
  // Tablet is visible md..lg (Tailwind's `lg` is 1024px) - matches the
  // pipeline's tablet viewport (768px) extraction.
  { name: "tablet", className: "hidden md:block lg:hidden" },
  // Desktop is visible from lg up - matches the pipeline's desktop
  // viewport (1440px) extraction. The scaling shell still keeps it
  // proportional at viewports between 1024px and 1440px.
  { name: "desktop", className: "hidden lg:block" },
];

function renderExact(model: ProjectModel, page: ProjectPage): string {
  const ctx: FidelityCtx = {
    sourceUrl: model.sourceUrl,
    assetMap: model.assetMap,
  };
  const roots = page.rootsByViewport;
  // Single-canvas (back-compat / subpages without per-viewport extraction):
  if (!roots || Object.keys(roots).length === 0) {
    return renderFidelity(page.root, ctx);
  }
  const desktopRoot: DesignNode = roots.desktop ?? page.root;
  // If only the desktop tree is present, fall back to the original
  // single-canvas emit (still wrapped in scaling shell).
  const distinctRoots = new Set(VIEWPORT_VISIBILITY.map(({ name }) => roots[name] ?? desktopRoot));
  if (distinctRoots.size === 1) {
    return renderFidelity(page.root, ctx);
  }
  // Emit one canvas per viewport. Each canvas is the result of
  // renderFidelity against its viewport's extraction, wrapped in a media-
  // query gated div that hides the others. Indent + 2 because we're nested
  // one extra level inside <main> > <div className="canvas-toggle">.
  const canvases = VIEWPORT_VISIBILITY.map(({ name, className }) => {
    const root = roots[name] ?? desktopRoot;
    const inner = renderFidelity(root, ctx, 10);
    return `      <div className="${className}">\n${inner}\n      </div>`;
  });
  return canvases.join("\n");
}
