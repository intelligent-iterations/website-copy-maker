import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_VIEWPORTS, type Viewport } from "../agent/thresholds.js";
import { extractPage } from "../extract/extractPage.js";
import { createFontStylesheetSession } from "../extract/extractFontFaces.js";
import { createArtifactDirectory, writeJson } from "./artifacts.js";
import { collectControls, replayInteractions } from "./interactions.js";
import type { ReferenceManifest, ReferenceScene, Scenario } from "./types.js";

export type CaptureReferenceArgs = {
  readonly url: string;
  readonly outDir: string;
  readonly paths?: readonly string[];
  readonly maxPages?: number;
  readonly viewports?: readonly Viewport[];
  readonly scenarios?: readonly Scenario[];
};

export function httpUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Expected an HTTP(S) URL without embedded credentials");
  }
  url.hash = "";
  return url;
}

export function validateViewports(viewports: readonly Viewport[]): void {
  if (
    !viewports.length ||
    viewports.length > 3 ||
    new Set(viewports.map((v) => v.name)).size !== viewports.length
  ) {
    throw new Error("Provide one to three uniquely named viewports");
  }
  for (const viewport of viewports) {
    if (
      !["mobile", "tablet", "desktop"].includes(viewport.name) ||
      !Number.isInteger(viewport.width) ||
      viewport.width < 128 ||
      viewport.width > 3840 ||
      !Number.isInteger(viewport.height) ||
      viewport.height < 128 ||
      viewport.height > 2160
    ) {
      throw new Error("Invalid viewport dimensions or name");
    }
  }
}

