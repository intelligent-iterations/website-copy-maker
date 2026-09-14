import { promises as fs } from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { captureReference } from "./capture.js";
import { evaluateReplica } from "./evaluate.js";
import type { Scenario } from "./types.js";

export async function runFrameworkCli(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const parser = yargs(argv.slice(1) as string[])
    .exitProcess(false)
    .strict()
    .help()
    .option("url", {
      type: "string",
      demandOption: true,
      describe: "Source URL or running replica origin",
    })
    .option("out", {
      type: "string",
      demandOption: true,
      describe: "New artifact directory; must not exist",
    });
  if (command === "capture") {
    const args = parser
      .option("path", { type: "array", string: true, describe: "Additional source paths" })
      .option("max-pages", {
        type: "number",
        default: 24,
        describe: "Maximum discovered pages (1-64)",
      })
      .option("scenarios", {
        type: "string",
        describe: "JSON array of authorized interaction scenarios",
      })
      .parseSync();
    if (args.help || args.version) return 0;
    const scenarios: readonly Scenario[] = args.scenarios
      ? JSON.parse(await fs.readFile(args.scenarios, "utf8"))
      : [];
    const manifest = await captureReference({
      url: args.url,
      outDir: args.out,
      maxPages: args["max-pages"],
      paths: args.path ?? [],
      scenarios,
    });
    process.stdout.write(
      JSON.stringify({
        reference: path.resolve(args.out, "reference.json"),
        scenes: manifest.scenes.length,
        omittedUrls: manifest.omittedUrls,
      }) + "\n",
    );
    return manifest.omittedUrls.length ? 1 : 0;
  }
  if (command === "evaluate") {
    const args = parser
      .option("reference", {
        type: "string",
        demandOption: true,
        describe: "Captured reference directory",
      })
      .parseSync();
    if (args.help || args.version) return 0;
    const result = await evaluateReplica({
      url: args.url,
      outDir: args.out,
      referenceDir: args.reference,
    });
    process.stdout.write(
      JSON.stringify({
        report: path.resolve(args.out, "evaluation.json"),
        passed: result.passed,
        comparisons: result.results.length,
      }) + "\n",
    );
    return result.passed ? 0 : 1;
  }
  throw new Error("Expected capture or evaluate");
}
