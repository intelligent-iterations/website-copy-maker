/**
 * Shared types for the QA stage. Pure module - no IO.
 *
 * The aggregate similarity scalar and the per-region diagnoses are
 * informational. The pass/fail gate is tile-based - see
 * `compareScreenshots.ts` (TILE_SIZE / TILE_MAX_RATIO) and
 * `generateQaReport.ts`. No tile is exempt.
 */

import type { ViewportName } from "../agent/thresholds.js";
import type { HotZone } from "./regionReport.js";
import type { RegionDiagnosis } from "./diagnoseRegion.js";
import type { TileResult } from "./compareScreenshots.js";

export type { TileResult };

export type QaSeverity = "low" | "medium" | "high";

export type QaIssue = {
  readonly section?: string;
  readonly severity: QaSeverity;
  readonly description: string;
  readonly suggestedFix: string;
};

export type RegionResult = {
  readonly region: HotZone;
  readonly diagnosis: RegionDiagnosis;
  /** DesignNode.id of the element that owns the region, if found. */
  readonly ownerId: string | null;
  /** Human-readable name of the owner (tag#id, or "unknown"). */
  readonly ownerLabel: string;
  /** True when the patcher knows how to address this diagnosis kind. */
  readonly patchable: boolean;
};

export type QaResult = {
  readonly viewport: ViewportName;
  /** Slash-prefixed route ("/", "/blog/", ...). */
  readonly route: string;
  readonly similarity: number;
  readonly mismatchImagePath: string | null;
  readonly issues: readonly QaIssue[];
  readonly regions: readonly RegionResult[];
  readonly tiles: readonly TileResult[];
  readonly tilesFailed: number;
};

export type QaReport = {
  readonly iteration: number;
  readonly results: readonly QaResult[];
  /** True iff every viewport-route has `tilesFailed === 0`. This is the
   * only pass/fail signal - no tile is forgiven. */
  readonly meetsTargets: boolean;
  /** Informational: was every viewport above its similarity target?
   * Does NOT control pass/fail. */
  readonly similarityMet: boolean;
};
