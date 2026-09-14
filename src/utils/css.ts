/**
 * Pure helpers for parsing computed-style strings.
 */

const PX_RE = /^(-?\d+(?:\.\d+)?)px$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

export function parsePx(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  const m = PX_RE.exec(trimmed);
  if (m) return Number(m[1]);
  if (NUM_RE.test(trimmed)) return Number(trimmed);
  return null;
}

export type BoxValues = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

/**
 * Parse a `padding`/`margin` shorthand returned by getComputedStyle (which is
 * always 4 explicit pixel values separated by spaces in browsers, but cope
 * with 1/2/3-value shorthand defensively).
 */
export function parseBox(value: string | undefined | null): BoxValues | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map(parsePx);
  if (parts.some((p) => p === null)) return null;
  const nums = parts as number[];
  if (nums.length === 1) {
    const v = nums[0]!;
    return { top: v, right: v, bottom: v, left: v };
  }
  if (nums.length === 2) {
    return { top: nums[0]!, right: nums[1]!, bottom: nums[0]!, left: nums[1]! };
  }
  if (nums.length === 3) {
    return { top: nums[0]!, right: nums[1]!, bottom: nums[2]!, left: nums[1]! };
  }
  if (nums.length === 4) {
    return { top: nums[0]!, right: nums[1]!, bottom: nums[2]!, left: nums[3]! };
  }
  return null;
}

/**
 * Snap a measured pixel value to the nearest "common" size if it's within
 * tolerance, otherwise return as-is. Used when picking between exact arbitrary
 * Tailwind values (`text-[73px]`) and theme tokens.
 */
export function snapToToken(value: number, candidates: readonly number[], tolerance = 1): number {
  let best = value;
  let bestDelta = Infinity;
  for (const c of candidates) {
    const delta = Math.abs(c - value);
    if (delta < bestDelta && delta <= tolerance) {
      best = c;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Extract URLs from a CSS background-image value. Handles multiple stacked
 * backgrounds and ignores gradient functions.
 */
export function extractUrls(backgroundImage: string | undefined | null): readonly string[] {
  if (!backgroundImage) return [];
  const out: string[] = [];
  const re = /url\((['"]?)([^'")]+)\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(backgroundImage)) !== null) {
    out.push(m[2]!);
  }
  return out;
}
