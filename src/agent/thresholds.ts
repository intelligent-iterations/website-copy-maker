/**
 * Static configuration for the optional Next.js/Tailwind copy adapter.
 * Pure module - no side effects, no IO.
 */

export type Viewport = {
  readonly name: "mobile" | "tablet" | "desktop";
  readonly width: number;
  readonly height: number;
};

export type ViewportName = Viewport["name"];

export type Mode = "responsive" | "hybrid" | "semantic" | "exact";

export type ThresholdMap = Readonly<Record<ViewportName, number>>;

export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  { name: "mobile", width: 390, height: 1200 },
  { name: "tablet", width: 768, height: 1400 },
  { name: "desktop", width: 1440, height: 1600 },
] as const;

export const DEFAULT_TARGETS: ThresholdMap = {
  mobile: 0.9,
  tablet: 0.92,
  desktop: 0.95,
} as const;

// `responsive` is the new default: emits Tailwind responsive primitives
// (flex-col → md:flex-row, grid-cols-1 → md:grid-cols-N, padding ramps)
// driven by per-viewport extractions, with the fidelity scaling shell as
// a fallback for canvas-style sections that defy semantic recovery.
//
// Other modes:
//   hybrid   - semantic Tailwind layout first, fidelity fallback inside
//              complex islands. Older default; kept for compatibility.
//   semantic - pure semantic layout; lowest accuracy ceiling.
//   exact    - flat absolute positioning everywhere; reserved for sites
//              that no other mode reaches threshold on. Ships with the
//              scaling shell so squeeze still works.
export const DEFAULT_MODE: Mode = "responsive";
export const DEFAULT_MAX_ITERATIONS = 6;

export function isMode(value: string): value is Mode {
  return value === "responsive" || value === "hybrid" || value === "semantic" || value === "exact";
}

export function isViewportName(value: string): value is ViewportName {
  return value === "mobile" || value === "tablet" || value === "desktop";
}

/**
 * True when every viewport's similarity is at or above its target threshold.
 */
export function meetsTargets(
  similarities: Readonly<Record<ViewportName, number>>,
  targets: ThresholdMap = DEFAULT_TARGETS,
): boolean {
  return (Object.keys(targets) as ViewportName[]).every(
    (name) => (similarities[name] ?? 0) >= targets[name],
  );
}
