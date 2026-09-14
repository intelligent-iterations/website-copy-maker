import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createArtifactDirectory, readArtifact } from "../../src/framework/artifacts.js";
import { validateScenarios, validateViewports } from "../../src/framework/capture.js";
import { compareLinks } from "../../src/framework/interactions.js";
import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
import type { Control } from "../../src/framework/types.js";

let root: string;
beforeEach(async () => {
  root = await makeTestDir(path.join(os.tmpdir(), "framework-contract-"));
});
afterEach(async () => {
  await removeTestDir(root);
});

describe("artifact isolation", () => {
  it("refuses to reuse a directory and preserves caller files", async () => {
    await fs.writeFile(path.join(root, "keep.txt"), "user work");
    await expect(createArtifactDirectory(root)).rejects.toThrow();
    expect(await fs.readFile(path.join(root, "keep.txt"), "utf8")).toBe("user work");
    const first = await createArtifactDirectory(path.join(root, "first"));
    const second = await createArtifactDirectory(path.join(root, "second"));
    expect(await fs.readFile(path.join(first, ".website-copy-owner.json"), "utf8")).not.toBe(
      await fs.readFile(path.join(second, ".website-copy-owner.json"), "utf8"),
    );
  });

  it("refuses traversal and symlinks outside the reference bundle", async () => {
    const reference = await createArtifactDirectory(path.join(root, "reference"));
    await fs.writeFile(path.join(root, "private.txt"), "private");
    await fs.symlink(path.join(root, "private.txt"), path.join(reference, "escape"));
    await expect(readArtifact(reference, "../private.txt")).rejects.toThrow();
    await expect(readArtifact(reference, "escape")).rejects.toThrow(/escapes/);
  });
});

describe("capture contract", () => {
  it("requires assertions for interaction scenarios", () => {
    expect(() =>
      validateScenarios([
        {
          name: "click",
          path: "/",
          steps: [{ action: "click", target: { role: "button", name: "Open" } }],
        },
      ]),
    ).toThrow(/assertion/);
    expect(() =>
      validateScenarios([
        {
          name: "open",
          path: "/",
          steps: [
            { action: "click", target: { role: "button", name: "Open" } },
            { action: "visible", target: { selector: "dialog[open]" } },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it("rejects duplicate viewports and unbounded dimensions", () => {
    expect(() => validateViewports([])).toThrow();
    expect(() => validateViewports([{ name: "mobile", width: 1e9, height: 800 }])).toThrow();
    expect(() =>
      validateViewports([
        { name: "mobile", width: 390, height: 800 },
        { name: "mobile", width: 400, height: 800 },
      ]),
    ).toThrow();
  });

  it("checks destinations independently from visual appearance and preserves link multiplicity", () => {
    const link = (href: string): Control => ({
      nodeId: "n1",
      tag: "a",
      label: "Blog",
      href,
      rect: { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 },
    });
    expect(
      compareLinks(
        [link("https://example.com/blog/")],
        [link("http://localhost:3000/blog/")],
        "https://example.com",
        "http://localhost:3000",
      ),
    ).toEqual([]);
    expect(
      compareLinks(
        [link("/blog/"), link("/blog/")],
        [link("/blog/")],
        "https://example.com",
        "http://localhost:3000",
      ),
    ).toHaveLength(1);
    expect(
      compareLinks([link("/blog/")], [link("#")], "https://example.com", "http://localhost:3000"),
    ).toHaveLength(1);
  });
});
