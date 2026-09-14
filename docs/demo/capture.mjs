// Documentation demo: real browser captures of a deliberately perturbed fixture.
// Run after building, inside an isolated runtime. The output directory must be new.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { chromium } from "playwright";
import { captureReference, evaluateReplica } from "../../dist/index.js";
import { renderFigures } from "./render.mjs";

const fixture = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
assert(out && path.isAbsolute(out), "Pass a new absolute output directory");
await fs.mkdir(out);
await fs.writeFile(path.join(out, ".demo-owner.json"), JSON.stringify({ id: randomUUID() }));
const replicaDir = path.join(out, "replica");
await fs.mkdir(replicaDir);
for (const file of ["site.html", "site.css", "journal.html"]) {
  await fs.copyFile(path.join(fixture, file), path.join(replicaDir, file));
}

async function serve(root) {
  const files = new Map([
    ["/", "site.html"],
    ["/journal/", "journal.html"],
    ["/site.css", "site.css"],
  ]);
  const server = http.createServer(async (req, res) => {
    const file = files.get(new URL(req.url, "http://localhost").pathname);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      const data = await fs.readFile(path.join(root, file));
      res.writeHead(200, { "content-type": file.endsWith("css") ? "text/css" : "text/html" });
      res.end(data);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

let source, replica, browser;
try {
  source = await serve(fixture);
  replica = await serve(replicaDir);
  const referenceDir = path.join(out, "reference");
  const manifest = await captureReference({
    url: source.url,
    outDir: referenceDir,
    maxPages: 4,
    viewports: [
      { name: "mobile", width: 390, height: 900 },
      { name: "desktop", width: 1200, height: 900 },
    ],
    scenarios: [
      {
        name: "open-studio",
        path: "/",
        viewports: ["mobile"],
        steps: [
          { action: "click", target: { role: "button", name: "Explore the studio ↗" } },
          { action: "visible", target: { selector: "dialog[open]" } },
        ],
      },
      {
        name: "journal-navigation",
        path: "/",
        viewports: ["mobile"],
        steps: [
          { action: "click", target: { role: "link", name: "Journal ↗" } },
          { action: "url", path: "/journal/" },
          { action: "text", target: { selector: "h1" }, value: "Simple is\na practice." },
        ],
      },
    ],
  });
  assert.equal(manifest.omittedUrls.length, 0);
  assert.deepEqual(
    manifest.scenes.filter((s) => !s.scenario).map((s) => s.route),
    ["/", "/journal/"],
  );

  const css = await fs.readFile(path.join(replicaDir, "site.css"), "utf8");
  assert.equal(css.split("translateX(0px)").length, 2);
  await fs.writeFile(
    path.join(replicaDir, "site.css"),
    css.replace("translateX(0px)", "translateX(24px)"),
  );
  const failedDir = path.join(out, "before");
  const before = await evaluateReplica({ referenceDir, url: replica.url, outDir: failedDir });
  assert.equal(before.passed, false, "The intentional regression must fail");
  assert(
    before.results.every((r) => !("error" in r)),
    "Unexpected capture or scenario error",
  );
  const mobile = before.results.find(
    (r) => r.route === "/" && r.viewport === "mobile" && !r.scenario,
  );
  const failure = mobile.failures.find(
    (f) => f.sourceOwner?.selector === "#hero-title" && f.replicaOwner?.selector === "#hero-title",
  );
  assert(failure, "The failed pixels must map to the headline in both documents");
  assert.equal(failure.replicaOwner.rect.x - failure.sourceOwner.rect.x, 24);

  // A controlled fixture repair, not a claim that this script is an autonomous agent.
  await fs.writeFile(path.join(replicaDir, "site.css"), css);
  const after = await evaluateReplica({
    referenceDir,
    url: replica.url,
    outDir: path.join(out, "after"),
  });
  assert.equal(after.passed, true, "Restoring the original CSS must pass every captured check");
  assert(after.results.every((r) => r.tilesFailed === 0 && r.similarity === 1));
  browser = await chromium.launch({ headless: true });
  const evidence = {
    fixture: "Form & Field; fictional documentation demo, not a customer migration",
    browser: browser.version(),
    viewport: { width: 390, height: 900, deviceScaleFactor: 1 },
    routes: manifest.scenes.filter((s) => !s.scenario).map((s) => s.route),
    scenarios: manifest.scenes.filter((s) => s.scenario).map((s) => s.scenario.name),
    comparisons: after.results.length,
    before: {
      passed: before.passed,
      mobileSimilarity: mobile.similarity,
      mobileTilesFailed: mobile.tilesFailed,
    },
    failure,
    after: { passed: after.passed, tilesFailed: 0, similarity: 1 },
    fixtureSha256: Object.fromEntries(
      await Promise.all(
        ["site.html", "site.css", "journal.html"].map(async (name) => [
          name,
          createHash("sha256")
            .update(await fs.readFile(path.join(fixture, name)))
            .digest("hex"),
        ]),
      ),
    ),
  };
  await fs.writeFile(path.join(out, "demo-evidence.json"), JSON.stringify(evidence, null, 2));
  await renderFigures({ browser, out, referenceDir, failedDir, mobile, failure, evidence });
  console.log(
    JSON.stringify({
      passed: true,
      comparisons: evidence.comparisons,
      mobileTilesFailed: mobile.tilesFailed,
      tile: failure.tile,
      selector: failure.replicaOwner.selector,
      outputs: ["pixel-diff.png", "pixel-to-code.png"],
    }),
  );
} finally {
  await browser?.close();
  await Promise.all([source?.close(), replica?.close()]);
}
