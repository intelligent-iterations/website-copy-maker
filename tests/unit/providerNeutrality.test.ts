import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("provider neutrality", () => {
  it("limits runtime dependencies to capture and evaluation primitives", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "pixelmatch",
      "playwright",
      "pngjs",
      "prettier",
      "sharp",
      "yargs",
    ]);
  });

  it("does not configure generated output for a deployment target", async () => {
    const source = await fs.readFile(path.resolve("src/generate/generateNextConfig.ts"), "utf8");
    expect(source).not.toMatch(/\boutput\s*:\s*["']export["']/);
  });
});
