/**
 * Top-level pipeline orchestrator. End-to-end for one URL → one Next.js
 * project. The QA loop is mandatory: callers must inject `runGenerated` so
 * the generated site can be served and pixel-diffed against the source.
 * After the loop, runtime integrity invariants run; either failure throws
 * and the run aborts (CLI exits non-zero).
 */

import path from "node:path";
import { createArtifactDirectory } from "../framework/artifacts.js";
import { promises as fs } from "node:fs";
import { request as playwrightRequest } from "playwright";
import type { Logger } from "../utils/logger.js";
import type { ExtractedAsset, ExtractedFontFace } from "../extract/types.js";
import { ensureDir, resolveStateDir, writeTree } from "../utils/files.js";
import { createLogger } from "../utils/logger.js";
import { extractPage } from "../extract/extractPage.js";
import { createFontStylesheetSession } from "../extract/extractFontFaces.js";
import { downloadAssets, type AssetMap } from "../extract/downloadAssets.js";
import { normalizeTree } from "../normalize/normalizeTree.js";
import { groupSections } from "../normalize/groupSections.js";
import { discoverInternalUrls } from "../normalize/discoverUrls.js";
import { urlToRoutePath } from "../normalize/normalizeLinks.js";
import { inferTokens } from "../analyze/inferTokens.js";
import { createProject, type ProjectModel, type ProjectPage } from "../generate/createProject.js";
import { applyQaFixes, applyRegionPatches } from "../patch/applyQaFixes.js";
import { runQaIteration } from "../qa/qaLoop.js";
import { generateFinalReport } from "../qa/generateFinalReport.js";
import { assertGenerationIntegrity, type IntegrityReport } from "../qa/integrity.js";
import type { QaReport } from "../qa/types.js";
import { createRunState, type RunInputs, type RunPaths, type RunState } from "./state.js";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODE,
  DEFAULT_TARGETS,
  DEFAULT_VIEWPORTS,
  type Mode,
  type Viewport,
} from "./thresholds.js";

export type RunGeneratedSiteHandle = {
  readonly url: string;
  readonly dispose: () => Promise<void>;
};

export type RunGenerated = (projectDir: string) => Promise<RunGeneratedSiteHandle>;

export type RunAgentArgs = {
  readonly url: string;
  readonly outDir: string;
  readonly mode?: Mode;
  readonly maxIterations?: number;
  readonly viewports?: readonly Viewport[];
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly stateRoot?: string;
  /** Max additional same-host pages to crawl. Default: 8. Set to 0 to disable crawl. */
  readonly maxPages?: number;
  /** Inject how the generated site is served. Required - the QA loop is mandatory. */
  readonly runGenerated: RunGenerated;
};

export type RunAgentResult = {
  readonly runId: string;
  readonly state: RunState;
  readonly stateDir: string;
  readonly outDir: string;
  readonly generatedFiles: number;
  readonly iterations: number;
  readonly finalQa: QaReport | null;
  readonly integrity: IntegrityReport | null;
};

/** Deep-clone a viewport→DesignNode map. The DesignNode tree is plain
 * data - JSON round-trip is sufficient and avoids hand-rolled mutation
 * recursion. Used to capture a pristine pre-iteration snapshot of the
 * extraction tree for the owner-overwrite patcher. */
function cloneTrees<T>(trees: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(trees)) {
    out[k] = JSON.parse(JSON.stringify(v));
  }
  return out;
}

