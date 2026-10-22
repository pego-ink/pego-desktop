import CanvasKitInit, {
  type CanvasKit,
  type FontMgr,
  type TypefaceFontProvider,
} from "canvaskit-wasm";
import { useFontStore } from "@/canvas/fonts";
import { setTextMeasurer } from "@/canvas/layout";
import { loadIconData } from "@/canvas/icons";
import { createTextMeasurer } from "@/canvas/measure-text";
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";

// Inter (OFL 1.1), variable TTF from https://github.com/google/fonts/tree/main/ofl/inter
// Served from apps/web/public/fonts. CanvasKit only accepts TTF/OTF, not woff2.
const INTER_URL = "/fonts/Inter.ttf";

export type CanvasKitResources = {
  ck: CanvasKit;
  /** Bundled Inter only: editor chrome drawn on the canvas (labels, badges). */
  fontMgr: FontMgr;
  /** Document text: Inter plus every family fetched by `requestDocumentFonts`. */
  fonts: TypefaceFontProvider;
  fontFamily: string;
};

export const FONT_FAMILY = "Inter";

const load = async (): Promise<CanvasKitResources> => {
  const [ck, fontData] = await Promise.all([
    CanvasKitInit({ locateFile: () => wasmUrl }),
    fetch(INTER_URL).then((res) => res.arrayBuffer()),
  ]);
  const fontMgr = ck.FontMgr.FromData(fontData);
  if (!fontMgr) throw new Error("failed to load font data");
  const fonts = ck.TypefaceFontProvider.Make();
  fonts.registerFont(fontData, FONT_FAMILY);
  const res = { ck, fontMgr, fonts, fontFamily: FONT_FAMILY };
  await loadIconData();
  setTextMeasurer(createTextMeasurer(res));
  // New fonts change text metrics: measure (and lay out) again.
  useFontStore.subscribe(() => setTextMeasurer(createTextMeasurer(res)));
  return res;
};

let cached: Promise<CanvasKitResources> | null = null;

/** Loads CanvasKit + the bundled font once per page load. */
export const loadCanvasKit = (): Promise<CanvasKitResources> => {
  cached ??= load().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
};
