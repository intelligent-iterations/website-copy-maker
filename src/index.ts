export { captureReference, type CaptureReferenceArgs } from "./framework/capture.js";
export { evaluateReplica, loadReference, type EvaluateReplicaArgs } from "./framework/evaluate.js";
export type {
  ReferenceManifest,
  ReferenceScene,
  Scenario,
  InteractionStep,
  Target,
  Control,
} from "./framework/types.js";
export { compareScreenshots, TILE_SIZE, TILE_MAX_RATIO } from "./qa/compareScreenshots.js";
export { findElementForRegion } from "./qa/regionToElement.js";
export { DEFAULT_VIEWPORTS, type Viewport, type ViewportName } from "./agent/thresholds.js";
