/**
 * Contracts for the in-app browser (desktop only): what the editor's browser host offers tools,
 * and the JSON snapshot of a page that `import-to-canvas` turns into Pego nodes.
 */

/** Which part of the loaded page an action works on. */
export type BrowserTarget =
  | { kind: "full-page" }
  /** The element the user picked with the panel's element picker. */
  | { kind: "selection" }
  | { kind: "query"; selector: string };

/** Navigation state of the browser view, as shown in the panel's URL bar. */
export type BrowserPageInfo = { url: string; title: string };

/** A rectangle in page coordinates (CSS px, document origin, not the viewport). */
export type DomBox = { x: number; y: number; width: number; height: number };

/**
 * Computed styles the converter reads, already resolved by the page (`getComputedStyle`).
 * Colors are CSS color strings as the browser serializes them (`rgb(...)` / `rgba(...)` /
 * `color(srgb ...)`); lengths are numbers in px. Absent means the CSS initial value.
 */
export type DomStyle = {
  display?: string;
  position?: string;
  flexDirection?: string;
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  /** Row/column gap in px. */
  gap?: number;
  /** [top, right, bottom, left] in px. */
  padding?: [number, number, number, number];
  backgroundColor?: string;
  /** Raw `background-image` (e.g. `linear-gradient(...)`, `url("...")`), "none" omitted. */
  backgroundImage?: string;
  /** [top, right, bottom, left] widths in px. */
  borderWidth?: [number, number, number, number];
  /** Color of the first visible border side. */
  borderColor?: string;
  /** Uniform radius in px (the top-left value when they differ). */
  borderRadius?: number;
  opacity?: number;
  /** Raw `box-shadow`, "none" omitted. */
  boxShadow?: string;
  overflowHidden?: boolean;
  /** Text styles, set on text nodes (inherited values of their parent element). */
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Line height in px (converted to a multiple of fontSize by the converter). */
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: string;
  textTransform?: string;
  /** `object-fit` of replaced elements (images), "fill" omitted. */
  objectFit?: string;
};

/** One node of a page snapshot. Invisible elements (display:none, zero size, hidden) are skipped. */
export type DomSnapshotNode =
  | {
      kind: "element";
      /** Lowercase tag name, e.g. "div". */
      tag: string;
      /** Code component name when the page exposes one (React dev builds), e.g. "Card". */
      component?: string;
      box: DomBox;
      style: DomStyle;
      children: DomSnapshotNode[];
    }
  | {
      /** A run of text; `box` covers all its line boxes. */
      kind: "text";
      text: string;
      box: DomBox;
      style: DomStyle;
    }
  | {
      kind: "image";
      tag: string;
      /** data: URL (inlined by the page script when small enough) or an https URL. */
      src: string;
      alt?: string;
      box: DomBox;
      style: DomStyle;
    }
  | {
      kind: "svg";
      /** The element's outerHTML with computed fill/stroke inlined. */
      markup: string;
      box: DomBox;
      style: DomStyle;
    };

export type DomSnapshot = {
  url: string;
  title: string;
  /** The target element (for "full-page": `document.body`, boxed to the full document). */
  root: DomSnapshotNode;
};

/**
 * The editor's in-app browser, as tools see it (`ToolHost.browser`). Present only in the
 * desktop app; every method rejects with a user-readable Error (e.g. no page loaded, selector
 * matched nothing, no element picked).
 */
export type BrowserHost = {
  /** Open the browser panel if needed, load `url` (http, https or file) and wait for the load. */
  loadPage: (url: string) => Promise<BrowserPageInfo>;
  /** The page currently loaded, or null when nothing was loaded yet. */
  currentPage: () => BrowserPageInfo | null;
  /**
   * Screenshot the target at 1x. `maxSide` caps the longer side in px (the image is scaled
   * down, never cropped); `format` defaults to png.
   */
  screenshot: (
    target: BrowserTarget,
    options?: { maxSide?: number; format?: "png" | "webp" },
  ) => Promise<{ dataUrl: string; width: number; height: number }>;
  /** Walk the target's DOM into a snapshot for `import-to-canvas`. */
  snapshot: (target: BrowserTarget) => Promise<DomSnapshot>;
  /** The target's outerHTML plus its non-default computed styles, as readable text. */
  describeElement: (target: BrowserTarget) => Promise<string>;
  /**
   * Send one Chrome DevTools Protocol command to the page. Only the DOM, Input, Page, Runtime,
   * Emulation, CSS and Accessibility domains are allowed; others reject.
   */
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};
