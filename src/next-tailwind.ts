/**
 * Explicit Next.js/Tailwind output adapter.
 *
 * The package root intentionally exposes only capture and evaluation. Import
 * this subpath when a generated Next.js/Tailwind project is the desired copy
 * format; deployment and hosting remain the caller's responsibility.
 */

export { runAgent as copyToNextTailwind } from "./agent/runAgent.js";
export type {
  RunAgentArgs as CopyToNextTailwindArgs,
  RunAgentResult as CopyToNextTailwindResult,
} from "./agent/runAgent.js";
export type { RunState, RunInputs, RunPaths, RunMeta } from "./agent/state.js";
export {
  DEFAULT_TARGETS,
  DEFAULT_MODE,
  DEFAULT_MAX_ITERATIONS,
  type Mode,
  type ThresholdMap,
} from "./agent/thresholds.js";
