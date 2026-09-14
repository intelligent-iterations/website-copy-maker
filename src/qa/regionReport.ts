/**
 * Pure: turn a pixelmatch diff PNG into actionable region info - Y-bands so
 * the patcher and a human reading the test failure both know which slice of
 * the page is off, plus connected-component "hot zones" so they know the
 * specific area inside that slice.
 *
 * Diff format (from pixelmatch): pixels with mismatch are red (255,0,0,255);
 * pixels that match are antialiased red over the original, but in our
 * downstream usage we only call this on the diff buffer where mismatches
 * are bright red. We treat "red > 200 AND green < 80 AND blue < 80" as the
 * mismatch mask.
 */

import type { ViewportName } from "../agent/thresholds.js";

export type RegionLabel = "match" | "minor" | "moderate" | "severe";

export type YBand = {
  readonly yStart: number;
  readonly yEnd: number;
  readonly similarity: number;
  readonly mismatchedPixels: number;
  readonly label: RegionLabel;
};

export type HotZone = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mismatchedPixels: number;
  readonly density: number;
};

export type RegionReport = {
  readonly viewport: ViewportName;
  readonly width: number;
  readonly height: number;
  readonly overall: {
    readonly similarity: number;
    readonly mismatchedPixels: number;
    readonly totalPixels: number;
  };
  readonly yBands: readonly YBand[];
  readonly hotZones: readonly HotZone[];
};

const BAND_COUNT = 8;
const HOT_ZONE_LIMIT = 5;
const MIN_HOT_ZONE_PIXELS = 20;

export function buildRegionReport(opts: {
  readonly diffData: Uint8Array | Buffer; // RGBA buffer length = width*height*4
  readonly width: number;
  readonly height: number;
  readonly viewport: ViewportName;
}): RegionReport {
  const { diffData, width, height, viewport } = opts;
  const mask = buildMismatchMask(diffData, width, height);
  const totalPixels = width * height;
  const totalMismatched = countTrue(mask);

  return {
    viewport,
    width,
    height,
    overall: {
      similarity: totalPixels > 0 ? 1 - totalMismatched / totalPixels : 0,
      mismatchedPixels: totalMismatched,
      totalPixels,
    },
    yBands: computeYBands(mask, width, height),
    hotZones: computeHotZones(mask, width, height),
  };
}

function buildMismatchMask(data: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    if (r > 200 && g < 80 && b < 80) mask[i] = 1;
  }
  return mask;
}

function countTrue(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

function computeYBands(mask: Uint8Array, width: number, height: number): YBand[] {
  const bands: YBand[] = [];
  const bandHeight = Math.max(1, Math.ceil(height / BAND_COUNT));
  for (let b = 0; b < BAND_COUNT; b++) {
    const yStart = b * bandHeight;
    const yEnd = Math.min(height, yStart + bandHeight);
    if (yStart >= yEnd) break;
    let mismatched = 0;
    for (let y = yStart; y < yEnd; y++) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[rowStart + x]) mismatched++;
      }
    }
    const totalInBand = (yEnd - yStart) * width;
    const similarity = totalInBand > 0 ? 1 - mismatched / totalInBand : 1;
    bands.push({
      yStart,
      yEnd,
      similarity,
      mismatchedPixels: mismatched,
      label: labelFor(similarity),
    });
  }
  return bands;
}

function labelFor(similarity: number): RegionLabel {
  if (similarity >= 0.95) return "match";
  if (similarity >= 0.85) return "minor";
  if (similarity >= 0.7) return "moderate";
  return "severe";
}

/**
 * 4-connected component pass over the mismatch mask. Returns the top-N
 * components ranked by `area * density`, where density is fraction of the
 * bounding box that is mismatch.
 */
function computeHotZones(mask: Uint8Array, width: number, height: number): HotZone[] {
  const visited = new Uint8Array(mask.length);
  type Box = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    pixels: number;
  };
  const components: Box[] = [];
  const stack: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i] || visited[i]) continue;
      const box: Box = { minX: x, minY: y, maxX: x, maxY: y, pixels: 0 };
      stack.length = 0;
      stack.push(i);
      visited[i] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;
        box.pixels++;
        if (cx < box.minX) box.minX = cx;
        if (cx > box.maxX) box.maxX = cx;
        if (cy < box.minY) box.minY = cy;
        if (cy > box.maxY) box.maxY = cy;
        // 4-neighborhood
        if (cx + 1 < width) {
          const ni = cur + 1;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
        if (cx > 0) {
          const ni = cur - 1;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
        if (cy + 1 < height) {
          const ni = cur + width;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
        if (cy > 0) {
          const ni = cur - width;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (box.pixels >= MIN_HOT_ZONE_PIXELS) components.push(box);
    }
  }

  return components
    .map((b) => {
      const w = b.maxX - b.minX + 1;
      const h = b.maxY - b.minY + 1;
      const area = w * h;
      const density = area > 0 ? b.pixels / area : 0;
      return {
        x: b.minX,
        y: b.minY,
        width: w,
        height: h,
        mismatchedPixels: b.pixels,
        density,
      };
    })
    .sort((a, b) => b.mismatchedPixels * b.density - a.mismatchedPixels * a.density)
    .slice(0, HOT_ZONE_LIMIT);
}
