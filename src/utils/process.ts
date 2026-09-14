/**
 * Small wrappers for managing child processes used during QA (next dev) and
 * any other long-running side effects. Cleanup is the user's responsibility
 * via the returned dispose handle, but every call site uses `try/finally`.
 */

import { spawn, type ChildProcess } from "node:child_process";

export type ProcessHandle = {
  readonly pid: number;
  readonly proc: ChildProcess;
  readonly waitForExit: () => Promise<number | null>;
  readonly dispose: () => Promise<void>;
};

export type SpawnOpts = {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
};

export function spawnProcess(
  command: string,
  args: readonly string[],
  opts: SpawnOpts,
): ProcessHandle {
  const proc = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (opts.onStdout) proc.stdout?.setEncoding("utf8").on("data", opts.onStdout);
  if (opts.onStderr) proc.stderr?.setEncoding("utf8").on("data", opts.onStderr);

  const waitForExit = (): Promise<number | null> =>
    new Promise((resolve) => {
      if (proc.exitCode !== null) {
        resolve(proc.exitCode);
        return;
      }
      proc.once("exit", (code) => resolve(code));
    });

  const dispose = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    proc.kill("SIGTERM");
    const result = await Promise.race([
      waitForExit(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
    ]);
    if (result === "timeout" && proc.exitCode === null) {
      proc.kill("SIGKILL");
      await waitForExit();
    }
  };

  return {
    pid: proc.pid ?? -1,
    proc,
    waitForExit,
    dispose,
  };
}

/**
 * Race: resolve the first promise that completes within `ms`, or reject.
 * Used to bound how long we wait for `next dev` to print "ready" before
 * giving up.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
