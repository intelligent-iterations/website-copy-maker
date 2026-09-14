/**
 * Compact, semantic version of an ExtractedNode optimised for code generation.
 */

export type DesignNodeType =
  | "page"
  | "section"
  | "container"
  | "stack"
  | "grid"
  | "text"
  | "image"
  | "button"
  | "link"
  | "card"
  | "icon"
  | "video"
  | "shape"
  | "decorative"
  | "unknown";

export type DesignRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type DesignStyle = {
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly backgroundImage?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string | number;
  readonly lineHeight?: string | number;
  readonly letterSpacing?: string;
  readonly borderRadius?: string;
  readonly boxShadow?: string;
  readonly border?: string;
  readonly opacity?: number;
  readonly transform?: string;
  /** Numeric z-index from source CSS. Absent when "auto". The fidelity
   * renderer propagates this from each leaf's nearest stacking-context
   * ancestor so flat-emitted siblings stack like the source did. */
  readonly zIndex?: number;
  /** `object-fit` on <img>/<video>. Critical when the display aspect
   * ratio differs from the natural aspect ratio: without it the browser
   * defaults to `fill` which stretches the image visibly. */
  readonly objectFit?: string;
  readonly objectPosition?: string;
  /** `text-align` on text-bearing elements. The browser default is `start`
   * (left in LTR locales) - when source uses `center` we must emit it
   * explicitly or the rebuild's text wraps and starts at different
   * positions than the source's. */
  readonly textAlign?: string;
  /** `white-space` on text. Browser default is `normal` (collapses
   * newlines). Source elements with `<br>` use `pre-wrap` / `pre-line`
   * to render hard breaks; we must preserve that or two-line text
   * collapses to one line in the rebuild. */
  readonly whiteSpace?: string;
};

export type DesignLayout = {
  readonly mode?: "absolute" | "flex" | "grid" | "normal";
  readonly direction?: "row" | "column";
  readonly gap?: number;
  readonly align?: string;
  readonly justify?: string;
  readonly padding?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
};

export type DesignMetadata = {
  readonly isLikelyHeading: boolean;
  readonly isLikelyParagraph: boolean;
  readonly isLikelyButton: boolean;
  readonly isLikelyCard: boolean;
  readonly isLikelyNav: boolean;
  readonly isLikelyDecorative: boolean;
  readonly visualImportance: number;
};

export type DesignNode = {
  readonly id: string;
  readonly type: DesignNodeType;
  readonly name: string;
  readonly text?: string;
  /** Inline-styled chunks for text runs containing styled `<span>`s
   * (e.g. red highlighted "demo" inside a paragraph). The renderer emits
   * these as inline `<span>` children so per-chunk styling is preserved. */
  readonly richText?: ReadonlyArray<{
    readonly text: string;
    readonly color?: string;
    readonly fontWeight?: string;
    readonly fontStyle?: string;
    readonly href?: string;
  }>;
  readonly href?: string;
  readonly src?: string;
  /** Image natural pixel size - useful as a fallback when rect.width/height
   * are zero because lazy-load did not fire before extraction. */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  /** CSS layout box for `<img>` (offsetWidth/Height) - pre-transform.
   * Used to detect when the image renders at its natural CSS size so
   * object-fit:cover heuristics don't false-positive on the post-transform
   * visual bbox. */
  readonly cssWidth?: number;
  readonly cssHeight?: number;
  readonly rect: DesignRect;
  readonly style: DesignStyle;
  readonly layout: DesignLayout;
  readonly metadata: DesignMetadata;
  readonly children: readonly DesignNode[];
};
