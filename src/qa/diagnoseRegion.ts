/**
 * Classify a pixel-diff hot-zone by what's actually wrong inside its
 * bounding box. The patcher uses this to choose an action (set bg-color,
 * shift rect, re-add element, drop element, ignore) instead of mutating
 * the model blindly.
 *
 * Categories:
 *   - wrong-color    : both crops mostly uniform but average color differs
 *   - missing-element: source crop has saturated content, rebuild is bg
 *   - extra-element  : rebuild crop has saturated content, source is bg
 *   - position-shift : same content but offset by (dx, dy)
 *   - size-shift     : same content but scaled
 *   - anti-aliasing  : high-frequency residual along an edge
 *   - unknown        : none of the above (logged but not auto-patched)
 *
 * Pure: no IO, takes RGBA buffers.
 */

import sharp from "sharp";

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

export type RegionCrop = {
  readonly width: number;
  readonly height: number;
  /** RGBA pixel data (length = width * height * 4). */
  readonly data: Buffer;
};

export type RegionDiagnosis =
  | {
      readonly kind: "wrong-color";
      readonly expected: Rgb;
      readonly actual: Rgb;
      readonly deltaE: number;
    }
  | { readonly kind: "missing-element"; readonly sourceMean: Rgb; readonly sourceStdDev: number }
  | { readonly kind: "extra-element"; readonly rebuildMean: Rgb; readonly rebuildStdDev: number }
  | {
      readonly kind: "position-shift";
      readonly dx: number;
      readonly dy: number;
      readonly correlation: number;
    }
  | { readonly kind: "size-shift"; readonly scale: number; readonly correlation: number }
  | { readonly kind: "anti-aliasing"; readonly edgeRatio: number }
  | { readonly kind: "unknown" };

export type DiagnoseInput = {
  readonly source: RegionCrop;
  readonly rebuild: RegionCrop;
};

const WRONG_COLOR_DELTA_E = 5;
const UNIFORM_STDDEV_THRESHOLD = 25;
const MISSING_SATURATION_THRESHOLD = 12;
const EDGE_RATIO_AA_MAX = 0.45;
const POSITION_SEARCH_RADIUS = 24;

/**
 * Crop a region from a full-page RGBA buffer. Used by the QA loop to
 * extract the source and rebuild patches at a given hot-zone.
 *
 * Safety: clamps the rectangle to the image's actual dimensions so
 * out-of-bounds crops (which can happen when source/rebuild PNGs differ
 * in size and the hot-zone sits past the smaller one) just return an
 * empty crop instead of throwing.
 */
export async function cropRegion(
  pngBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
): Promise<RegionCrop> {
  // Read image metadata once so we can clamp the extract rectangle.
  const meta = await sharp(pngBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (
    imgW === 0 ||
    imgH === 0 ||
    region.x >= imgW ||
    region.y >= imgH ||
    region.width <= 0 ||
    region.height <= 0
  ) {
    return { width: 0, height: 0, data: Buffer.alloc(0) };
  }
  const left = Math.max(0, Math.min(imgW - 1, Math.floor(region.x)));
  const top = Math.max(0, Math.min(imgH - 1, Math.floor(region.y)));
  const width = Math.max(1, Math.min(imgW - left, Math.floor(region.width)));
  const height = Math.max(1, Math.min(imgH - top, Math.floor(region.height)));
  const out = await sharp(pngBuffer)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: out.info.width, height: out.info.height, data: out.data };
}

