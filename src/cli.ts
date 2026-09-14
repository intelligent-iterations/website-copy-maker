#!/usr/bin/env node
/**
 * CLI entry. Capture and evaluation are framework-neutral. Project generation
 * requires an explicit adapter so the package never implies a hosting target.
 *
 * Usage:
 *   pnpm website-copy capture --url <URL> --out <DIR>
 *   pnpm website-copy evaluate --reference <DIR> --url <URL> --out <DIR>
 *   pnpm website-copy copy --adapter next-tailwind --url <URL> --out <DIR>
 *
 * The QA loop ALWAYS runs. There is no skip flag - a generated project
 * cannot be considered done until pixel-similarity targets are met and
 * runtime integrity invariants pass. The CLI exits non-zero on either
 * failure so deploy scripts and CI fail closed.
 */

import yargs from "yargs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hideBin } from "yargs/helpers";
import { runAgent } from "./agent/runAgent.js";
import { DEFAULT_MAX_ITERATIONS, DEFAULT_MODE, isMode, type Mode } from "./agent/thresholds.js";
import { createLogger } from "./utils/logger.js";
import { runGeneratedSite } from "./qa/runGeneratedSite.js";
import { spawnProcess } from "./utils/process.js";
import { runFrameworkCli } from "./framework/cli.js";

export type CliFlags = {
  readonly adapter: "next-tailwind";
  readonly url: string;
  readonly out: string;
  readonly mode: Mode;
  readonly maxIterations: number;
  readonly stateRoot?: string;
};

export function parseArgs(argv: readonly string[]): CliFlags {
  const parsed = yargs(argv as string[])
    .scriptName("website-copy")
    .exitProcess(false)
    .option("adapter", {
      type: "string",
      demandOption: true,
      describe: "Explicit output adapter (currently: next-tailwind)",
    })
    .option("state-dir", {
      type: "string",
      demandOption: true,
      describe: "Explicit artifact root for generation runs",
    })
    .usage("$0 copy --adapter next-tailwind --url <URL> --out <DIR> [--mode MODE]")
    .option("url", {
      type: "string",
      demandOption: true,
      describe: "Public URL to copy",
    })
    .option("out", {
      type: "string",
      demandOption: true,
      describe: "New output directory for the adapter project",
    })
    .option("mode", {
      type: "string",
      default: DEFAULT_MODE,
      describe: "Reconstruction mode",
    })
    .option("max-iterations", {
      type: "number",
      default: DEFAULT_MAX_ITERATIONS,
      describe: "Maximum QA loop iterations",
    })
    .strict()
    .help()
    .parseSync();

  const mode = parsed.mode;
  if (parsed.adapter !== "next-tailwind") {
    throw new Error(`Invalid --adapter "${parsed.adapter}". Expected next-tailwind.`);
  }
  if (!isMode(mode)) {
    throw new Error(`Invalid --mode "${mode}". Expected hybrid|semantic|exact|responsive.`);
  }

  return {
    adapter: parsed.adapter,
    url: parsed.url,
    out: parsed.out,
    mode,
    maxIterations: parsed["max-iterations"],
    ...(parsed["state-dir"] ? { stateRoot: parsed["state-dir"] } : {}),
  };
}

async function main(): Promise<void> {
  const argv = hideBin(process.argv);
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`website-copy <capture|evaluate|copy> [options]

Capture and evaluation are output-framework neutral. The copy command requires
an explicit --adapter; it does not configure or perform deployment.
`);
    return;
  }
  if (argv[0] === "capture" || argv[0] === "evaluate") {
    try {
      process.exitCode = await runFrameworkCli(argv);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (argv[0] !== "copy") {
    console.error("Expected capture, evaluate, or copy");
    process.exitCode = 1;
    return;
  }
  const flags = parseArgs(argv.slice(1));
  if (argv.includes("--help") || argv.includes("--version")) return;
  const logger = createLogger({});

  try {
    let installed = false;
    const result = await runAgent({
      url: flags.url,
      outDir: flags.out,
      mode: flags.mode,
      maxIterations: flags.maxIterations,
      logger,
      ...(flags.stateRoot ? { stateRoot: flags.stateRoot } : {}),
      runGenerated: async (projectDir) => {
        if (!installed) {
          logger.info("installing generated project dependencies", { projectDir });
          const install = spawnProcess("pnpm", ["install", "--ignore-scripts"], {
            cwd: projectDir,
          });
          try {
            if ((await install.waitForExit()) !== 0)
              throw new Error("Generated project dependency installation failed");
            installed = true;
          } finally {
            await install.dispose();
          }
        }
        const handle = await runGeneratedSite({ projectDir });
        return { url: handle.url, dispose: handle.dispose };
      },
    });
    logger.info("run complete", {
      runId: result.runId,
      stateDir: result.stateDir,
      outDir: result.outDir,
      iterations: result.iterations,
      meetsTargets: result.finalQa?.meetsTargets ?? false,
    });
    if (!result.finalQa || !result.finalQa.meetsTargets) {
      logger.error("run failed: QA targets not met", {
        iterations: result.iterations,
        scores: result.finalQa
          ? Object.fromEntries(result.finalQa.results.map((r) => [r.viewport, r.similarity]))
          : null,
      });
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    logger.error("run failed", { error: (err as Error).message });
    process.exit(1);
  }
}

// Only run main when invoked directly (not when imported by tests).
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  void main();
}
