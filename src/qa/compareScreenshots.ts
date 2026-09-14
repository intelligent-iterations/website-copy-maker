/**
 * Pure-ish: compare two PNG buffers via pixelmatch.
 *
 * Returns:
 *  - `similarity` (informational only)
 *  - `tiles` - per-100×100-px tile mismatch counts and ratios
 *  - `tilesFailed` - how many tiles exceed TILE_MAX_RATIO
 *  - `worstTile` - the single highest-ratio tile (for triage)
 *  - `diffPng` - pixelmatch's red-on-mismatch buffer
 *
 * The tile fields are the load-bearing pass/fail signal downstream.
 * `similarity` is kept for diagnostic display.
 *
 * Preserve document pixels: pad to the union of both image bounds, never
 * scale or crop. Missing/extra page area is an explicit mismatch.
 */

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** Tile dimension in pixels. 100×100 = 10,000 px per full tile. */
export const TILE_SIZE = 100;
/** A tile fails when more than 4% of its pixels are mismatched. This allows
 * modest cross-browser sub-pixel font and responsive-image differences while
 * remaining strict enough to surface local layout regressions. No tile is exempt;
 * this is a non-negotiable gate, not a per-run knob. */
export const TILE_MAX_RATIO = 0.04;

export type TileResult = {
  readonly x: number; // tile origin in canvas px
  readonly y: number;
  readonly width: number; // TILE_SIZE except for right/bottom edge tiles
  readonly height: number;
  readonly mismatched: number;
  readonly ratio: number; // mismatched / (width*height)
};

export type CompareResult = {
  readonly similarity: number;
  readonly width: number;
  readonly height: number;
  readonly diffPng: Buffer;
  readonly tiles: readonly TileResult[];
  readonly tilesFailed: number;
  readonly worstTile: TileResult | null;
};

export type CompareOptions = {
  readonly threshold?: number; // pixelmatch per-pixel sensitivity 0..1
};

export async function compareScreenshots(
  originalPng: Buffer,
  generatedPng: Buffer,
  opts: CompareOptions = {},
): Promise<CompareResult> {
  const threshold = opts.threshold ?? 0.1;

  const original = PNG.sync.read(originalPng);
  const generated = PNG.sync.read(generatedPng);

  const width = Math.max(original.width, generated.width);
  const height = Math.max(original.height, generated.height);
  const a = pad(original, width, height);
  const b = pad(generated, width, height);
  const diff = new PNG({ width, height });
  pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold,
    includeAA: false,
  });
  let mismatched = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inSource = x < original.width && y < original.height;
      const inReplica = x < generated.width && y < generated.height;
      if (inSource !== inReplica) {
        diff.data.set([255, 0, 0, 255], i);
      }
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
        mismatched++;
      }
    }
  }
  const total = width * height;
  const similarity = total > 0 ? 1 - mismatched / total : 0;
  const { tiles, tilesFailed, worstTile } = computeTiles(diff.data, width, height);
  return {
    similarity,
    width,
    height,
    diffPng: PNG.sync.write(diff),
    tiles,
    tilesFailed,
    worstTile,
  };
}

/** Walk the diff buffer once, accumulating per-tile mismatch counts.
 * Pixelmatch marks mismatched pixels red (255,0,0,255) and unchanged
 * pixels with low-alpha grey; we count any pixel whose red channel is
 * 255 and green/blue are 0 - the canonical pixelmatch mismatch marker. */
function computeTiles(
  diff: Buffer,
  width: number,
  height: number,
): { tiles: TileResult[]; tilesFailed: number; worstTile: TileResult | null } {
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const ty = Math.floor(y / TILE_SIZE);
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowBase + x * 4;
      if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0) {
        counts[ty * cols + Math.floor(x / TILE_SIZE)]! += 1;
      }
    }
  }
  const tiles: TileResult[] = [];
  let tilesFailed = 0;
  let worstTile: TileResult | null = null;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      const w = Math.min(TILE_SIZE, width - x);
      const h = Math.min(TILE_SIZE, height - y);
      const denom = w * h;
      if (denom <= 0) continue;
      const m = counts[ty * cols + tx] ?? 0;
      const ratio = m / denom;
      const tile: TileResult = { x, y, width: w, height: h, mismatched: m, ratio };
      tiles.push(tile);
      if (ratio > TILE_MAX_RATIO) tilesFailed++;
      if (worstTile === null || ratio > worstTile.ratio) worstTile = tile;
    }
  }
  return { tiles, tilesFailed, worstTile };
}

function pad(source: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(source, out, 0, 0, source.width, source.height, 0, 0);
  return out;
}