export function diagnoseRegion(input: DiagnoseInput): RegionDiagnosis {
  const { source, rebuild } = input;
  if (source.width === 0 || source.height === 0) return { kind: "unknown" };
  if (rebuild.width === 0 || rebuild.height === 0) return { kind: "unknown" };

  // Resize rebuild crop to source dimensions if they differ (sub-pixel
  // alignment after the page-level cover-resize). The crops should be the
  // same size at this point - guard anyway.
  const w = Math.min(source.width, rebuild.width);
  const h = Math.min(source.height, rebuild.height);

  const srcStats = colorStats(source, w, h);
  const rebStats = colorStats(rebuild, w, h);

  // ── Anti-aliasing: edge-only residual ────────────────────────────────
  // If both crops have similar mean and similar stddev, but the diff is
  // concentrated on edges of high-frequency features (text, image
  // boundaries), this is sub-pixel rasterization noise. Detect by edge
  // ratio: fraction of pixels that differ in luminance by < 30 (small).
  const edgeRatio = lowAmplitudeDiffRatio(source, rebuild, w, h);
  if (
    Math.hypot(
      srcStats.mean.r - rebStats.mean.r,
      srcStats.mean.g - rebStats.mean.g,
      srcStats.mean.b - rebStats.mean.b,
    ) < 8 &&
    edgeRatio >= EDGE_RATIO_AA_MAX
  ) {
    return { kind: "anti-aliasing", edgeRatio };
  }

  const sourceUniform = srcStats.stdDev < UNIFORM_STDDEV_THRESHOLD;
  const rebuildUniform = rebStats.stdDev < UNIFORM_STDDEV_THRESHOLD;
  const meanDist = Math.hypot(
    srcStats.mean.r - rebStats.mean.r,
    srcStats.mean.g - rebStats.mean.g,
    srcStats.mean.b - rebStats.mean.b,
  );

  // ── Image noise (sub-pixel rasterization, JPEG encoding diff): both
  //    crops are structured, means are close, and on-axis correlation is
  //    high. Treat as AA-class - patcher can't do anything useful, gate
  //    should not block on it. (Catches the "image#n122 with 16k mismatched
  //    pixels but visually identical" case from iter7's first run.)
  if (!sourceUniform && !rebuildUniform && meanDist < 30) {
    const onAxisCorr = correlation(source, rebuild, w, h, 0, 0);
    if (onAxisCorr > 0.7) {
      return { kind: "anti-aliasing", edgeRatio };
    }
  }

  // ── Wrong color: both uniform, means differ ──────────────────────────
  // Solid color regions (e.g., card backgrounds): both crops have very
  // low stdDev. If their means differ beyond Δ-E threshold, the bg-color
  // is wrong. (Checked first - when both are uniform, position/shift
  // detection can't tell us anything useful.)
  if (sourceUniform && rebuildUniform) {
    const dE = colorDistance(srcStats.mean, rebStats.mean);
    if (dE > WRONG_COLOR_DELTA_E) {
      return { kind: "wrong-color", expected: srcStats.mean, actual: rebStats.mean, deltaE: dE };
    }
    // Both uniform AND close in color: not really a region of interest.
    return { kind: "anti-aliasing", edgeRatio };
  }

  // ── Position-shift: same content offset by (dx, dy) ──────────────────
  // Checked BEFORE missing/extra because a shifted element produces
  // structured-vs-bg patches in different parts of the same crop, which
  // would otherwise misclassify as "extra" or "missing". If a small
  // translation gives high correlation, the element is in the wrong
  // place.
  const shift = bestTranslation(source, rebuild, w, h, POSITION_SEARCH_RADIUS);
  if (shift && shift.correlation > 0.85 && (Math.abs(shift.dx) > 1 || Math.abs(shift.dy) > 1)) {
    return { kind: "position-shift", dx: shift.dx, dy: shift.dy, correlation: shift.correlation };
  }

  // ── Missing element: source has structure, rebuild is bg-uniform ─────
  if (!sourceUniform && rebuildUniform && srcStats.saturation > MISSING_SATURATION_THRESHOLD) {
    return { kind: "missing-element", sourceMean: srcStats.mean, sourceStdDev: srcStats.stdDev };
  }

  // ── Extra element: rebuild has structure, source is bg-uniform ───────
  if (sourceUniform && !rebuildUniform && rebStats.saturation > MISSING_SATURATION_THRESHOLD) {
    return { kind: "extra-element", rebuildMean: rebStats.mean, rebuildStdDev: rebStats.stdDev };
  }

  return { kind: "unknown" };
}

// ─── Pixel-stats helpers ──────────────────────────────────────────────────

