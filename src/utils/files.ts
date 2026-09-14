/**
 * Filesystem utilities. Effects are isolated here so the rest of the codebase
 * can stay pure.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type FileTree = Readonly<Record<string, string | Buffer>>;

/**
 * Pure: build a relative-path → contents map. No IO.
 */
export function mergeTrees(...trees: FileTree[]): FileTree {
  const out: Record<string, string | Buffer> = {};
  for (const tree of trees) {
    for (const [key, value] of Object.entries(tree)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Pure: produce a derived tree by mapping every entry. No IO.
 */
export function mapTree<T extends string | Buffer>(
  tree: FileTree,
  fn: (relPath: string, contents: string | Buffer) => T,
): Readonly<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(tree)) {
    out[k] = fn(k, v);
  }
  return out;
}

/**
 * Effectful: write a FileTree to disk under `root`. Creates parent dirs.
 */
export async function writeTree(root: string, tree: FileTree): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  for (const [relPath, contents] of Object.entries(tree)) {
    const abs = path.join(root, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (typeof contents === "string") {
      await fs.writeFile(abs, contents, "utf8");
    } else {
      await fs.writeFile(abs, contents);
    }
  }
}

/**
 * Effectful: ensure dir exists, idempotent.
 */
export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

/**
 * Effectful: best-effort recursive removal. Never throws.
 */
export async function removeDir(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

/** Explicit artifact root; no implicit home directory or cross-run state. */
export function resolveStateDir(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = env.WEBSITE_COPY_STATE_DIR;
  if (!root?.trim()) throw new Error("Set WEBSITE_COPY_STATE_DIR or pass stateRoot explicitly");
  return path.resolve(root, runId);
}
