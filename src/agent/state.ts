/**
 * Immutable run state. Each pipeline stage takes a RunState in and returns a
 * new RunState; nothing mutates in place. Side-effecting handles (browser,
 * server processes) are NOT here - they live in dedicated resource modules
 * with explicit ownership and finally-block cleanup.
 */

import type { Mode, ThresholdMap, Viewport, ViewportName } from "./thresholds.js";

export type RunPaths = {
  readonly outDir: string;
  readonly stateDir: string;
  readonly extractionDir: string;
  readonly screenshotsDir: string;
  readonly assetsDir: string;
  readonly reportsDir: string;
};

export type RunInputs = {
  readonly url: string;
  readonly mode: Mode;
  readonly maxIterations: number;
  readonly viewports: readonly Viewport[];
  readonly targets: ThresholdMap;
};

export type RunMeta = {
  readonly runId: string;
  readonly startedAt: string; // ISO-8601
};

export type RunState = {
  readonly meta: RunMeta;
  readonly inputs: RunInputs;
  readonly paths: RunPaths;
  readonly iteration: number;
  readonly similarities: Readonly<Partial<Record<ViewportName, number>>>;
};

export function createRunState(args: {
  meta: RunMeta;
  inputs: RunInputs;
  paths: RunPaths;
}): RunState {
  return {
    meta: args.meta,
    inputs: args.inputs,
    paths: args.paths,
    iteration: 0,
    similarities: {},
  };
}

export function withIteration(state: RunState, iteration: number): RunState {
  return { ...state, iteration };
}

export function withSimilarities(
  state: RunState,
  next: Readonly<Partial<Record<ViewportName, number>>>,
): RunState {
  return { ...state, similarities: { ...state.similarities, ...next } };
}