function colorStats(
  crop: RegionCrop,
  w: number,
  h: number,
): { mean: Rgb; stdDev: number; saturation: number } {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * crop.width + x) * 4;
      sumR += crop.data[i]!;
      sumG += crop.data[i + 1]!;
      sumB += crop.data[i + 2]!;
      count++;
    }
  }
  if (count === 0) return { mean: { r: 0, g: 0, b: 0 }, stdDev: 0, saturation: 0 };
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;

  // Per-channel stdDev (R, G, B). Take the MAX across channels to use as
  // the "structured-ness" signal: a solid color has all-zero stddev,
  // a chroma-cycling stripe pattern has high G stddev even when its
  // luminance happens to be near-constant. Luminance-only stdDev misses
  // chroma-only structure entirely (red vs green at equal luminance).
  let varR = 0;
  let varG = 0;
  let varB = 0;
  let satSum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * crop.width + x) * 4;
      const r = crop.data[i]!;
      const g = crop.data[i + 1]!;
      const b = crop.data[i + 2]!;
      varR += (r - meanR) * (r - meanR);
      varG += (g - meanG) * (g - meanG);
      varB += (b - meanB) * (b - meanB);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max - min;
    }
  }
  const stdDevR = Math.sqrt(varR / count);
  const stdDevG = Math.sqrt(varG / count);
  const stdDevB = Math.sqrt(varB / count);
  const stdDev = Math.max(stdDevR, stdDevG, stdDevB);
  const saturation = satSum / count;
  return {
    mean: { r: Math.round(meanR), g: Math.round(meanG), b: Math.round(meanB) },
    stdDev,
    saturation,
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  // Plain Euclidean RGB distance - sufficient for "same vs different
  // background color" classification. (Δ-E in Lab would be more
  // perceptual, but for our threshold this is fine.)
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Fraction of pixels whose RGB diff has small magnitude (< 30). High
 * value means the diff is concentrated in low-amplitude residuals (AA),
 * not in solid-color regions (bg-color drift). */
function lowAmplitudeDiffRatio(a: RegionCrop, b: RegionCrop, w: number, h: number): number {
  let smallCount = 0;
  let totalDiffCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      const dr = a.data[i]! - b.data[j]!;
      const dg = a.data[i + 1]! - b.data[j + 1]!;
      const db = a.data[i + 2]! - b.data[j + 2]!;
      const mag = Math.sqrt(dr * dr + dg * dg + db * db);
      if (mag > 8) {
        totalDiffCount++;
        if (mag < 30) smallCount++;
      }
    }
  }
  if (totalDiffCount === 0) return 1;
  return smallCount / totalDiffCount;
}

/** Search a small window for the (dx, dy) shift of `rebuild` that best
 * aligns with `source`. Returns the best correlation found. Coarse: only
 * tries integer pixel shifts. Returns null if region is too small. */
function bestTranslation(
  source: RegionCrop,
  rebuild: RegionCrop,
  w: number,
  h: number,
  radius: number,
): { dx: number; dy: number; correlation: number } | null {
  if (w < 16 || h < 16) return null;
  const r = Math.min(radius, Math.floor(Math.min(w, h) / 4));
  let best = { dx: 0, dy: 0, correlation: -1 };
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const c = correlation(source, rebuild, w, h, dx, dy);
      if (c > best.correlation) best = { dx, dy, correlation: c };
    }
  }
  return best;
}

function correlation(
  source: RegionCrop,
  rebuild: RegionCrop,
  w: number,
  h: number,
  dx: number,
  dy: number,
): number {
  // Sample a coarse grid (every 4 px) to keep this cheap - we just want a
  // ranking signal, not a sub-pixel registration.
  let n = 0;
  let matches = 0;
  for (let y = Math.max(0, -dy); y < h - Math.max(0, dy); y += 4) {
    for (let x = Math.max(0, -dx); x < w - Math.max(0, dx); x += 4) {
      const xs = x;
      const ys = y;
      const xr = x + dx;
      const yr = y + dy;
      if (xr < 0 || xr >= w || yr < 0 || yr >= h) continue;
      const i = (ys * source.width + xs) * 4;
      const j = (yr * rebuild.width + xr) * 4;
      const dr = source.data[i]! - rebuild.data[j]!;
      const dg = source.data[i + 1]! - rebuild.data[j + 1]!;
      const db = source.data[i + 2]! - rebuild.data[j + 2]!;
      const mag = Math.sqrt(dr * dr + dg * dg + db * db);
      if (mag < 16) matches++;
      n++;
    }
  }
  if (n === 0) return 0;
  return matches / n;
}
