import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
/**
 * End-to-end integration: spin up the fixture site, run the full agent
 * (render → extract → normalize → analyze → generate), and verify the
 * generated Next.js project tree on disk.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../../src/agent/runAgent.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";

const FIXTURE = path.join(__dirname, "..", "fixtures", "simple-site");

let server: LocalServer;
let outDir: string;
let outputWorkspace: string;
let stateDir: string;

beforeAll(async () => {
  server = await startLocalServer(FIXTURE);
  outputWorkspace = await makeTestDir(path.join(os.tmpdir(), "wcm-out-"));
  outDir = path.join(outputWorkspace, "project");
  stateDir = await makeTestDir(path.join(os.tmpdir(), "wcm-state-"));
});

afterAll(async () => {
  if (server) await server.close();
  await removeTestDir(outputWorkspace);
  await removeTestDir(stateDir);
});

describe("runAgent (live, end-to-end)", () => {
  it("generates a complete Next.js + Tailwind project", async () => {
    const result = await runAgent({
      url: server.url,
      outDir,
      mode: "hybrid",
      env: { ...process.env, WEBSITE_COPY_STATE_DIR: stateDir },
      // Inject the source as the "generated" target so the (now mandatory)
      // QA loop scores ~1.0 and exits in one iteration.
      runGenerated: async () => ({
        url: server.url,
        dispose: async () => undefined,
      }),
    });

    expect(result.generatedFiles).toBeGreaterThanOrEqual(10);

    // After moving to structure-driven rendering, page.tsx contains every
    // section inline. We no longer ship Navbar/Hero/Footer/GenericSection
    // template files (they were fixed shapes that ignored measured layout).
    const expectedFiles = [
      "package.json",
      "tsconfig.json",
      "tailwind.config.ts",
      "next.config.ts",
      "postcss.config.js",
      "app/layout.tsx",
      "app/page.tsx",
      "app/globals.css",
      ".gitignore",
      "README.md",
    ];

    for (const rel of expectedFiles) {
      const stat = await fs.stat(path.join(outDir, rel));
      expect(stat.isFile()).toBe(true);
    }
  }, 120_000);

  it("the generated package.json declares Next 15 + React 19 + Tailwind", async () => {
    const pkgRaw = await fs.readFile(path.join(outDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.dependencies.next).toMatch(/^\^15/);
    expect(pkg.dependencies.react).toMatch(/^\^19/);
    expect(pkg.devDependencies.tailwindcss).toMatch(/^\^3/);
    expect(pkg.scripts.dev).toBe("next dev");
  });

  it("the generated page.tsx renders sections inline (no template indirection)", async () => {
    const page = await fs.readFile(path.join(outDir, "app/page.tsx"), "utf8");
    expect(page).toMatch(/<main/);
    expect(page).toMatch(/min-h-screen/);
    // Section markers from renderSection
    expect(page).toMatch(/<section className=/);
    // Should contain the actual fixture content rendered as real text
    expect(page).toMatch(/Build the thing/);
  });

  it("rebuild does not link back to the source domain", async () => {
    const page = await fs.readFile(path.join(outDir, "app/page.tsx"), "utf8");
    const css = await fs.readFile(path.join(outDir, "app/globals.css"), "utf8");
    // Fixture uses 127.0.0.1 as the host; check that no live host shows up
    // verbatim in user-facing files.
    expect(page).not.toMatch(/127\.0\.0\.1/);
    expect(css).not.toMatch(/127\.0\.0\.1/);
  });

  it("rebuild does not hotlink remote images (when assets downloaded)", async () => {
    const page = await fs.readFile(path.join(outDir, "app/page.tsx"), "utf8");
    // Any <img> in the generated page should reference /assets/ paths or
    // be empty - never the original URL.
    const matches = page.match(/<img\s+src="([^"]+)"/g) ?? [];
    for (const m of matches) {
      expect(m).toMatch(/src="\/assets\//);
    }
  });

  it("the generated tailwind.config.ts contains tokens inferred from the fixture", async () => {
    const cfg = await fs.readFile(path.join(outDir, "tailwind.config.ts"), "utf8");
    // page background of fixture is #faf8f3
    expect(cfg.toLowerCase()).toMatch(/#faf8f3/);
    // ink color is #111111
    expect(cfg.toLowerCase()).toMatch(/#111111/);
    // accent (orange CTA) is #f76b4f
    expect(cfg.toLowerCase()).toMatch(/#f76b4f/);
    expect(cfg).toMatch(/maxWidth/);
  });

  it("materializes discovered fonts and emits only local font-face URLs", async () => {
    const css = await fs.readFile(path.join(outDir, "app/globals.css"), "utf8");
    expect(css).toMatch(/@font-face/);
    expect(css).toMatch(/font-family: "Fixture Sans"/);
    expect(css).toMatch(/url\("\/assets\/[^"]+\.woff2"\)/);
    expect(css).not.toMatch(/https?:\/\//);

    const assets = await fs.readdir(path.join(outDir, "public", "assets"));
    expect(assets.some((name) => name.endsWith("-fixture-sans.woff2"))).toBe(true);
  });
});
