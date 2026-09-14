import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const owned = new Map<string, string>();
const marker = ".test-owner.json";

export async function makeTestDir(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(prefix);
  const token = randomUUID();
  await fs.writeFile(path.join(root, marker), token, { flag: "wx" });
  owned.set(root, token);
  return root;
}

export async function removeTestDir(root: string): Promise<void> {
  const token = owned.get(root);
  if (
    !token ||
    (await fs.lstat(root)).isSymbolicLink() ||
    (await fs.readFile(path.join(root, marker), "utf8")) !== token
  ) {
    throw new Error("Refusing to remove a directory without exact test ownership");
  }
  await fs.rm(root, { recursive: true });
  owned.delete(root);
}
