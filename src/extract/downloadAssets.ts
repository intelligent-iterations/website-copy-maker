/**
 * Effectful: download every ExtractedAsset URL to a local public/assets/
 * directory and return a remote-URL → local-path map. Generators consume the
 * map to rewrite `<img src>`/`background-image` to local paths so the
 * generated copy is portable.
 *
 * Per-asset failures are logged and omitted from the map; the function
 * never throws unless the request context itself is broken.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { APIRequestContext } from "playwright";
import type { ExtractedAsset } from "./types.js";

export type AssetMap = ReadonlyMap<string, string>;

export type DownloadAssetsOptions = {
  readonly assets: readonly ExtractedAsset[];
  readonly publicDir: string; // absolute path to <outDir>/public/assets
  readonly request: APIRequestContext;
  readonly sourceUrl: string;
  readonly logger?: { warn: (msg: string, data?: Record<string, unknown>) => void };
  readonly limits?: Partial<AssetDownloadLimits>;
};

export type AssetDownloadLimits = {
  readonly maxAssets: number;
  readonly maxAssetBytes: number;
  readonly maxTotalBytes: number;
};

export const DEFAULT_ASSET_DOWNLOAD_LIMITS: AssetDownloadLimits = {
  maxAssets: 512,
  maxAssetBytes: 10 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-woff": "woff",
  "application/vnd.ms-fontobject": "eot",
};

export async function downloadAssets(opts: DownloadAssetsOptions): Promise<AssetMap> {
  const { assets, publicDir, request, sourceUrl, logger } = opts;
  const limits = { ...DEFAULT_ASSET_DOWNLOAD_LIMITS, ...opts.limits };
  if (
    !Number.isInteger(limits.maxAssets) ||
    limits.maxAssets < 1 ||
    !Number.isInteger(limits.maxAssetBytes) ||
    limits.maxAssetBytes < 1 ||
    !Number.isInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < limits.maxAssetBytes
  ) {
    throw new Error("Invalid asset download limits");
  }
  await fs.mkdir(publicDir, { recursive: true });

  const map = new Map<string, string>();
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const asset of assets) {
    if (seen.has(asset.url)) continue;
    if (seen.size >= limits.maxAssets) {
      logger?.warn?.("asset count limit reached", { maxAssets: limits.maxAssets });
      break;
    }
    seen.add(asset.url);

    try {
      const response = await request.get(asset.url, {
        headers: { Referer: sourceUrl },
        maxRedirects: 2,
        maxRetries: 0,
        timeout: 20_000,
      });
      if (!response.ok()) {
        logger?.warn?.("asset http error", { url: asset.url, status: response.status() });
        continue;
      }
      const declared = Number(response.headers()["content-length"] ?? "0");
      if (
        declared > limits.maxAssetBytes ||
        (declared > 0 && totalBytes + declared > limits.maxTotalBytes)
      ) {
        logger?.warn?.("asset byte limit exceeded", {
          url: asset.url,
          bytes: declared,
          maxAssetBytes: limits.maxAssetBytes,
          remainingBytes: limits.maxTotalBytes - totalBytes,
        });
        continue;
      }
      const buffer = await response.body();
      if (buffer.length === 0) {
        logger?.warn?.("asset empty body", { url: asset.url });
        continue;
      }
      if (
        buffer.length > limits.maxAssetBytes ||
        totalBytes + buffer.length > limits.maxTotalBytes
      ) {
        logger?.warn?.("asset byte limit exceeded", {
          url: asset.url,
          bytes: buffer.length,
          maxAssetBytes: limits.maxAssetBytes,
          remainingBytes: limits.maxTotalBytes - totalBytes,
        });
        continue;
      }
      const filename = makeFilename(asset.url, response.headers()["content-type"]);
      const absPath = path.join(publicDir, filename);
      await fs.writeFile(absPath, buffer);
      totalBytes += buffer.length;
      map.set(asset.url, `/assets/${filename}`);
    } catch (err) {
      logger?.warn?.("asset download failed", {
        url: asset.url,
        error: (err as Error).message,
      });
    }
  }
  return map;
}

export function makeFilename(url: string, contentType?: string): string {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  let parsedPath = "";
  try {
    parsedPath = new URL(url).pathname;
  } catch {
    parsedPath = url;
  }
  const baseRaw = path.basename(parsedPath) || "asset";
  const sanitized = sanitize(removeExt(baseRaw)).slice(0, 60) || "asset";

  const urlExt = path.extname(parsedPath).replace(".", "").toLowerCase();
  const mimeExt = contentType
    ? EXT_BY_MIME[contentType.split(";")[0]!.trim().toLowerCase()]
    : undefined;
  const ext = mimeExt ?? (urlExt && urlExt.length <= 5 ? urlExt : "bin");

  return `${hash}-${sanitized}.${ext}`;
}

function removeExt(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

function sanitize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}
