import type { Viewport } from "../agent/thresholds.js";
import type { ExtractedNode } from "../extract/types.js";

export type Target =
  | { readonly selector: string }
  | {
      readonly role: "button" | "link" | "textbox" | "checkbox" | "tab" | "menuitem";
      readonly name: string;
    };
export type InteractionStep =
  | { readonly action: "click" | "hover"; readonly target: Target }
  | { readonly action: "fill" | "press"; readonly target: Target; readonly value: string }
  | { readonly action: "visible" | "hidden"; readonly target: Target }
  | { readonly action: "text"; readonly target: Target; readonly value: string }
  | { readonly action: "url"; readonly path: string };

/** Explicit, caller-authorized interaction; executed on source before becoming a baseline. */
export type Scenario = {
  readonly name: string;
  readonly path: string;
  readonly viewports?: readonly Viewport["name"][];
  readonly steps: readonly InteractionStep[];
};

export type Control = {
  readonly nodeId: string;
  readonly tag: string;
  readonly label: string;
  readonly href: string | null;
  readonly rect: ExtractedNode["rect"];
};

export type ReferenceScene = {
  readonly id: string;
  readonly url: string;
  readonly route: string;
  readonly scenario?: Scenario;
  readonly captures: readonly {
    readonly viewport: Viewport;
    readonly screenshot: string;
    readonly extraction: string;
    readonly sha256: { readonly screenshot: string; readonly extraction: string };
    readonly controls: readonly Control[];
  }[];
};

export type ReferenceManifest = {
  readonly schemaVersion: 1;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly deviceScaleFactor: 1;
  readonly maxPages: number;
  readonly scenes: readonly ReferenceScene[];
  readonly omittedUrls: readonly string[];
};
