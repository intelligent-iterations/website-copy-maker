import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureDir,
  mapTree,
  mergeTrees,
  removeDir,
  resolveStateDir,
  writeTree,
} from "../../src/utils/files.js";

describe("mergeTrees", () => {
  it("later trees overwrite earlier on key collision", () => {
    const merged = mergeTrees({ "a.txt": "1" }, { "a.txt": "2", "b.txt": "x" });
    expect(merged).toEqual({ "a.txt": "2", "b.txt": "x" });
  });
});

describe("mapTree", () => {
  it("rewrites every entry", () => {
    const out = mapTree({ "a.txt": "x" }, (_, v) => `// header\n${v}`);
    expect(out["a.txt"]).toBe("// header\nx");
  });
});

describe("resolveStateDir", () => {
  it("uses WEBSITE_COPY_STATE_DIR override when set", () => {
    const dir = resolveStateDir("run-1", { WEBSITE_COPY_STATE_DIR: "/tmp/x", HOME: "/h" });
    expect(dir).toBe("/tmp/x/run-1");
  });

  it("requires an explicit artifact root instead of reading hidden home state", () => {
    expect(() => resolveStateDir("run-2", { HOME: "/h" })).toThrow(/explicitly/);
  });
});

describe("writeTree (effectful)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await makeTestDir(path.join(os.tmpdir(), "wcm-files-test-"));
  });
  afterEach(async () => {
    await removeTestDir(tmp);
  });

  it("writes nested files with auto-mkdir", async () => {
    await writeTree(tmp, {
      "a.txt": "alpha",
      "nested/deep/b.txt": "beta",
    });
    expect(await fs.readFile(path.join(tmp, "a.txt"), "utf8")).toBe("alpha");
    expect(await fs.readFile(path.join(tmp, "nested/deep/b.txt"), "utf8")).toBe("beta");
  });

  it("ensureDir is idempotent", async () => {
    const p = path.join(tmp, "deep/nested/dir");
    await ensureDir(p);
    await ensureDir(p);
    const stat = await fs.stat(p);
    expect(stat.isDirectory()).toBe(true);
  });

  it("removeDir does not throw when path missing", async () => {
    await expect(removeDir(path.join(tmp, "nope"))).resolves.toBeUndefined();
  });
});
