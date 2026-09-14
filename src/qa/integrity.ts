/**
 * Runtime integrity checks for generated projects.
 *
 * Anti-cheat: refuse outputs that embed the source's screenshot, hotlink the
 * source assets, or skip distinctive text. Structural: refuse outputs that
 * double-apply transforms or drop visible source images.
 *
 * These checks run on every CLI invocation (wired into runAgent) so a
 * dishonest run cannot ship. They are also called by the live-fidelity
 * integration test for the same guarantees against the real source.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExtractedNode } from "../extract/types.js";

export type IntegrityFile = {
  readonly path: string;
  readonly contents: string;
};

export type IntegrityInput = {
  readonly outDir: string;
  readonly sourceUrl: string;
  readonly extractedRoot: ExtractedNode;
};

export type IntegrityReport = {
  readonly violations: readonly string[];
  readonly invariants: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail?: string;
  }[];
};

const VISIBLE_IMAGE_MIN_WIDTH = 200;
const DISTINCTIVE_PHRASE_MIN_LEN = 30;
const DISTINCTIVE_PHRASE_MAX = 4;

export async function assertGenerationIntegrity(input: IntegrityInput): Promise<IntegrityReport> {
  const files = await collectGeneratedFiles(input.outDir);
  const concatenated = files.map((f) => f.contents).join("\n");
  const violations: string[] = [];
  const invariants: { name: string; passed: boolean; detail?: string }[] = [];

  const record = (name: string, found: readonly string[]): void => {
    if (found.length === 0) {
      invariants.push({ name, passed: true });
      return;
    }
    const first = found[0];
    if (first !== undefined) {
      invariants.push({ name, passed: false, detail: first });
    } else {
      invariants.push({ name, passed: false });
    }
    violations.push(...found.map((v) => `[${name}] ${v}`));
  };

  record("no-base64-rasters", checkNoBase64Rasters(concatenated));
  record("no-source-domain-leakage", checkNoSourceDomainLeakage(concatenated, input.sourceUrl));
  record("no-remote-asset-references", checkNoRemoteAssetReferences(concatenated));
  record(
    "asset-references-resolve",
    await checkAssetReferencesResolve(concatenated, path.join(input.outDir, "public", "assets")),
  );
  record(
    "distinctive-phrases-present",
    checkDistinctivePhrasesPresent(concatenated, deriveDistinctivePhrases(input.extractedRoot)),
  );
  record("no-transform-with-rect-translation", checkNoTransformWithRectTranslation(files));
  record("image-coverage", checkImageCoverage(input.extractedRoot, concatenated));

  if (violations.length > 0) {
    const detail = violations.map((v) => `  - ${v}`).join("\n");
    throw new Error(`Integrity check failed:\n${detail}`);
  }

  return { violations: [], invariants };
}

// ─── Individual checks ─────────────────────────────────────────────────────

function checkNoBase64Rasters(concatenated: string): readonly string[] {
  const m = concatenated.match(/data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+/);
  if (!m) return [];
  // Inline SVG (data:image/svg+xml) is allowed - those are reconstructable
  // vector paths, not screenshots.
  return [
    `Inline base64 raster detected (length ${m[0].length}); embeds a screenshot of the source.`,
  ];
}

function checkNoSourceDomainLeakage(concatenated: string, sourceUrl: string): readonly string[] {
  let hostname = "";
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch {
    return [];
  }
  if (!hostname) return [];
  // Only flag the hostname when it appears in a URL position (href="...",
  // src="...", url(...)). Body text legitimately may say "example.com does X".
  const escaped = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:href|src)\\s*=\\s*["'][^"']*${escaped}|url\\(['"]?[^)]*${escaped}`,
    "i",
  );
  const out: string[] = [];
  if (re.test(concatenated)) {
    out.push(`Source hostname '${hostname}' appears in a URL context (href/src/url()).`);
  }
  return out;
}

function checkNoRemoteAssetReferences(concatenated: string): readonly string[] {
  const patterns = [/(?:src|poster)\s*=\s*["']https?:\/\//i, /url\(\s*["']?https?:\/\//i];
  return patterns.some((pattern) => pattern.test(concatenated))
    ? ["Generated source still references a remote media or font asset."]
    : [];
}

async function checkAssetReferencesResolve(
  concatenated: string,
  assetsDir: string,
): Promise<readonly string[]> {
  const referenced = new Set<string>();
  for (const m of concatenated.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) {
    referenced.add(m[1]!);
  }
  let onDisk: string[] = [];
  try {
    onDisk = await fs.readdir(assetsDir);
  } catch {
    onDisk = [];
  }
  const out: string[] = [];
  for (const ref of referenced) {
    if (!onDisk.includes(ref)) {
      out.push(`Asset referenced but not on disk: /assets/${ref}`);
    }
  }
  return out;
}

function checkDistinctivePhrasesPresent(
  concatenated: string,
  phrases: readonly string[],
): readonly string[] {
  const out: string[] = [];
  for (const phrase of phrases) {
    if (!concatenated.includes(phrase)) {
      out.push(`Distinctive phrase missing from generated tree: "${phrase}"`);
    }
  }
  return out;
}

/**
 * No element should carry both rect-derived `left:`/`top:` AND a
 * `transform: matrix(...)` whose translation components (tx, ty) are
 * non-zero. Rect already encodes post-transform position; preserving the
 * matrix translates the element a second time.
 */
