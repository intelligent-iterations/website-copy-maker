import { promises as fs } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { extractPage } from "../extract/extractPage.js";
import type { ExtractedNode, ExtractedPage } from "../extract/types.js";
import { normalizeTree } from "../normalize/normalizeTree.js";
import { compareScreenshots, TILE_MAX_RATIO } from "../qa/compareScreenshots.js";
import { findElementForRegion, type RegionBox } from "../qa/regionToElement.js";
import { createArtifactDirectory, readArtifact, writeJson } from "./artifacts.js";
import { httpUrl, sha256, validateScenarios, validateViewports } from "./capture.js";
import { collectControls, compareLinks, replayInteractions } from "./interactions.js";
import type { ReferenceManifest, ReferenceScene } from "./types.js";

export type EvaluateReplicaArgs = {
  readonly referenceDir: string;
  readonly url: string;
  readonly outDir: string;
};

function describeOwner(root: ExtractedNode, box: RegionBox) {
  const match = findElementForRegion(box, normalizeTree(root));
  let raw: ExtractedNode | null = null;
  const find = (node: ExtractedNode): void => {
    if (node.id === match.node?.id) raw = node;
    for (const child of node.children) find(child);
  };
  find(root);
  const node = raw as ExtractedNode | null;
  return node
    ? {
        nodeId: node.id,
        tag: node.tag,
        text: node.text,
        rect: node.rect,
        styles: node.styles,
        selector: node.selector ?? null,
        codeHint: node.attributes["data-source-file"] ?? null,
        ancestors: match.ancestors.map((ancestor) => ({
          id: ancestor.id,
          type: ancestor.type,
          rect: ancestor.rect,
        })),
        confidence: "geometric-candidate; inspect screenshot, ancestors, and code before editing",
      }
    : null;
}

function crop(buffer: Buffer, box: RegionBox): Buffer {
  const source = PNG.sync.read(buffer);
  const out = new PNG({ width: box.width, height: box.height });
  out.data.fill(255);
  const width = Math.max(0, Math.min(box.width, source.width - box.x));
  const height = Math.max(0, Math.min(box.height, source.height - box.y));
  if (width && height) PNG.bitblt(source, out, box.x, box.y, width, height, 0, 0);
  return PNG.sync.write(out);
}

export async function loadReference(referenceDir: string): Promise<ReferenceManifest> {
  const manifest: ReferenceManifest = JSON.parse(
    (await readArtifact(referenceDir, "reference.json")).toString(),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.deviceScaleFactor !== 1 ||
    !Array.isArray(manifest.scenes) ||
    !manifest.scenes.length ||
    manifest.scenes.length > 96 ||
    !Array.isArray(manifest.omittedUrls)
  ) {
    throw new Error("Invalid or unsupported reference manifest");
  }
  const source = httpUrl(manifest.sourceUrl);
  const ids = new Set<string>();
  for (const scene of manifest.scenes) {
    if (
      !/^scene-\d{3}$/.test(scene.id) ||
      ids.has(scene.id) ||
      !Array.isArray(scene.captures) ||
      httpUrl(scene.url).origin !== source.origin ||
      !scene.route.startsWith("/") ||
      scene.route.startsWith("//") ||
      scene.route !== new URL(scene.url).pathname + new URL(scene.url).search
    ) {
      throw new Error("Invalid reference scene");
    }
    ids.add(scene.id);
    validateViewports(
      scene.captures.map((capture: ReferenceScene["captures"][number]) => capture.viewport),
    );
    if (scene.scenario) validateScenarios([scene.scenario]);
    for (const capture of scene.captures) {
      for (const kind of ["screenshot", "extraction"] as const) {
        const bytes = await readArtifact(referenceDir, capture[kind]);
        if (sha256(bytes) !== capture.sha256[kind])
          throw new Error(`Reference changed: ${capture[kind]}`);
      }
    }
  }
  return manifest;
}

