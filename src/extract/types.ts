/**
 * Shared types for the extraction stage. Kept in their own module so the
 * heavy page.evaluate script (which has to be self-contained because it runs
 * in the browser) and the Node-side composers don't import each other in a
 * cycle.
 */

export type ExtractedRect = {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
};

export type ExtractedStyles = {
  readonly display: string;
  readonly position: string;
  readonly zIndex: string;
  readonly overflow: string;
  readonly opacity: string;
  readonly visibility: string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly textAlign: string;
  readonly textTransform: string;
  readonly margin: string;
  readonly padding: string;
  readonly gap: string;
  readonly border: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
  readonly transform: string;
  readonly flexDirection: string;
  readonly alignItems: string;
  readonly justifyContent: string;
  readonly gridTemplateColumns: string;
  readonly gridTemplateRows: string;
};

export type ExtractedNode = {
  readonly id: string;
  /** Capture-time CSS path for DOM inspection; never assumed stable across revisions. */
  readonly selector?: string;
  readonly tag: string;
  readonly role: string | null;
  readonly text: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly href?: string | null;
  readonly src?: string | null;
  readonly currentSrc?: string | null;
  /** Inline-styled chunks within a text-bearing element (e.g.
   * `<h2>That's why we made the <span style="color:red">demo</span>
   * app.</h2>`). When a text run has spans with overrides, we capture
   * each chunk plus the parent-relative style overrides. The renderer
   * emits this as inline `<span>` children to preserve inline styling. */
  readonly richText?: ReadonlyArray<{
    readonly text: string;
    readonly color?: string;
    readonly fontWeight?: string;
    readonly fontStyle?: string;
    readonly href?: string;
  }>;
  /** HTMLImageElement.naturalWidth at extraction time - used as a fallback
   * when getBoundingClientRect returned zero (lazy-load not fired). */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  /** offsetWidth/offsetHeight on `<img>`. CSS layout box, NOT the
   * post-transform visual bbox that getBoundingClientRect returns. The
   * renderer uses these to detect "image is at natural CSS size" and
   * skip a false object-fit:cover scaling that doesn't happen in source. */
  readonly cssWidth?: number;
  readonly cssHeight?: number;
  readonly rect: ExtractedRect;
  readonly styles: ExtractedStyles;
  readonly children: readonly ExtractedNode[];
};

export type ExtractedPage = {
  readonly url: string;
  readonly viewport: { readonly width: number; readonly height: number; readonly name: string };
  readonly capturedAt: string;
  readonly title: string | null;
  readonly metadata: ExtractedMetadata;
  readonly fonts: readonly string[];
  readonly fontFaces: readonly ExtractedFontFace[];
  readonly assets: readonly ExtractedAsset[];
  readonly root: ExtractedNode;
};

export type ExtractedFontSource = {
  readonly url: string;
  readonly format?: string;
};

/** A materializable @font-face rule observed in the source page's stylesheets. */
export type ExtractedFontFace = {
  readonly family: string;
  readonly style: string;
  readonly weight: string;
  readonly stretch: string;
  readonly display: string;
  readonly unicodeRange?: string;
  readonly sources: readonly ExtractedFontSource[];
};

export type ExtractedMetadata = {
  readonly title: string | null;
  readonly description: string | null;
  readonly ogImage: string | null;
  readonly ogTitle: string | null;
  readonly favicon: string | null;
  readonly themeColor: string | null;
};

export type ExtractedAsset = {
  readonly url: string;
  readonly source:
    | "img-src"
    | "img-currentSrc"
    | "picture-source"
    | "background-image"
    | "font"
    | "video-poster"
    | "favicon";
  readonly nodeId?: string;
};