function checkNoTransformWithRectTranslation(files: readonly IntegrityFile[]): readonly string[] {
  const out: string[] = [];
  const styleRe = /style=\{\{([^}]*)\}\}/g;
  for (const file of files) {
    if (!/\.tsx$/.test(file.path)) continue;
    for (const match of file.contents.matchAll(styleRe)) {
      const block = match[1] ?? "";
      if (!/"left":/.test(block) && !/"top":/.test(block)) continue;
      const tMatch = block.match(/"transform":\s*"([^"]+)"/);
      if (!tMatch) continue;
      const t = tMatch[1]!;
      if (transformHasNonZeroTranslation(t)) {
        out.push(
          `${path.basename(file.path)}: element with rect-derived left/top also has transform with non-zero translation: "${t}".`,
        );
        if (out.length >= 5) return out; // cap noise
      }
    }
  }
  return out;
}

function transformHasNonZeroTranslation(transform: string): boolean {
  if (!transform || transform === "none") return false;
  // matrix(a, b, c, d, tx, ty)
  const matrix =
    /matrix\(\s*([^,)]+),\s*([^,)]+),\s*([^,)]+),\s*([^,)]+),\s*([^,)]+),\s*([^,)]+)\)/g;
  for (const m of transform.matchAll(matrix)) {
    const tx = parseFloat(m[5] ?? "0");
    const ty = parseFloat(m[6] ?? "0");
    if (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5) return true;
  }
  // matrix3d(...,...,...,m41,m42,m43,m44) - positions 13,14 (0-indexed 12,13)
  const matrix3d = /matrix3d\(([^)]+)\)/g;
  for (const m of transform.matchAll(matrix3d)) {
    const parts = (m[1] ?? "").split(",").map((s) => parseFloat(s.trim()));
    if (parts.length >= 14) {
      const tx = parts[12] ?? 0;
      const ty = parts[13] ?? 0;
      if (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5) return true;
    }
  }
  // translate(x, y) / translateX / translateY / translate3d
  const translate = /translate(?:X|Y|3d)?\(([^)]+)\)/gi;
  for (const m of transform.matchAll(translate)) {
    const parts = (m[1] ?? "").split(",").map((s) => parseFloat(s.trim()));
    if (parts.some((n) => !Number.isNaN(n) && Math.abs(n) > 0.5)) return true;
  }
  return false;
}

/**
 * Every visible source `<img>` of width ≥ 200px must have a matching
 * `/assets/<file>` reference in the generated tree. If extraction dropped
 * source media (lazy-load not triggered), this catches it.
 */
function checkImageCoverage(extractedRoot: ExtractedNode, concatenated: string): readonly string[] {
  const sourceImgs = collectVisibleImages(extractedRoot);
  if (sourceImgs.length === 0) return [];
  const referencedAssets = new Set<string>();
  for (const m of concatenated.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) {
    referencedAssets.add(m[1]!);
  }
  // We can't know exact asset filenames here without the asset-map, but we
  // can demand that the generated output references AT LEAST as many
  // distinct assets as there are wide-visible source images. This is a
  // conservative coverage gate - better than nothing, doesn't false-positive
  // when one source URL maps to two filenames after deduping.
  const wideCount = sourceImgs.filter((i) => i.width >= VISIBLE_IMAGE_MIN_WIDTH).length;
  if (wideCount === 0) return [];
  // Allow a small slack: we only need 70% coverage to pass - some images
  // are decorative siblings or responsive alternatives. Below 70% is
  // dropping content.
  const required = Math.ceil(wideCount * 0.7);
  if (referencedAssets.size < required) {
    return [
      `Image coverage too low: source has ${wideCount} wide visible images, generated tree references only ${referencedAssets.size} assets (need ≥${required}).`,
    ];
  }
  return [];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function collectVisibleImages(
  root: ExtractedNode,
): { src: string; width: number; height: number }[] {
  const out: { src: string; width: number; height: number }[] = [];
  const visit = (n: ExtractedNode): void => {
    if (n.tag === "img" && n.src) {
      out.push({ src: n.src, width: n.rect.width, height: n.rect.height });
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

function deriveDistinctivePhrases(root: ExtractedNode): readonly string[] {
  const phrases: { text: string; importance: number }[] = [];
  const visit = (n: ExtractedNode): void => {
    if (n.text) {
      const trimmed = n.text.trim();
      if (trimmed.length >= DISTINCTIVE_PHRASE_MIN_LEN) {
        // Prefer headings (h1-h3) - they're more distinctive than paragraphs.
        const tagBoost = /^h[1-3]$/.test(n.tag) ? 100 : 0;
        const lengthScore = Math.min(trimmed.length, 200);
        phrases.push({ text: trimmed, importance: tagBoost + lengthScore });
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  phrases.sort((a, b) => b.importance - a.importance);
  // Take a partial substring (first ~40 chars) so minor whitespace/punctuation
  // changes don't trip the gate but a fully missing phrase still does.
  return phrases
    .slice(0, DISTINCTIVE_PHRASE_MAX)
    .map((p) => p.text.slice(0, 40))
    .filter((p) => p.length > 0);
}

export async function collectGeneratedFiles(outDir: string): Promise<readonly IntegrityFile[]> {
  const targets = ["app", "components", "data"];
  const files: { path: string; contents: string }[] = [];
  for (const root of targets) {
    const absRoot = path.join(outDir, root);
    try {
      await walk(absRoot, files);
    } catch {
      // dir may not exist for some generators
    }
  }
  return files;
}

async function walk(dir: string, out: { path: string; contents: string }[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && /\.(ts|tsx|js|jsx|css|json)$/.test(e.name)) {
      const contents = await fs.readFile(full, "utf8");
      out.push({ path: full, contents });
    }
  }
}
