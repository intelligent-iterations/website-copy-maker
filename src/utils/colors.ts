/**
 * Pure color helpers. No DOM, no IO.
 * Operates on the strings getComputedStyle returns: rgb(), rgba(), or hex.
 */

export type RGBA = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const RGB_RE =
  /^rgba?\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/;

export function parseColor(value: string): RGBA | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex = HEX_RE.exec(trimmed);
  if (hex) return parseHex(hex[1]!);

  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const [, r, g, b, a] = rgb;
    return {
      r: clamp(Number(r), 0, 255),
      g: clamp(Number(g), 0, 255),
      b: clamp(Number(b), 0, 255),
      a: parseAlpha(a),
    };
  }

  return null;
}

export function toHex(color: RGBA): string {
  const r = component(color.r);
  const g = component(color.g);
  const b = component(color.b);
  if (color.a >= 1) return `#${r}${g}${b}`;
  const a = component(Math.round(color.a * 255));
  return `#${r}${g}${b}${a}`;
}

/**
 * Group similar colors. Two colors are "similar" when |delta| in each RGB
 * channel is <= tolerance. Returns one canonical color per cluster, ordered
 * by descending frequency.
 */
export function clusterColors(values: readonly string[], tolerance = 8): readonly string[] {
  type Cluster = { color: RGBA; count: number };
  const clusters: Cluster[] = [];

  for (const raw of values) {
    const c = parseColor(raw);
    if (!c) continue;
    if (c.a === 0) continue;
    const existing = clusters.find((cl) => similar(cl.color, c, tolerance));
    if (existing) {
      existing.count += 1;
    } else {
      clusters.push({ color: c, count: 1 });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters.map((cl) => toHex(cl.color));
}

// ── internals ──

function parseHex(raw: string): RGBA {
  let hex = raw;
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  if (hex.length === 4) {
    const expanded = hex
      .split("")
      .map((c) => c + c)
      .join("");
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
      a: parseInt(expanded.slice(6, 8), 16) / 255,
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (raw.endsWith("%")) return clamp(Number(raw.slice(0, -1)) / 100, 0, 1);
  return clamp(Number(raw), 0, 1);
}

function component(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function similar(a: RGBA, b: RGBA, tol: number): boolean {
  return (
    Math.abs(a.r - b.r) <= tol &&
    Math.abs(a.g - b.g) <= tol &&
    Math.abs(a.b - b.b) <= tol &&
    Math.abs(a.a - b.a) <= 0.05
  );
}
