/**
 * Pure: build the entire generated FileTree from the analyzed model.
 * The caller writes it to disk via writeTree(). Nothing here touches fs.
 *
 * Multi-page: ProjectModel carries an array of `Page` objects. Each page
 * gets its own `app/<routePath>/page.tsx`; the root page lands at
 * `app/page.tsx`. Tokens, the asset map, and the global CSS are shared
 * across all pages.
 */

import type { ExtractedFontFace, ExtractedMetadata } from "../extract/types.js";
import type { AssetMap } from "../extract/downloadAssets.js";
import type { Section } from "../normalize/groupSections.js";
import type { DesignNode } from "../normalize/types.js";
import type { DesignTokens } from "../analyze/inferTokens.js";
import type { FileTree } from "../utils/files.js";
import type { Mode } from "../agent/thresholds.js";
import { generatePackageJson } from "./generatePackageJson.js";
import { generateTsconfig } from "./generateTsconfig.js";
import { generateTailwindConfig } from "./generateTailwindConfig.js";
import { generateNextConfig, generatePostcssConfig } from "./generateNextConfig.js";
import { generateGlobalsCss } from "./generateGlobalsCss.js";
import { generateLayout } from "./generateLayout.js";
import { generatePage } from "./generatePage.js";

export type ProjectPage = {
  /** "" for the root page; otherwise a slash-joined path like "blog/post-1". */
  readonly routePath: string;
  readonly url: string;
  readonly metadata: ExtractedMetadata;
  readonly sections: readonly Section[];
  readonly root: DesignNode;
  /** Per-viewport DesignNode roots. Present for the root page when extraction
   * captured multiple viewports; empty for crawled subpages (which only run
   * the desktop extraction). The fidelity renderer uses these to emit one
   * canvas per viewport with media-query toggles, so mobile and tablet
   * pixel-match the source's actual mobile layout instead of a scaled-down
   * desktop. */
  readonly rootsByViewport?: Readonly<Record<string, DesignNode>>;
  /** Pristine pre-iter-1 copy of `rootsByViewport`. Populated once at
   * model construction and never mutated. Used by `applyOwnerOverwrites`
   * to read ground-truth source properties even after diagnose-then-patch
   * iterations have drifted the working tree. */
  readonly sourceRootsByViewport?: Readonly<Record<string, DesignNode>>;
};

export type ProjectModel = {
  readonly siteName: string;
  readonly sourceUrl: string;
  readonly mode: Mode;
  /** Root-page metadata, used for layout.tsx <head>. */
  readonly metadata: ExtractedMetadata;
  readonly tokens: DesignTokens;
  /** Convenience for callers that pre-multi-page logic: the root page's section list. */
  readonly sections: readonly Section[];
  readonly root: DesignNode;
  readonly assetMap: AssetMap;
  readonly fontFaces?: readonly ExtractedFontFace[];
  readonly pages: readonly ProjectPage[];
};

export function createProject(model: ProjectModel): FileTree {
  const tree: Record<string, string> = {
    "package.json": generatePackageJson(model),
    "tsconfig.json": generateTsconfig(),
    "tailwind.config.ts": generateTailwindConfig(model.tokens),
    "next.config.ts": generateNextConfig(),
    "postcss.config.js": generatePostcssConfig(),
    "app/layout.tsx": generateLayout(model),
    "app/globals.css": generateGlobalsCss(model.tokens, model.fontFaces ?? [], model.assetMap),
    ".gitignore": GENERATED_GITIGNORE,
    "README.md": generateReadme(model),
  };

  // Emit one page.tsx per crawled route.
  for (const page of model.pages) {
    const filePath = page.routePath === "" ? "app/page.tsx" : `app/${page.routePath}/page.tsx`;
    tree[filePath] = generatePage(model, page);
  }

  return tree;
}

const GENERATED_GITIGNORE = `node_modules/
.next/
out/
.env*
.DS_Store
`;

function generateReadme(model: ProjectModel): string {
  const routes = model.pages.map((p) => (p.routePath === "" ? "/" : `/${p.routePath}/`));
  return `# ${model.siteName}

Copied from \`${model.metadata.title ?? "(untitled)"}\` by website-copy-maker's Next.js/Tailwind adapter.

## Routes

${routes.map((r) => `- \`${r}\``).join("\n")}

## Run locally

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Then open http://localhost:3000.
`;
}
