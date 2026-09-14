import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureReference } from "../../src/framework/capture.js";
import { evaluateReplica, loadReference } from "../../src/framework/evaluate.js";
import type { ReferenceManifest } from "../../src/framework/types.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";
import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
import { extractPage } from "../../src/extract/extractPage.js";
import { replayInteractions } from "../../src/framework/interactions.js";
import type { ExtractedNode } from "../../src/extract/types.js";

let root: string;
let source: LocalServer;
let replica: LocalServer;
let manifest: ReferenceManifest;
let originalHtml: string;

beforeAll(async () => {
  root = await makeTestDir(path.join(os.tmpdir(), "agent-framework-"));
  const fixture = path.resolve("tests/fixtures/agent-site");
  await fs.cp(fixture, path.join(root, "replica"), { recursive: true });
  source = await startLocalServer(fixture);
  replica = await startLocalServer(path.join(root, "replica"));
  originalHtml = await fs.readFile(path.join(root, "replica/index.html"), "utf8");
  manifest = await captureReference({
    url: source.url,
    outDir: path.join(root, "reference"),
    maxPages: 8,
    viewports: [{ name: "mobile", width: 390, height: 800 }],
    scenarios: [
      {
        name: "details-open",
        path: "/",
        steps: [
          { action: "click", target: { role: "button", name: "Details" } },
          { action: "visible", target: { selector: "dialog[open]" } },
        ],
      },
      {
        name: "blog-navigation",
        path: "/",
        steps: [
          { action: "click", target: { role: "link", name: "Blog" } },
          { action: "url", path: "/blog/" },
          { action: "text", target: { selector: "h1" }, value: "Blog" },
        ],
      },
    ],
  });
}, 180_000);

afterAll(async () => {
  if (source) await source.close();
  if (replica) await replica.close();
  if (root) await removeTestDir(root);
});

describe("agent capture/evaluate workflow", () => {
  it("keeps document coordinates after an interaction scroll", async () => {
    const result = await extractPage({
      url: source.url,
      viewport: { name: "mobile", width: 390, height: 400 },
      beforeCapture: async (page) => {
        await page.evaluate(() => window.scrollTo(0, 300));
      },
    });
    const find = (node: ExtractedNode): ExtractedNode | undefined =>
      node.selector === "#feature" ? node : node.children.map(find).find(Boolean);
    expect(find(result.page.root)?.rect.y).toBe(300);
  }, 60_000);

  it("rejects navigation to the source as proof of replica behavior", async () => {
    await expect(
      extractPage({
        url: replica.url,
        viewport: { name: "mobile", width: 390, height: 800 },
        beforeCapture: async (page) => {
          await page
            .locator("a")
            .evaluate(
              (element, target) => element.setAttribute("href", target),
              source.url + "/blog/",
            );
          await replayInteractions(page, [
            { action: "click", target: { role: "link", name: "Blog" } },
            { action: "url", path: "/blog/" },
          ]);
        },
      }),
    ).rejects.toThrow(/outside the tested origin/);
  }, 60_000);

  it("discovers nested routes and verifies source interactions before recording state", async () => {
    expect(manifest.scenes.filter((scene) => !scene.scenario).map((scene) => scene.route)).toEqual([
      "/",
      "/blog/",
      "/blog/article/",
    ]);
    expect(manifest.scenes.filter((scene) => scene.scenario)).toHaveLength(2);
    expect(manifest.omittedUrls).toEqual([]);
    const report = await evaluateReplica({
      referenceDir: path.join(root, "reference"),
      url: replica.url,
      outDir: path.join(root, "evaluation-1"),
    });
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(5);
  }, 180_000);

  it("maps a real CSS regression to document pixels, DOM, code hint, and crops without rewriting the replica", async () => {
    const changed = originalHtml.replace("rgb(0, 80, 220)", "rgb(230, 30, 0)");
    await fs.writeFile(path.join(root, "replica/index.html"), changed);
    const report = await evaluateReplica({
      referenceDir: path.join(root, "reference"),
      url: replica.url,
      outDir: path.join(root, "evaluation-2"),
    });
    expect(report.passed).toBe(false);
    const home = report.results.find(
      (result) => result.route === "/" && "scenario" in result && !result.scenario,
    )!;
    expect("failures" in home).toBe(true);
    if (!("failures" in home)) throw new Error("Missing visual evidence");
    const failure = home.failures.find((item) => item.tile.x === 100 && item.tile.y === 300)!;
    expect(failure.replicaOwner?.selector).toBe("#feature");
    expect(failure.replicaOwner?.codeHint).toBe("index.html:11");
    for (const file of Object.values(failure.crops))
      expect((await fs.stat(path.join(root, "evaluation-2", file))).size).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(root, "replica/index.html"), "utf8")).toBe(changed);
    await fs.writeFile(path.join(root, "replica/index.html"), originalHtml);
  }, 180_000);

  it("fails unchanged-looking links and broken click behavior", async () => {
    await fs.writeFile(
      path.join(root, "replica/index.html"),
      originalHtml
        .replace('href="/blog/"', 'href="/missing/"')
        .replace("document.querySelector('dialog').showModal()", "void 0"),
    );
    const report = await evaluateReplica({
      referenceDir: path.join(root, "reference"),
      url: replica.url,
      outDir: path.join(root, "evaluation-3"),
    });
    expect(report.passed).toBe(false);
    expect(
      report.results.some((result) => "linkIssues" in result && result.linkIssues.length > 0),
    ).toBe(true);
    expect(report.results.filter((result) => "error" in result)).toHaveLength(2);
    await fs.writeFile(path.join(root, "replica/index.html"), originalHtml);
  }, 180_000);

  it("reports crawl limits and refuses modified reference evidence", async () => {
    const limited = await captureReference({
      url: source.url,
      outDir: path.join(root, "limited"),
      maxPages: 1,
      viewports: [{ name: "mobile", width: 390, height: 800 }],
    });
    expect(limited.omittedUrls).toEqual([source.url + "/blog/"]);
    await fs.appendFile(
      path.join(root, "reference", manifest.scenes[0]!.captures[0]!.extraction),
      " ",
    );
    await expect(loadReference(path.join(root, "reference"))).rejects.toThrow(/Reference changed/);
  }, 60_000);
});
