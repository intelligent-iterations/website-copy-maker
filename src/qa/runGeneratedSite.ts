/**
 * Spawn `next dev` against a generated project directory. Caller must call
 * `dispose` to tear it down - even on error. Designed so the agent loop can
 * spawn → screenshot → dispose → patch → spawn-again cleanly.
 */

import path from "node:path";
import { spawnProcess, type ProcessHandle } from "../utils/process.js";

export type GeneratedSiteHandle = {
  readonly url: string;
  readonly proc: ProcessHandle;
  readonly dispose: () => Promise<void>;
};

export type RunGeneratedSiteOptions = {
  readonly projectDir: string;
  readonly port?: number;
  readonly readyTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

const DEFAULT_PORT = 3217; // Uncommon enough to avoid collisions with user dev servers.
const READY_RE = /(✓\s*Ready|started server on|ready in|Local:\s*http)/i;

export async function runGeneratedSite(
  opts: RunGeneratedSiteOptions,
): Promise<GeneratedSiteHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 60_000;

  // The caller installs dependencies explicitly before starting this adapter.
  const proc = spawnProcess("pnpm", ["exec", "next", "dev", "-p", String(port)], {
    cwd: path.resolve(opts.projectDir),
    env: opts.env ?? process.env,
  });

  const url = `http://127.0.0.1:${port}`;

  let resolved = false;
  await new Promise<void>((resolve, reject) => {
    const onChunk = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (!resolved && READY_RE.test(text)) {
        resolved = true;
        resolve();
      }
    };
    proc.proc.stdout?.on("data", onChunk);
    proc.proc.stderr?.on("data", onChunk);
    proc.proc.once("exit", (code) => {
      if (!resolved) reject(new Error(`next dev exited before ready (code ${code})`));
    });
    setTimeout(() => {
      if (!resolved) reject(new Error(`next dev did not become ready within ${readyTimeoutMs}ms`));
    }, readyTimeoutMs).unref();
  }).catch(async (err) => {
    await proc.dispose();
    throw err;
  });

  return {
    url,
    proc,
    dispose: () => proc.dispose(),
  };
}
