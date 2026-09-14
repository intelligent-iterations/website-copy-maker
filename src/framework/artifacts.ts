import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Artifacts are explicit outputs. Never reuse or delete a caller's directory. */
export async function createArtifactDirectory(directory: string): Promise<string> {
  const root = path.resolve(directory);
  await fs.mkdir(path.dirname(root), { recursive: true });
  await fs.mkdir(root); // EEXIST fails closed, including symlinks and empty directories.
  await fs.writeFile(
    path.join(root, ".website-copy-owner.json"),
    JSON.stringify({
      tool: "website-copy-maker",
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
  return root;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

/** Reference bundles may be moved, but their paths must stay inside the bundle. */
export async function readArtifact(root: string, relative: string): Promise<Buffer> {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid reference artifact path: ${relative}`);
  }
  const realRoot = await fs.realpath(root);
  const target = await fs.realpath(path.resolve(realRoot, relative));
  if (!target.startsWith(realRoot + path.sep))
    throw new Error("Artifact escapes reference directory");
  return fs.readFile(target);
}