/** Evaluate any running replica; never regenerate, start a server, or write project code. */
export async function evaluateReplica(args: EvaluateReplicaArgs) {
  const manifest = await loadReference(args.referenceDir);
  const replicaBase = httpUrl(args.url);
  if (replicaBase.pathname !== "/" || replicaBase.search)
    throw new Error("Replica URL must be a server origin");
  const outDir = await createArtifactDirectory(args.outDir);
  const results = [];
  for (const scene of manifest.scenes) {
    for (const reference of scene.captures) {
      try {
        results.push(
          await evaluateScene(scene, reference, manifest, args.referenceDir, replicaBase, outDir),
        );
      } catch (error) {
        results.push({
          scene: scene.id,
          route: scene.route,
          viewport: reference.viewport.name,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const report = {
    schemaVersion: 1,
    evaluatedAt: new Date().toISOString(),
    sourceUrl: manifest.sourceUrl,
    replicaUrl: replicaBase.href,
    scope:
      "Captured pages and viewports, link destinations, and source-verified interaction scenarios only.",
    routeCoverageComplete: manifest.omittedUrls.length === 0,
    omittedUrls: manifest.omittedUrls,
    passed:
      manifest.omittedUrls.length === 0 &&
      results.length > 0 &&
      results.every((result) => result.passed),
    results,
  };
  await writeJson(path.join(outDir, "evaluation.json"), report);
  return report;
}

async function evaluateScene(
  scene: ReferenceScene,
  reference: ReferenceScene["captures"][number],
  manifest: ReferenceManifest,
  referenceDir: string,
  replicaBase: URL,
  outDir: string,
) {
  const url = new URL(scene.route, replicaBase).href;
  const captured = await extractPage({
    url,
    viewport: reference.viewport,
    ...(scene.scenario
      ? { beforeCapture: (page) => replayInteractions(page, scene.scenario!.steps) }
      : {}),
  });
  const sourceBytes = await readArtifact(referenceDir, reference.screenshot);
  const source: ExtractedPage = JSON.parse(
    (await readArtifact(referenceDir, reference.extraction)).toString(),
  );
  const comparison = await compareScreenshots(sourceBytes, captured.screenshot);
  const prefix = `${scene.id}-${reference.viewport.name}`;
  const replicaPath = `${prefix}-replica.png`;
  const diffPath = `${prefix}-diff.png`;
  await fs.writeFile(path.join(outDir, replicaPath), captured.screenshot, { flag: "wx" });
  await fs.writeFile(path.join(outDir, diffPath), comparison.diffPng, { flag: "wx" });
  await writeJson(path.join(outDir, `${prefix}-replica.json`), captured.page);
  const failed = comparison.tiles
    .filter((tile) => tile.ratio > TILE_MAX_RATIO)
    .sort((a, b) => b.mismatched - a.mismatched);
  const failures = [];
  // All tiles are reported; crops are bounded to the 30 worst per scene/viewport.
  for (const [index, tile] of failed.slice(0, 30).entries()) {
    const crops = {
      source: `${prefix}-tile-${index}-source.png`,
      replica: `${prefix}-tile-${index}-replica.png`,
      diff: `${prefix}-tile-${index}-diff.png`,
    };
    for (const [kind, buffer] of [
      ["source", sourceBytes],
      ["replica", captured.screenshot],
      ["diff", comparison.diffPng],
    ] as const) {
      await fs.writeFile(path.join(outDir, crops[kind]), crop(buffer, tile), { flag: "wx" });
    }
    failures.push({
      tile,
      crops,
      sourceOwner: describeOwner(source.root, tile),
      replicaOwner: describeOwner(captured.page.root, tile),
    });
  }
  const controls = collectControls(source.root);
  const linkIssues = compareLinks(
    controls,
    collectControls(captured.page.root),
    source.url,
    captured.page.url,
  );
  const controlReview = controls
    .filter((control) => control.tag !== "a")
    .map((control) => ({
      ...control,
      note: "Inspect control behavior; scenario coverage is listed separately and is not inferred from appearance.",
    }));
  return {
    scene: scene.id,
    route: scene.route,
    viewport: reference.viewport.name,
    scenario: scene.scenario?.name ?? null,
    passed: comparison.tilesFailed === 0 && linkIssues.length === 0,
    similarity: comparison.similarity,
    tilesFailed: comparison.tilesFailed,
    tiles: comparison.tiles,
    failures,
    cropsOmitted: Math.max(0, failed.length - failures.length),
    linkIssues,
    controlsToReview: controlReview,
    replicaPath,
    diffPath,
    sourceCapture: reference.screenshot,
    sourceOrigin: new URL(manifest.sourceUrl).origin,
  };
}
