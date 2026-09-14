/**
 * Lazy-load extraction guarantee.
 *
 * Exercises an IntersectionObserver lazy-mount that needs a scroll trigger
 * before the <img> gets a real src + becomes visible. The fixture starts the
 * image at opacity 0 with a placeholder src; an IO callback swaps both
 * when the element scrolls into view.
 *
 * The fix is in `waitForStablePage.ts` (scroll-walk pass) plus
 * `extractDom.ts` (don't drop <img> with src regardless of visibility).
 * This test asserts the lazy image reaches the extracted tree.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPage } from "../../src/extract/extractPage.js";
import { startLocalServer, type LocalServer } from "../helpers/local-server.js";
import type { ExtractedNode } from "../../src/extract/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "..", "fixtures", "lazy-hero");

let server: LocalServer;

beforeAll(async () => {
  server = await startLocalServer(FIXTURE);
});

afterAll(async () => {
  if (server) await server.close();
});

function findFirst(root: ExtractedNode, pred: (n: ExtractedNode) => boolean): ExtractedNode | null {
  if (pred(root)) return root;
  for (const c of root.children) {
    const f = findFirst(c, pred);
    if (f) return f;
  }
  return null;
}

describe("extract: lazy-loaded hero", () => {
  it("captures the IntersectionObserver-lazy <img> after scroll-walk", async () => {
    const { page } = await extractPage({
      url: server.url,
      viewport: { name: "desktop", width: 1440, height: 900 },
    });

    // The deferred <img> must appear in the extracted tree...
    const phone = findFirst(
      page.root,
      (n) => n.tag === "img" && (n.src ?? "").endsWith("/phone.png"),
    );
    expect(phone, "expected the lazy <img> to land in the extracted tree").not.toBeNull();
    // ...and it must have a non-zero rect (the scroll-walk fired the IO,
    // making the element visible at extraction time). Even if visibility
    // didn't fully resolve, the <img>-with-src exemption still emits the
    // node - but the goal of waitForStablePage is to make the rect real.
    expect(phone!.rect.width).toBeGreaterThan(0);
    expect(phone!.rect.height).toBeGreaterThan(0);
  }, 60_000);
});
