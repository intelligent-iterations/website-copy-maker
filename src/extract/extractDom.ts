/**
 * Walk the rendered DOM and emit a sanitized, computed-style-rich tree.
 *
 * The actual walker runs in the browser context via page.evaluate, so it
 * cannot import anything - it's a self-contained string of code that the
 * Node side feeds in. The Node-side wrapper just calls page.evaluate and
 * returns the JSON result.
 */

import type { Page } from "playwright";
import type { ExtractedNode } from "./types.js";

export async function extractDom(page: Page): Promise<ExtractedNode> {
  // tsx (esbuild) wraps function bodies with __name/__publicField helpers
  // for better stack traces; those helpers exist in Node but not in the
  // browser, so we shim them as identities before the real evaluate.
  await page.evaluate(`(function(){
    if (typeof globalThis.__name === 'undefined') globalThis.__name = function(t){return t};
    if (typeof globalThis.__publicField === 'undefined') globalThis.__publicField = function(t,k,v){t[k]=v;return t};
  })()`);

  const result = await page.evaluate(() => {
    // ── self-contained walker (runs in browser) ──
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "TITLE", "TEMPLATE"]);

    const STYLE_KEYS = [
      "display",
      "position",
      "zIndex",
      "overflow",
      "opacity",
      "visibility",
      "color",
      "backgroundColor",
      "backgroundImage",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "textAlign",
      "textTransform",
      "margin",
      "padding",
      "gap",
      "border",
      "borderRadius",
      "boxShadow",
      "transform",
      "flexDirection",
      "alignItems",
      "justifyContent",
      "gridTemplateColumns",
      "gridTemplateRows",
      // Image fit: when an <img> renders at a display aspect ratio that
      // differs from its natural aspect ratio, object-fit and
      // object-position avoid stretching.
      // Without these the rebuild's <img> defaults to object-fit:fill →
      // visibly stretched. Captured here, propagated by renderFlatImage.
      "objectFit",
      "objectPosition",
      // whiteSpace: when source uses `pre-line` or `pre-wrap`, hard breaks
      // (\n or <br>) render as actual breaks. Without preserving this,
      // text with `<br>` collapses to one line in the rebuild.
      "whiteSpace",
    ] as const;

    let nextId = 0;
    const makeId = (): string => `n${++nextId}`;

    const isTrackingPixel = (el: Element, rect: DOMRect): boolean => {
      if (el.tagName !== "IMG") return false;
      const image = el as HTMLImageElement;
      return rect.width <= 1 && rect.height <= 1 && !image.alt && image.children.length === 0;
    };

    const isVisible = (el: Element, styles: CSSStyleDeclaration, rect: DOMRect): boolean => {
      if (styles.display === "none") return false;
      if (styles.visibility === "hidden") return false;
      if (styles.visibility === "collapse") return false;
      const opacity = Number(styles.opacity);
      if (!Number.isNaN(opacity) && opacity === 0) return false;
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    };

    const hasVisualEffect = (styles: CSSStyleDeclaration): boolean => {
      // Wrappers with no own visual but layout/positioning/clipping/etc.
      // are still preserved in the tree.
      if (
        styles.backgroundColor &&
        styles.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        styles.backgroundColor !== "transparent"
      )
        return true;
      if (styles.backgroundImage && styles.backgroundImage !== "none") return true;
      if (styles.borderRadius && styles.borderRadius !== "0px") return true;
      if (styles.boxShadow && styles.boxShadow !== "none") return true;
      if (styles.border && !/^0px/.test(styles.border)) return true;
      if (styles.transform && styles.transform !== "none") return true;
      if (styles.overflow && styles.overflow !== "visible") return true;
      return false;
    };

    const collectAttrs = (el: Element): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("on")) continue; // strip event handlers
        out[attr.name] = attr.value;
      }
      return out;
    };

    // Inline elements whose text content is part of the parent's text flow.
    // Without folding these into directText, source like
    // `<h2>That's why we made the <span>demo</span> app.</h2>` collapses
    // to `That's why we made the  app.` (the span's text is lost) and
    // the missing word is replaced by a visible double-space.
    const INLINE_TEXT_TAGS = new Set([
      "SPAN",
      "B",
      "STRONG",
      "EM",
      "I",
      "U",
      "MARK",
      "CODE",
      "KBD",
      "SAMP",
      "SUB",
      "SUP",
      "TIME",
      "ABBR",
      "CITE",
      "SMALL",
      "Q",
      "S",
      "DEL",
      "INS",
      "VAR",
    ]);
    type RichChunk = {
      text: string;
      color?: string;
      fontWeight?: string;
      fontStyle?: string;
      /** href when the chunk was a flow-inline anchor (`<p>... <a>foo</a>
       * ...</p>`). The renderer emits an inline `<a>` so the link
       * renders as part of the text run instead of as a separately-
       * positioned absolute node floating over the paragraph. */
      href?: string;
    };
    const directText = (
      el: Element,
      computed?: CSSStyleDeclaration,
    ): { text: string; richText: RichChunk[] | null } | null => {
      let buf = "";
      let hasBr = false;
      const chunks: RichChunk[] = [];
      let hasInlineStyle = false;
      const flushPlain = (t: string) => {
        if (!t) return;
        chunks.push({ text: t });
      };
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent ?? "";
          buf += t;
          flushPlain(t);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const ce = child as Element;
          if (ce.tagName === "BR") {
            buf += "\n";
            flushPlain("\n");
            hasBr = true;
          } else if (
            INLINE_TEXT_TAGS.has(ce.tagName) ||
            (ce.tagName === "A" &&
              window.getComputedStyle(ce).display === "inline" &&
              ce.children.length === 0)
          ) {
            const t = ce.textContent ?? "";
            buf += t;
            // Capture the inline span's/link's overrides relative to the
            // parent's computed style. Only fields that DIFFER from the
            // parent become overrides; everything else inherits.
            const ccs = window.getComputedStyle(ce);
            const chunk: RichChunk = { text: t };
            if (computed && ccs.color !== computed.color) {
              chunk.color = ccs.color;
              hasInlineStyle = true;
            }
            if (computed && ccs.fontWeight !== computed.fontWeight) {
              chunk.fontWeight = ccs.fontWeight;
              hasInlineStyle = true;
            }
            if (computed && ccs.fontStyle !== computed.fontStyle) {
              chunk.fontStyle = ccs.fontStyle;
              hasInlineStyle = true;
            }
            if (ce.tagName === "A") {
              const href = (ce as HTMLAnchorElement).href;
              if (href) {
                chunk.href = href;
                hasInlineStyle = true;
              }
            }
            chunks.push(chunk);
          }
        }
      }
      // When the element uses `white-space: pre*`, CSS preserves multiple
      // spaces and tabs. Collapsing here would lose intentional spacing
      // (e.g. `🍎   demo = sample text   🍎` rendered with triple-space
      // padding via pre-wrap). For default `normal` whitespace we still
      // collapse - HTML formatting whitespace shouldn't pollute the text.
      const ws = computed?.whiteSpace ?? "";
      const preserveSpaces = ws.startsWith("pre");
      const collapseChunk = (t: string): string => {
        if (preserveSpaces) return t.replace(/^[\n]+|[\n]+$/g, "");
        if (hasBr)
          return t
            .split("\n")
            .map((s) => s.replace(/[ \t]+/g, " ").trim())
            .join("\n");
        return t.replace(/\s+/g, " ");
      };
      const collapsed = preserveSpaces
        ? buf.replace(/^[\n]+|[\n]+$/g, "")
        : hasBr
          ? buf
              .split("\n")
              .map((s) => s.replace(/[ \t]+/g, " ").trim())
              .join("\n")
          : buf.replace(/\s+/g, " ").trim();
      if (collapsed === "") return null;
      // Only return rich text when at least one chunk has overrides; the
      // common case (plain text) returns null richText so downstream code
      // doesn't have to special-case it.
      let richText: RichChunk[] | null = null;
      if (hasInlineStyle && chunks.length >= 1) {
        richText = chunks
          .map((c) => ({ ...c, text: collapseChunk(c.text) }))
          .filter((c) => c.text !== "");
        // Trim leading/trailing whitespace on the first/last chunk only.
        if (!preserveSpaces && richText.length > 0) {
          const first = richText[0]!;
          const last = richText[richText.length - 1]!;
          first.text = first.text.replace(/^\s+/, "");
          last.text = last.text.replace(/\s+$/, "");
          richText = richText.filter((c) => c.text !== "");
        }
      }
      return { text: collapsed, richText };
    };

    type N = {
      selector?: string;
      id: string;
      tag: string;
      role: string | null;
      text: string | null;
      richText?: RichChunk[];
      attributes: Record<string, string>;
      href?: string | null;
      src?: string | null;
      currentSrc?: string | null;
      naturalWidth?: number;
      naturalHeight?: number;
      cssWidth?: number;
      cssHeight?: number;
      rect: {
        x: number;
        y: number;
        top: number;
        left: number;
        width: number;
        height: number;
        right: number;
        bottom: number;
      };
      styles: Record<string, string>;
      children: N[];
    };

    const offsetSubtree = (n: N, dx: number, dy: number): void => {
      n.rect = {
        x: n.rect.x + dx,
        y: n.rect.y + dy,
        top: n.rect.top + dy,
        left: n.rect.left + dx,
        right: n.rect.right + dx,
        bottom: n.rect.bottom + dy,
        width: n.rect.width,
        height: n.rect.height,
      };
      for (const c of n.children) offsetSubtree(c, dx, dy);
    };

    const selectorFor = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current) {
        if (current.id) {
          parts.unshift(`#${CSS.escape(current.id)}`);
          break;
        }
        const tag = current.tagName.toLowerCase();
        let position = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) position++;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${tag}:nth-of-type(${position})`);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    const walk = (el: Element): N | null => {
      if (SKIP_TAGS.has(el.tagName)) return null;

      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      if (isTrackingPixel(el, rect)) return null;

      // Ancestor-clip check: some renderers hide reusable SVG symbols inside
      // a position:absolute, width:0, height:0, overflow:hidden
      // wrapper - the SVG itself returns its natural 120x40 from
      // getBoundingClientRect but is visually clipped to 0x0 by the parent.
      // Without this we extract the SVG and render it as a stray leaf.
      // Narrow rule: only drop when the clipping ancestor is itself 0×0 -
      // a normal overflow:hidden card with non-zero size legitimately
      // contains rendering children we want to keep.
      let clipAncestor = el.parentElement;
      while (clipAncestor) {
        const aStyles = window.getComputedStyle(clipAncestor);
        if (
          (aStyles.overflow === "hidden" || aStyles.overflow === "clip") &&
          clipAncestor.getBoundingClientRect().width === 0 &&
          clipAncestor.getBoundingClientRect().height === 0
        ) {
          return null;
        }
        clipAncestor = clipAncestor.parentElement;
      }

      // Inline SVG root: capture the markup as a data: URL so the rebuild
      // can render it via background-image. Don't walk into SVG children
      // (path/rect/etc. are not regular HTML elements and produce noise).
      // Skip nested <svg> inside <svg> - only the outermost SVG is captured.
      const tagLower = el.tagName.toLowerCase();
      const isSvgRoot =
        tagLower === "svg" &&
        !(el.parentElement && el.parentElement.tagName.toLowerCase() === "svg");

      const childNodes: N[] = [];
      if (!isSvgRoot) {
        for (const child of Array.from(el.children)) {
          // Inline-text children (span/b/strong/em/...) and true inline-flow
          // anchors are folded into the parent's richText by directText.
          // Walking them again here would emit them as separate absolutely-
          // positioned nodes floating over the parent's text - visible as
          // a duplicated/mispositioned word. Inline-block controls stay separate.
          if (INLINE_TEXT_TAGS.has(child.tagName)) continue;
          if (
            child.tagName === "A" &&
            child.children.length === 0 &&
            window.getComputedStyle(child).display === "inline"
          ) {
            continue;
          }
          const out = walk(child);
          if (out) childNodes.push(out);
        }
      }

      // Same-origin iframe (srcdoc or matching origin): recurse into its
      // body so embedded page content remains available. Inner rects are in
      // the iframe's own coordinate space, so we offset every rect in the
      // recovered subtree by the iframe's parent-space origin. Cross-
      // origin iframes are skipped (browser blocks contentDocument access).
      if (el.tagName === "IFRAME") {
        try {
          const iframe = el as HTMLIFrameElement;
          const innerDoc = iframe.contentDocument;
          if (innerDoc && innerDoc.body) {
            const offX = rect.x;
            const offY = rect.y;
            for (const child of Array.from(innerDoc.body.children)) {
              const out = walk(child);
              if (out) {
                offsetSubtree(out, offX, offY);
                childNodes.push(out);
              }
            }
          }
        } catch {
          // Cross-origin: nothing we can do.
        }
      }

      const dt = directText(el, computed);
      const text = dt?.text ?? null;
      const richText = dt?.richText ?? null;
      const visible = isVisible(el, computed, rect);

      // Img elements with a real src are NEVER dropped - even if currently
      // invisible (lazy-load not yet fired) or zero-sized. Sites often
      // lazy-mount media via IntersectionObserver, and the
      // scroll-walk in waitForStablePage may not always fire fast enough
      // to make every <img> visible. Better to keep the metadata than
      // silently lose the asset reference.
      const isImgWithSrc = el.tagName === "IMG" && !!(el as HTMLImageElement).src;

      // Drop nodes that are invisible AND have no visible descendants AND
      // contribute no visual effect of their own.
      if (!visible && childNodes.length === 0 && !hasVisualEffect(computed) && !isImgWithSrc) {
        return null;
      }

      // Drop pure layout wrappers with zero size and no visual effect.
      if (
        rect.width === 0 &&
        rect.height === 0 &&
        !hasVisualEffect(computed) &&
        childNodes.length === 0 &&
        !isImgWithSrc
      ) {
        return null;
      }

      const styles: Record<string, string> = {};
      for (const k of STYLE_KEYS) {
        styles[k] = computed[k as unknown as number] ?? computed.getPropertyValue(k as string);
      }

      // Inline SVG: serialize and stash as a data: URL background-image so
      // the rebuild renders the icon. The XMLSerializer path preserves
      // attribute namespaces (xmlns, xmlns:xlink) that outerHTML can drop
      // for SVG content embedded in HTML5 documents.
      //
      // A visible SVG may contain only `<use href="#id">` pointing at a
      // hidden source SVG (or symbol) elsewhere in the page.
      // Resolve those references inline so the data URL stands alone - without
      // the referenced content, the badge renders as a transparent rect.
      if (isSvgRoot) {
        try {
          // Pre-flight: resolve <use> references by replacing each with the
          // children of the target element.
          const clone = el.cloneNode(true) as Element;
          const useEls = Array.from(clone.querySelectorAll("use"));
          for (const useEl of useEls) {
            const href = useEl.getAttribute("href") ?? useEl.getAttribute("xlink:href");
            if (!href || !href.startsWith("#")) continue;
            const target = document.getElementById(href.slice(1));
            if (!target) continue;
            // Inline target's children (its viewBox / width are already on
            // our wrapper SVG). For target=<svg>, copy children only.
            // For target=<symbol> or <g>, also copy children.
            const parent = useEl.parentNode;
            if (!parent) continue;
            for (const child of Array.from(target.children)) {
              parent.insertBefore(child.cloneNode(true), useEl);
            }
            parent.removeChild(useEl);
          }
          const serialized = new XMLSerializer().serializeToString(clone);
          // Most browsers omit xmlns when serializing in-document SVG;
          // re-inject if missing so the data URL is a standalone document.
          const ensured = /\sxmlns\s*=/.test(serialized)
            ? serialized
            : serialized.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
          // Also encode `(` and `)` so nested url(...) inside the SVG
          // (e.g., clip-path="url(#id)") doesn't break the outer
          // backgroundImage url() parser. encodeURIComponent leaves
          // parentheses unencoded by default.
          const dataPayload = encodeURIComponent(ensured)
            .replace(/\(/g, "%28")
            .replace(/\)/g, "%29");
          styles.backgroundImage = `url("data:image/svg+xml;utf8,${dataPayload}")`;
          if (!styles.backgroundColor || styles.backgroundColor === "rgba(0, 0, 0, 0)")
            styles.backgroundColor = "transparent";
        } catch (err) {
          // Surface the failure to Node-side via a window-attached log so
          // we can diagnose extractor bugs. Doesn't break extraction.
          (window as any).__svgExtractErrors = (window as any).__svgExtractErrors || [];
          (window as any).__svgExtractErrors.push(String(err));
        }
      }

      const out: N = {
        id: makeId(),
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        text,
        ...(richText ? { richText } : {}),
        attributes: collectAttrs(el),
        rect: {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
          right: rect.right + window.scrollX,
          bottom: rect.bottom + window.scrollY,
        },
        styles,
        children: childNodes,
      };

      if (el.tagName === "A") out.href = (el as HTMLAnchorElement).href || null;
      if (el.tagName === "IMG") {
        const img = el as HTMLImageElement;
        out.src = img.src || null;
        out.currentSrc = img.currentSrc || null;
        // Natural dimensions are useful when the rect is zero (lazy-load
        // didn't fire) - the renderer falls back to these so the image
        // gets emitted at a reasonable size.
        if (img.naturalWidth > 0) out.naturalWidth = img.naturalWidth;
        if (img.naturalHeight > 0) out.naturalHeight = img.naturalHeight;
        // CSS layout size (pre-transform). For an `<img>` inside a rotated
        // wrapper, getBoundingClientRect returns the post-rotation visual
        // bounding box (e.g. 340x580 for a 293x556 image rotated 5°),
        // while offsetWidth/offsetHeight return the actual CSS box
        // (293x556). Without this, we treat the visual bbox as the CSS
        // size and trigger a false object-fit:cover scaling that doesn't
        // happen in source.
        if (img.offsetWidth > 0) out.cssWidth = img.offsetWidth;
        if (img.offsetHeight > 0) out.cssHeight = img.offsetHeight;
      }
      if (el.tagName === "VIDEO") {
        out.src = (el as HTMLVideoElement).src || null;
        out.currentSrc = (el as HTMLVideoElement).currentSrc || null;
      }
      if (el.tagName === "SOURCE") {
        out.src = (el as HTMLSourceElement).src || null;
      }

      return out;
    };

    const root = walk(document.body);
    return root;
  });

  if (!result) {
    throw new Error("extractDom: page body produced no extractable tree");
  }
  // The browser-side walker emits the same shape as ExtractedNode but uses a
  // Record<string,string> for styles (the structural ExtractedStyles literal
  // can't cross the page.evaluate boundary directly). The runtime values
  // include every required key from STYLE_KEYS.
  return result as unknown as ExtractedNode;
}
