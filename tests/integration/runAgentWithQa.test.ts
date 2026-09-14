import { makeTestDir, removeTestDir } from "../helpers/workspace.js";
/**
 * End-to-end: agent + QA loop, exercising the patch loop machinery without
 * spinning up an actual `next dev`. We inject `runGenerated` to point Chromium
 * at the *same* fixture site as the "generated" target, so the QA loop scores
 * ~1.0 on iteration 1 and exits cleanly.
 *
 * This proves: QA loop wiring is correct, dispose is called, qa-report.json
 * lands on disk, final-report.md is produced.
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
let disposeCalls: number;

beforeAll(async () => {
  server = await startLocalServer(FIXTURE);
  outputWorkspace = await makeTestDir(path.join(os.tmpdir(), "wcm-e2e-"));
  outDir = path.join(outputWorkspace, "project");
  stateDir = await makeTestDir(path.join(os.tmpdir(), "wcm-e2e-state-"));
  disposeCalls = 0;
});

afterAll(async () => {
  if (server) await server.close();
  await removeTestDir(outputWorkspace);
  await removeTestDir(stateDir);
});

describe("runAgent + QA loop (live)", () => {
  it("runs extract → analyze → generate → QA → final report and exits in 1 iteration", async () => {
    const result = await runAgent({
      url: server.url,
      outDir,
      mode: "hybrid",
      maxIterations: 3,
      env: { ...process.env, WEBSITE_COPY_STATE_DIR: stateDir },
      runGenerated: async () => ({
        // Inject the original fixture as the "generated" site so QA passes.
        url: server.url,
        dispose: async () => {
          disposeCalls += 1;
        },
      }),
    });

    expect(result.iterations).toBe(1);
    expect(result.finalQa).not.toBeNull();
    expect(result.finalQa!.meetsTargets).toBe(true);
    expect(disposeCalls).toBeGreaterThanOrEqual(1);

    // Final report markdown was written to both the run state dir and the
    // output project root.
    const finalInOut = await fs.readFile(path.join(outDir, "FINAL_REPORT.md"), "utf8");
    expect(finalInOut).toMatch(/Final Report/);
    expect(finalInOut).toMatch(/Visual similarity/);

    // qa-report.json present in run state
    const qaReportRaw = await fs.readFile(
      path.join(stateDir, result.runId, "reports", "qa-report.json"),
      "utf8",
    );
    const qaReport = JSON.parse(qaReportRaw);
    expect(qaReport.meetsTargets).toBe(true);
    expect(qaReport.results.length).toBeGreaterThan(0);
  }, 180_000);
});