export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const env = args.env ?? process.env;
  const logger = args.logger ?? createLogger({});
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  const stateDir = resolveStateDir(runId, {
    ...env,
    ...(args.stateRoot ? { WEBSITE_COPY_STATE_DIR: args.stateRoot } : {}),
  });
  await createArtifactDirectory(args.outDir);
  const paths: RunPaths = {
    outDir: path.resolve(args.outDir),
    stateDir,
    extractionDir: path.join(stateDir, "extraction"),
    screenshotsDir: path.join(stateDir, "screenshots"),
    assetsDir: path.join(stateDir, "assets"),
    reportsDir: path.join(stateDir, "reports"),
  };

  const inputs: RunInputs = {
    url: args.url,
    mode: args.mode ?? DEFAULT_MODE,
    maxIterations: args.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    viewports: args.viewports ?? DEFAULT_VIEWPORTS,
    targets: DEFAULT_TARGETS,
  };

  await Promise.all(
    [
      paths.stateDir,
      paths.extractionDir,
      paths.screenshotsDir,
      paths.assetsDir,
      paths.reportsDir,
      paths.outDir,
    ].map(ensureDir),
  );

  const state = createRunState({
    meta: { runId, startedAt },
    inputs,
    paths,
  });

  logger.info("run started", {
    runId,
    url: inputs.url,
    mode: inputs.mode,
    stateDir,
    outDir: paths.outDir,
  });

  // ── Phase 1-2: render + extract per viewport ───────────────────────────
  const stage1 = logger.child("extract");
  const originalsByViewport: Record<string, Buffer> = {};
  type ExtractedPage = Awaited<ReturnType<typeof extractPage>>["page"];
  const extractionsByViewport: Record<string, ExtractedPage> = {};
  const capturedFontFaces: ExtractedFontFace[] = [];
  const fontStylesheets = createFontStylesheetSession();
  // Per-page-per-viewport originals so the QA loop can diff every route
  // (root + crawled subpages) at every viewport.
  const originalsByPageViewport: Record<string, Record<string, Buffer>> = { "": {} };
  let representativeExtraction: ExtractedPage | null = null;

  for (const vp of inputs.viewports) {
    const screenshotPath = path.join(paths.screenshotsDir, `original-${vp.name}.png`);
    stage1.info("extracting", { viewport: vp.name, url: inputs.url });
    const { page: extracted, screenshot } = await extractPage({
      url: inputs.url,
      viewport: vp,
      screenshotPath,
      fontStylesheets,
    });
    await fs.writeFile(
      path.join(paths.extractionDir, `page-${vp.name}.json`),
      JSON.stringify(extracted, null, 2),
      "utf8",
    );
    originalsByViewport[vp.name] = screenshot;
    originalsByPageViewport[""]![vp.name] = screenshot;
    extractionsByViewport[vp.name] = extracted;
    capturedFontFaces.push(...extracted.fontFaces);
    if (vp.name === "desktop" || !representativeExtraction) {
      representativeExtraction = extracted;
    }
  }

  if (!representativeExtraction) {
    throw new Error("runAgent: at least one viewport must succeed extraction");
  }

  stage1.info("extracted", {
    viewports: inputs.viewports.map((v) => v.name),
    nodes: countNodes(representativeExtraction.root),
    assets: representativeExtraction.assets.length,
    fonts: representativeExtraction.fonts.length,
  });

  // Collect root-page assets now; materialize the combined deduplicated set
  // only after bounded subpage discovery so one per-run ceiling covers the
  // entire copy operation. Responsive layouts can surface different URLs.
  const publicAssetsDir = path.join(paths.outDir, "public", "assets");
  const allAssets: ExtractedAsset[] = [
    ...representativeExtraction.assets,
    ...Object.entries(extractionsByViewport)
      .filter(([name]) => name !== representativeExtraction!.viewport.name)
      .flatMap(([, p]) => p.assets),
  ];
  // ── Phase 3: normalize + analyze (root page) ──────────────────────────
  const stage3 = logger.child("analyze");
  const designRoot = normalizeTree(representativeExtraction.root);
  const sections = groupSections(designRoot);
  const tokens = inferTokens(designRoot);
  stage3.info("analyzed", {
    sections: sections.map((s) => s.kind),
    pageColor: tokens.colors.page,
    inkColor: tokens.colors.ink,
    accentColor: tokens.colors.accent,
    fonts: tokens.fontFamilies.slice(0, 3),
  });

  const rootsByViewport: Record<string, typeof designRoot> = {};
  for (const [name, ext] of Object.entries(extractionsByViewport)) {
    rootsByViewport[name] = normalizeTree(ext.root);
  }
  const pages: ProjectPage[] = [
    {
      routePath: "",
      url: inputs.url,
      metadata: representativeExtraction.metadata,
      sections,
      root: designRoot,
      rootsByViewport,
      sourceRootsByViewport: cloneTrees(rootsByViewport),
    },
  ];

  // ── Phase 3.5: depth-1 crawl of same-host links ───────────────────────
  const maxPages = args.maxPages ?? 8;
  if (!Number.isInteger(maxPages) || maxPages < 0 || maxPages > 64) {
    throw new Error("maxPages must be 0-64");
  }
  if (maxPages > 0) {
    const stageCrawl = logger.child("crawl");
    const internalUrls = discoverInternalUrls({
      root: representativeExtraction.root,
      sourceUrl: inputs.url,
      maxUrls: maxPages,
    });
    stageCrawl.info("urls discovered", { count: internalUrls.length });

    for (const subUrl of internalUrls) {
      const routePath = urlToRoutePath(subUrl, inputs.url);
      if (routePath === null || routePath === "") continue;
      try {
        stageCrawl.info("extracting subpage", { url: subUrl, routePath });
        // Per-viewport extraction lets subpages retain the source's
        // mobile and tablet layouts.
        const subExtractionsByViewport: Record<string, ExtractedPage> = {};
        originalsByPageViewport[routePath] ??= {};
        for (const vp of inputs.viewports) {
          const screenshotPath = path.join(
            paths.screenshotsDir,
            `original-${routePath.replace(/\//g, "_")}-${vp.name}.png`,
          );
          const { page: subExtracted, screenshot: subScreenshot } = await extractPage({
            url: subUrl,
            viewport: vp,
            screenshotPath,
            fontStylesheets,
          });
          subExtractionsByViewport[vp.name] = subExtracted;
          capturedFontFaces.push(...subExtracted.fontFaces);
          originalsByPageViewport[routePath]![vp.name] = subScreenshot;
          await fs.writeFile(
            path.join(paths.extractionDir, `page-${routePath.replace(/\//g, "_")}-${vp.name}.json`),
            JSON.stringify(subExtracted, null, 2),
            "utf8",
          );
        }
        const subDesktop =
          subExtractionsByViewport.desktop ?? subExtractionsByViewport[inputs.viewports[0]!.name]!;
        // Add subpage assets from every viewport to the single bounded
        // materialization pass.
        const allSubAssets = Object.values(subExtractionsByViewport).flatMap((p) => p.assets);
        allAssets.push(...allSubAssets);

        const subDesignRoot = normalizeTree(subDesktop.root);
        const subSections = groupSections(subDesignRoot);
        const subRootsByViewport: Record<string, typeof subDesignRoot> = {};
        for (const [name, ext] of Object.entries(subExtractionsByViewport)) {
          subRootsByViewport[name] = normalizeTree(ext.root);
        }
        pages.push({
          routePath,
          url: subUrl,
          metadata: subDesktop.metadata,
          sections: subSections,
          root: subDesignRoot,
          rootsByViewport: subRootsByViewport,
          sourceRootsByViewport: cloneTrees(subRootsByViewport),
        });
      } catch (err) {
        stageCrawl.warn("subpage extraction failed", {
          url: subUrl,
          error: (err as Error).message,
        });
      }
    }
    stageCrawl.info("crawl complete", { pagesTotal: pages.length });
  }

  // ── Phase 3.75: materialize assets to <outDir>/public/assets/ ───────
  const stageDownload = logger.child("download");
  const assetRequest = await playwrightRequest.newContext();
  let assetMap: AssetMap;
  try {
    assetMap = await downloadAssets({
      assets: allAssets,
      publicDir: publicAssetsDir,
      request: assetRequest,
      sourceUrl: inputs.url,
      logger: { warn: (msg, data) => stageDownload.warn(msg, data ?? {}) },
    });
  } finally {
    await assetRequest.dispose();
  }
  stageDownload.info("downloaded", {
    requested: allAssets.length,
    saved: assetMap.size,
    publicAssetsDir,
  });

  let model: ProjectModel = {
    siteName: deriveSiteName(representativeExtraction.metadata.title, inputs.url),
    sourceUrl: inputs.url,
    mode: inputs.mode,
    metadata: representativeExtraction.metadata,
    tokens,
    sections,
    root: designRoot,
    assetMap,
    fontFaces: dedupeFontFaces(capturedFontFaces),
    pages,
  };

  // ── Phase 4-5: initial generation ──────────────────────────────────────
  const stage4 = logger.child("generate");
  let tree = createProject(model);
  await writeTree(paths.outDir, tree);
  stage4.info("generated", { files: Object.keys(tree).length, outDir: paths.outDir });

  // ── Phase 6-8: QA loop (mandatory) ─────────────────────────────────────
  let finalQa: QaReport | null = null;
  let iterations = 0;
  {
    const stageQa = logger.child("qa");
    for (let i = 1; i <= inputs.maxIterations; i++) {
      iterations = i;
      stageQa.info("starting iteration", { iteration: i });
      const handle = await args.runGenerated(paths.outDir);
      let report: QaReport;
      let patchesByPageViewport: Awaited<
        ReturnType<typeof runQaIteration>
      >["patchesByPageViewport"] = {};
      let regionReportsByPageViewport: Awaited<
        ReturnType<typeof runQaIteration>
      >["regionReportsByPageViewport"] = {};
      try {
        // Build a QaPageInput per project page (root + crawled subpages).
        // Each input carries that page's per-viewport source screenshots
        // and per-viewport DesignNode roots so owner lookup matches the
        // tree the renderer actually used.
        const qaPages = model.pages.map((p) => {
          const route = p.routePath;
          const pageOriginals = originalsByPageViewport[route] ?? {};
          const subUrlBase = handle.url.replace(/\/+$/, "");
          const generatedUrl = route
            ? `${subUrlBase}/${route.replace(/^\/+/, "")}/`
            : `${subUrlBase}/`;
          return {
            route,
            generatedUrl,
            originalsByViewport: pageOriginals,
            ...(p.rootsByViewport ? { rootsByViewport: p.rootsByViewport } : {}),
            defaultRoot: p.root,
          };
        });
        const result = await runQaIteration({
          iteration: i,
          viewports: inputs.viewports,
          pages: qaPages,
          screenshotsDir: paths.screenshotsDir,
          reportsDir: paths.reportsDir,
          targets: inputs.targets,
        });
        report = result.report;
        patchesByPageViewport = result.patchesByPageViewport;
        regionReportsByPageViewport = result.regionReportsByPageViewport;
      } finally {
        await handle.dispose().catch((err) => {
          stageQa.warn("dispose failed", { error: (err as Error).message });
        });
      }
      finalQa = report;
      stageQa.info("iteration result", {
        iteration: i,
        meetsTargets: report.meetsTargets,
        similarityMet: report.similarityMet,
        scores: Object.fromEntries(
          report.results.map((r) => [`${r.route || "/"}@${r.viewport}`, r.similarity]),
        ),
        tilesFailed: Object.fromEntries(
          report.results.map((r) => [`${r.route || "/"}@${r.viewport}`, r.tilesFailed]),
        ),
        totalTilesFailed: report.results.reduce((n, r) => n + r.tilesFailed, 0),
        unfixedRegions: report.results.flatMap((r) =>
          r.regions
            .filter((rg) => !rg.patchable && rg.diagnosis.kind !== "anti-aliasing")
            .map((rg) => ({
              route: r.route || "/",
              viewport: r.viewport,
              kind: rg.diagnosis.kind,
              owner: rg.ownerLabel,
              pixels: rg.region.mismatchedPixels,
            })),
        ),
      });
      if (report.meetsTargets) break;
      if (i === inputs.maxIterations) break;

      // Apply targeted region patches first (specific bg-color / position
      // / size fixes), then fall back to the legacy coarse patcher (token
      // nudges, mode escalation) for anything the region patcher couldn't
      // address.
      const totalPatches = Object.values(patchesByPageViewport).reduce((n, ps) => n + ps.length, 0);
      if (totalPatches > 0) {
        model = applyRegionPatches({ model, patchesByPageViewport });
      }
      // Unhandled diagnoses remain visible to the agent; do not infer a
      // replacement color by averaging a tile containing several elements.
      const rootViewportReports = Object.fromEntries(
        Object.entries(regionReportsByPageViewport)
          .filter(([key]) => key.startsWith("::"))
          .map(([key, val]) => [key.slice(2), val]),
      );
      model = applyQaFixes(model, report, rootViewportReports, i);
      tree = createProject(model);
      await writeTree(paths.outDir, tree);
      stageQa.info("regenerated", {
        iteration: i,
        files: Object.keys(tree).length,
        mode: model.mode,
        regionPatches: totalPatches,
      });
    }
  }

  // ── Phase 8.5: runtime integrity invariants ────────────────────────────
  // These run regardless of QA pass/fail - they catch dishonest output
  // (inline base64, source-domain hotlinks), structural failures
  // (double-translated transforms), and dropped images. Failure
  // throws and aborts before the final report is written.
  const stageIntegrity = logger.child("integrity");
  let integrityReport: IntegrityReport | null = null;
  try {
    integrityReport = await assertGenerationIntegrity({
      outDir: paths.outDir,
      sourceUrl: inputs.url,
      extractedRoot: representativeExtraction.root,
    });
    stageIntegrity.info("integrity passed", {
      invariants: integrityReport.invariants.map((i) => i.name),
    });
  } catch (err) {
    stageIntegrity.error("integrity failed", { error: (err as Error).message });
    throw err;
  }

  // QA must have run AND met its targets. The integrity check above does
  // not subsume similarity - a tree can be structurally valid yet visually
  // off. Refuse to write a "final report" that papers over either failure.
  if (!finalQa) {
    throw new Error("runAgent: QA loop did not produce a report - generation pipeline is broken.");
  }

  // ── Phase 9: final report ──────────────────────────────────────────────
  const finalReportMd = generateFinalReport({
    sourceUrl: inputs.url,
    outDir: paths.outDir,
    runId,
    mode: inputs.mode,
    maxIterations: inputs.maxIterations,
    iteration: iterations,
    tokens: model.tokens,
    assets: representativeExtraction.assets,
    failedAssets: [],
    qa: finalQa,
    generatedFiles: Object.keys(tree).length,
    integrity: integrityReport,
  });
  await fs.writeFile(path.join(paths.reportsDir, "final-report.md"), finalReportMd, "utf8");
  await fs.writeFile(path.join(paths.outDir, "FINAL_REPORT.md"), finalReportMd, "utf8");

  return {
    runId,
    state,
    stateDir,
    outDir: paths.outDir,
    generatedFiles: Object.keys(tree).length,
    iterations,
    finalQa,
    integrity: integrityReport,
  };
}

function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function dedupeFontFaces(faces: readonly ExtractedFontFace[]): readonly ExtractedFontFace[] {
  const seen = new Set<string>();
  return faces.filter((face) => {
    const key = JSON.stringify(face);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveSiteName(title: string | null, url: string): string {
  if (title && title.trim()) return title.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "rebuilt-site";
  }
}

function countNodes(root: { children: readonly { children: readonly unknown[] }[] }): number {
  let count = 1;
  const stack: { children: readonly { children: readonly unknown[] }[] }[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children) {
      count++;
      stack.push(c as never);
    }
  }
  return count;
}
