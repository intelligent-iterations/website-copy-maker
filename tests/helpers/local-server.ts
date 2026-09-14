/**
 * Tiny test helper: start a static-file server on a free port over a fixture
 * directory, return the URL + a dispose function. No `mocks` - this is a real
 * HTTP server backed by the same library the tool's docs reference.
 */

import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";

export type LocalServer = {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
};

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export async function startLocalServer(rootDir: string): Promise<LocalServer> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/" || pathname.endsWith("/")) pathname = path.join(pathname, "index.html");

      const safe = path.normalize(path.join(rootDir, pathname));
      if (!safe.startsWith(path.normalize(rootDir))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const data = await fs.readFile(safe).catch(() => null);
      if (!data) {
        // Return a tiny 1x1 transparent PNG for missing image asks (fonts,
        // background-image, og-image, favicon) so the rendered page settles
        // without 404 spam in the test logs.
        if (/\.(png|jpg|jpeg|gif|webp|ico|svg)$/i.test(pathname)) {
          res.writeHead(200, { "content-type": "image/png" });
          res.end(TRANSPARENT_PNG);
          return;
        }
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(safe).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(data);
    } catch (err) {
      res.writeHead(500);
      res.end((err as Error).message);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// 1×1 transparent PNG.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);
