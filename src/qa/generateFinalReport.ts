/**
 * Pure: render the final-report.md from the run state, the latest QA report,
 * the integrity report, and miscellaneous extracted facts.
 *
 * The QA loop is mandatory - `qa` is required (never null). Any code path
 * that tries to render a "QA was skipped" report is broken; that's the
 * dishonesty the runtime gate exists to prevent.
 */

import type { ExtractedAsset } from "../extract/types.js";
import type { DesignTokens } from "../analyze/inferTokens.js";
import type { QaReport } from "./types.js";
import { isAcceptableRegion } from "./generateQaReport.js";
import type { RegionDiagnosis } from "./diagnoseRegion.js";
import type { IntegrityReport } from "./integrity.js";

function describeDiagnosis(d: RegionDiagnosis): string {
  switch (d.kind) {
    case "wrong-color":
      return `wrong-color (expected rgb(${d.expected.r},${d.expected.g},${d.expected.b}), got rgb(${d.actual.r},${d.actual.g},${d.actual.b}))`;
    case "missing-element":
      return "missing-element";
    case "extra-element":
      return "extra-element";
    case "position-shift":
      return `position-shift (dx=${d.dx}, dy=${d.dy})`;
    case "size-shift":
      return `size-shift (scale=${d.scale.toFixed(2)})`;
    case "anti-aliasing":
      return "anti-aliasing";
    case "unknown":
    default:
      return "unknown";
  }
}

export type FinalReportInput = {
  readonly sourceUrl: string;
  readonly outDir: string;
  readonly runId: string;
  readonly mode: string;
  readonly maxIterations: number;
  readonly iteration: number;
  readonly tokens: DesignTokens;
  readonly assets: readonly ExtractedAsset[];
  readonly failedAssets: readonly { readonly url: string; readonly reason: string }[];
  readonly qa: QaReport;
  readonly integrity: IntegrityReport | null;
  readonly generatedFiles: number;
};

export function generateFinalReport(input: FinalReportInput): string {
  const lines: string[] = [];
  lines.push(`# Final Report - website-copy-maker`);
  lines.push("");
  lines.push(`- Source URL: \`${input.sourceUrl}\``);
  lines.push(`- Generated project: \`${input.outDir}\``);
  lines.push(`- Run ID: \`${input.runId}\``);
  lines.push(`- Mode: \`${input.mode}\``);
  lines.push(`- Iterations: ${input.iteration} / ${input.maxIterations}`);
  lines.push(`- Files generated: ${input.generatedFiles}`);
  lines.push(`- Meets visual targets: **${input.qa.meetsTargets ? "yes" : "no"}**`);
  lines.push("");

  lines.push(`## Visual similarity (iteration ${input.qa.iteration}) - informational`);
  lines.push("");
  lines.push("Similarity is the legacy aggregate metric (1 − mismatched-pixels / total).");
  lines.push("It does NOT control pass/fail; the region-based gate below does.");
  lines.push("");
  lines.push("| Page | Viewport | Similarity | Status |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of input.qa.results) {
    const status = r.issues.length === 0 ? "✓ pass" : `${r.issues.length} issue(s)`;
    lines.push(`| ${r.route || "/"} | ${r.viewport} | ${r.similarity.toFixed(3)} | ${status} |`);
  }
  lines.push("");

  lines.push(`## Visual residuals (region-based gate)`);
  lines.push("");
  const allRegions = input.qa.results.flatMap((r) =>
    r.regions.map((rg) => ({ result: r, region: rg })),
  );
  // Use the same `isAcceptableRegion` semantics as the gate: anything the
  // gate tolerates (AA, sub-noise-floor, small unknown) is NOT a residual
  // worth surfacing. The report should agree with `meetsTargets`.
  const unfixed = allRegions.filter(({ region: rg }) => !isAcceptableRegion(rg));
  if (unfixed.length === 0) {
    lines.push("Every page × viewport pair has zero unfixed material regions.");
    lines.push("");
  } else {
    lines.push(
      `**${unfixed.length} unfixed region(s)** - the gate refuses to ship until each is patched or downgraded to anti-aliasing.`,
    );
    lines.push("");
    lines.push(
      "| Page | Viewport | Region (x, y, w, h) | Pixels | Diagnosis | Owner | Patchable |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const { result, region: rg } of unfixed) {
      const where = `(${rg.region.x}, ${rg.region.y}, ${rg.region.width}, ${rg.region.height})`;
      const diagText = describeDiagnosis(rg.diagnosis);
      const patch = rg.patchable ? "✓" : "✗";
      lines.push(
        `| ${result.route || "/"} | ${result.viewport} | ${where} | ${rg.region.mismatchedPixels} | ${diagText} | ${rg.ownerLabel} | ${patch} |`,
      );
    }
    lines.push("");
  }

  if (!input.qa.meetsTargets) {
    lines.push(`**Region gate not satisfied after ${input.iteration} iteration(s).**`);
    lines.push("");
  }

  if (input.integrity) {
    lines.push(`## Integrity invariants`);
    lines.push("");
    lines.push("| Invariant | Result |");
    lines.push("| --- | --- |");
    for (const inv of input.integrity.invariants) {
      const result = inv.passed ? "✓ pass" : `✗ FAIL - ${inv.detail ?? "see logs"}`;
      lines.push(`| ${inv.name} | ${result} |`);
    }
    lines.push("");
  }

  lines.push(`## Inferred design tokens`);
  lines.push("");
  lines.push(`- Page color: \`${input.tokens.colors.page}\``);
  lines.push(`- Ink color: \`${input.tokens.colors.ink}\``);
  lines.push(`- Muted color: \`${input.tokens.colors.muted}\``);
  lines.push(`- Accent color: \`${input.tokens.colors.accent}\``);
  if (input.tokens.fontFamilies.length) {
    lines.push(`- Font families: ${input.tokens.fontFamilies.map((f) => `\`${f}\``).join(", ")}`);
  }
  lines.push(`- Max content width: \`${input.tokens.maxContentWidth}px\``);
  lines.push("");

  lines.push(`## Assets`);
  lines.push("");
  lines.push(`- Detected: ${input.assets.length}`);
  lines.push(`- Failed to download: ${input.failedAssets.length}`);
  if (input.failedAssets.length) {
    for (const f of input.failedAssets.slice(0, 10)) {
      lines.push(`  - \`${f.url}\` - ${f.reason}`);
    }
  }
  lines.push("");

  lines.push(`## Known limitations / TODOs`);
  lines.push("");
  lines.push(`- Forms, CMS, analytics, backend, and video are not reconstructed.`);
  lines.push(`- Animations and complex motion are not reproduced.`);
  lines.push(`- Asset downloading is best-effort; check the failed list above.`);
  lines.push(`- The QA loop tolerates layout differences only up to the configured thresholds.`);
  lines.push("");

  lines.push(`## Run the generated project`);
  lines.push("");
  lines.push("```bash");
  lines.push(`cd "${input.outDir}"`);
  lines.push(`pnpm install`);
  lines.push(`pnpm dev`);
  lines.push("```");
  lines.push("");
  lines.push("Then open http://localhost:3000.");
  lines.push("");

  return lines.join("\n");
}
