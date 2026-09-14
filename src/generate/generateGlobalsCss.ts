import type { DesignTokens } from "../analyze/inferTokens.js";
import type { ExtractedFontFace } from "../extract/types.js";
import type { AssetMap } from "../extract/downloadAssets.js";

export function generateGlobalsCss(
  tokens: DesignTokens,
  fontFaces: readonly ExtractedFontFace[] = [],
  assetMap: AssetMap = new Map(),
): string {
  const fontStack = tokens.fontFamilies.length
    ? tokens.fontFamilies.map((f) => `"${f}"`).join(", ") + ", system-ui, sans-serif"
    : "system-ui, sans-serif";

  const materializedFonts = generateFontFaceCss(fontFaces, assetMap);

  return `${materializedFonts}@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-sans: ${fontStack};
}

html,
body {
  font-family: var(--font-sans);
  background-color: ${tokens.colors.page};
  color: ${tokens.colors.ink};
  /* Prevent browser scroll anchoring from re-targeting during fast
   * wheel/momentum scrolls. With a transformed inner, the browser's
   * heuristics can briefly re-clamp the viewport to a layout-box edge
   * (smaller than the visual scaled height), making fast scrolls feel
   * like the page ended early and forcing multiple short scrolls. */
  overflow-anchor: none;
  /* Stop momentum/rubber-band from chaining out of body and snapping
   * the viewport back as if there were no more content to scroll. */
  overscroll-behavior-y: contain;
}

/* ─── Fidelity scaling shell ─────────────────────────────────────────────
 * The "exact"-mode renderer emits a fixed-width absolute canvas (e.g.,
 * 1440px). The shell scales the inner canvas to track the viewport width
 * - DOWN at narrower viewports (so content doesn't clip) and UP at wider
 * ones (so the page fills 4K / ultrawide displays instead of stranding
 * a 1440 island). The outer container's height tracks the scaled inner
 * so flow below the canvas stays correct.
 *
 * Each rendered page sets two custom properties on .fidelity-canvas-outer:
 *   --canvas-w (pixels of the source canvas width)
 *   --canvas-h (pixels of the source canvas height)
 */
.fidelity-canvas-outer {
  width: 100%;
  overflow-x: hidden;
  display: flex;
  justify-content: center;
  /* Prevent the default flex stretch from forcing the inner to match
   * the outer height. The inner's layout must stay at min-height
   * canvas-h; otherwise transform: scale doubles the visual height
   * (inner-layout = outer-height, then scaled 1.85x), making the
   * scrollable area extend past the visible content. */
  align-items: flex-start;
  /* Track the scaled inner so flow below stays correct. No cap - the
   * canvas always fills the viewport edge-to-edge, scaling up at wide
   * viewports and down at narrow ones. Capping introduced visible
   * whitespace at wide widths and inside breakpoint boundaries
   * (e.g. 720px viewport with the mobile 390 canvas). */
  height: calc(var(--canvas-h) * (100vw / var(--canvas-w)));
}
.fidelity-canvas-inner {
  flex: 0 0 auto;
  transform-origin: top center;
  /* Scale fluidly with viewport width - shrinks below the canvas width
   * to prevent right-edge clip, grows above to fill wider monitors and
   * to bridge the breakpoint gap (mobile→tablet at 768) without leaving
   * a stranded fixed-width island. */
  transform: scale(calc(100vw / var(--canvas-w)));
}
`;
}

export function generateFontFaceCss(
  fontFaces: readonly ExtractedFontFace[],
  assetMap: AssetMap,
): string {
  const rules: string[] = [];
  for (const face of fontFaces) {
    const sources = face.sources.flatMap((source) => {
      const local = assetMap.get(source.url);
      if (!local?.startsWith("/assets/")) return [];
      const format = safeToken(source.format ?? "");
      return [`url(${JSON.stringify(local)})${format ? ` format(${JSON.stringify(format)})` : ""}`];
    });
    if (sources.length === 0) continue;
    const family = face.family.replace(/[\\"\n\r]/g, (char) => `\\${char}`);
    const style = safeDescriptor(face.style, "normal");
    const weight = safeDescriptor(face.weight, "400");
    const stretch = safeDescriptor(face.stretch, "normal");
    const display = /^(?:auto|block|swap|fallback|optional)$/i.test(face.display)
      ? face.display.toLowerCase()
      : "swap";
    const unicodeRange = /^U\+[0-9A-F?,-]+(?:\s*,?\s*U\+[0-9A-F?,-]+)*$/i.test(
      face.unicodeRange ?? "",
    )
      ? `\n  unicode-range: ${face.unicodeRange};`
      : "";
    rules.push(`@font-face {
  font-family: "${family}";
  src: ${sources.join(", ")};
  font-style: ${style};
  font-weight: ${weight};
  font-stretch: ${stretch};
  font-display: ${display};${unicodeRange}
}`);
  }
  return rules.length > 0 ? rules.join("\n\n") + "\n\n" : "";
}

function safeDescriptor(value: string, fallback: string): string {
  return /^[A-Za-z0-9 .%+-]+$/.test(value) ? value : fallback;
}

function safeToken(value: string): string {
  return /^[A-Za-z0-9 ._-]+$/.test(value) ? value : "";
}