export function validateScenarios(scenarios: readonly Scenario[]): void {
  if (!Array.isArray(scenarios) || scenarios.length > 32)
    throw new Error("At most 32 scenarios are supported");
  const names = new Set<string>();
  for (const scenario of scenarios) {
    if (
      !scenario ||
      typeof scenario.name !== "string" ||
      !scenario.name.trim() ||
      names.has(scenario.name) ||
      typeof scenario.path !== "string" ||
      !scenario.path.startsWith("/") ||
      scenario.path.startsWith("//") ||
      !Array.isArray(scenario.steps) ||
      !scenario.steps.length ||
      scenario.steps.length > 20
    ) {
      throw new Error("Scenarios require a unique name, local path, and 1-20 steps");
    }
    names.add(scenario.name);
    if (
      scenario.viewports &&
      (!Array.isArray(scenario.viewports) ||
        !scenario.viewports.length ||
        new Set(scenario.viewports).size !== scenario.viewports.length ||
        scenario.viewports.some((name: string) => !["mobile", "tablet", "desktop"].includes(name)))
    ) {
      throw new Error("Scenario viewports must be unique supported viewport names");
    }
    let assertions = 0;
    for (const step of scenario.steps) {
      if (
        !step ||
        !["click", "hover", "fill", "press", "visible", "hidden", "text", "url"].includes(
          step.action,
        )
      ) {
        throw new Error("Unknown interaction action");
      }
      if (["visible", "hidden", "text", "url"].includes(step.action)) assertions++;
      if (step.action === "url") {
        if (
          typeof step.path !== "string" ||
          !step.path.startsWith("/") ||
          step.path.startsWith("//")
        ) {
          throw new Error("URL assertions require a local path");
        }
      } else {
        const target = step.target;
        if (
          !target ||
          !("selector" in target
            ? typeof target.selector === "string" && target.selector.length > 0
            : ["button", "link", "textbox", "checkbox", "tab", "menuitem"].includes(target.role) &&
              typeof target.name === "string")
        ) {
          throw new Error("Invalid interaction target");
        }
        if (
          ["fill", "press", "text"].includes(step.action) &&
          !("value" in step && typeof step.value === "string")
        ) {
          throw new Error("Interaction requires a string value");
        }
      }
    }
    if (!assertions) throw new Error("Each scenario requires an observable assertion");
  }
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Capture once; agents can evaluate many revisions without revisiting the source. */
export async function captureReference(args: CaptureReferenceArgs): Promise<ReferenceManifest> {
  const source = httpUrl(args.url);
  const viewports = args.viewports ?? DEFAULT_VIEWPORTS;
  const scenarios = args.scenarios ?? [];
  const maxPages = args.maxPages ?? 24;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 64)
    throw new Error("maxPages must be 1-64");
  validateViewports(viewports);
  validateScenarios(scenarios);
  for (const scenario of scenarios) {
    if (scenario.viewports?.some((name) => !viewports.some((viewport) => viewport.name === name))) {
      throw new Error("Scenario requests a viewport outside this capture");
    }
  }
  const scope = source.pathname.replace(/\/$/, "");
  const inScope = (url: URL): boolean =>
    url.origin === source.origin &&
    (url.pathname === scope || url.pathname.startsWith(scope + "/"));
  const queue = [source.href];
  for (const route of [...(args.paths ?? []), ...scenarios.map((s) => s.path)]) {
    const url = httpUrl(new URL(route, source).href);
    if (!inScope(url)) throw new Error(`Path outside source scope: ${route}`);
    if (!queue.includes(url.href)) queue.push(url.href);
  }
  if (queue.length > maxPages) throw new Error("Explicit paths exceed maxPages");
  const outDir = await createArtifactDirectory(args.outDir);
  const scenes: ReferenceScene[] = [];
  const fontStylesheets = createFontStylesheetSession();
  const visited = new Set<string>();
  const omitted = new Set<string>();
  const capture = async (url: string, scenario?: Scenario): Promise<void> => {
    const id = `scene-${String(scenes.length).padStart(3, "0")}`;
    const captures: ReferenceScene["captures"][number][] = [];
    for (const viewport of viewports.filter(
      (viewport) => !scenario?.viewports || scenario.viewports.includes(viewport.name),
    )) {
      const result = await extractPage({
        url,
        viewport,
        fontStylesheets,
        ...(scenario ? { beforeCapture: (page) => replayInteractions(page, scenario.steps) } : {}),
      });
      const screenshot = `${id}-${viewport.name}.png`;
      const extraction = `${id}-${viewport.name}.json`;
      const extracted = JSON.stringify(result.page, null, 2) + "\n";
      await fs.writeFile(path.join(outDir, screenshot), result.screenshot, { flag: "wx" });
      await fs.writeFile(path.join(outDir, extraction), extracted, { flag: "wx" });
      const controls = collectControls(result.page.root);
      captures.push({
        viewport,
        screenshot,
        extraction,
        controls,
        sha256: { screenshot: sha256(result.screenshot), extraction: sha256(extracted) },
      });
      if (!scenario) {
        for (const control of controls) {
          if (!control.href) continue;
          let link: URL;
          try {
            link = httpUrl(new URL(control.href, url).href);
          } catch {
            continue;
          }
          if (!inScope(link) || visited.has(link.href) || queue.includes(link.href)) continue;
          if (/\.(?:pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3)$/i.test(link.pathname)) continue;
          if (queue.length + visited.size < maxPages) queue.push(link.href);
          else omitted.add(link.href);
        }
      }
    }
    const routeUrl = new URL(url);
    scenes.push({
      id,
      url,
      route: routeUrl.pathname + routeUrl.search,
      captures,
      ...(scenario ? { scenario } : {}),
    });
  };
  while (queue.length) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    await capture(url);
  }
  for (const scenario of scenarios) await capture(new URL(scenario.path, source).href, scenario);
  const manifest: ReferenceManifest = {
    schemaVersion: 1,
    sourceUrl: source.href,
    capturedAt: new Date().toISOString(),
    deviceScaleFactor: 1,
    maxPages,
    scenes,
    omittedUrls: [...omitted].filter((url) => !visited.has(url)),
  };
  await writeJson(path.join(outDir, "reference.json"), manifest);
  return manifest;
}
