import type { FontFaceSpec, FontFamilyInfo } from "./types";

/**
 * Google Fonts catalog + loading, shared by the font picker, the renderer and the text editor.
 * (Stub: implemented by the font-service work.)
 */

/** Full catalog (lazy, cached). Includes the bundled "Inter". */
export const loadFontCatalog = async (): Promise<FontFamilyInfo[]> => [];

/** Catalog entry for a family once the catalog has loaded; undefined when unknown. */
export const findFontFamily = (family: string): FontFamilyInfo | undefined => {
  void family;
  return undefined;
};

/**
 * Make a face usable everywhere: registered with CanvasKit for drawing/measuring (then
 * `useFontEvents().fontsChanged()` is called) and available to the DOM for the text editor.
 * Resolves false when the face cannot be loaded (the renderer falls back to Inter).
 */
export const ensureFontFace = async (face: FontFaceSpec): Promise<boolean> => {
  void face;
  return false;
};

/** Load a lightweight DOM-only preview of a family (for picker rows). Idempotent. */
export const ensureFontPreview = (family: string): void => {
  void family;
};
