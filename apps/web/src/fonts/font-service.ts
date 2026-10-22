import { loadCanvasKit, type CanvasKitResources } from "@/canvas/load-canvaskit";
import {
  buildCatalog,
  buildFontFileUrl,
  buildPreviewCssUrl,
  resolveFile,
  type Catalog,
  type CatalogEntry,
  type RawCatalog,
} from "./catalog";
import { useFontEvents } from "./font-events";
import { setVariableFamilyLookup } from "./variations";
import type { FontFaceSpec, FontFamilyInfo } from "./types";

/**
 * Google Fonts catalog + loading, shared by the font picker, the renderer and the text editor.
 *
 * Font source decision: CanvasKit (0.42.0) does parse the WOFF2 that fonts.googleapis.com sends to
 * browsers, but that CSS is sharded by unicode-range (up to ~100 files per face) and Skia matches
 * one typeface per family+style, so shards cannot be merged. We therefore fetch the full TTF of
 * each face from the google/fonts repo through jsDelivr (pinned to the commit recorded in
 * google-fonts.json), one file per face (static) or per style (variable). Variable files keep
 * their default instance in CanvasKit: draw them with `fontVariationsFor(face)` for the true weight.
 * Only fonts.googleapis.com / fonts.gstatic.com (picker previews) and cdn.jsdelivr.net are contacted.
 */

const MAX_FONT_BYTES = 40 * 1024 * 1024;
const PREVIEW_BATCH_DELAY_MS = 50;
const PREVIEW_BATCH_SIZE = 24;
/** The bundled Inter upright face is registered by load-canvaskit.ts. */
const BUNDLED_FACE_FAMILY = "Inter";

let catalogPromise: Promise<Catalog> | null = null;
let catalog: Catalog | null = null;

const importCatalog = async (): Promise<Catalog> => {
  const raw = (await import("./google-fonts.json")).default as unknown as RawCatalog;
  const built = buildCatalog(raw);
  catalog = built;
  setVariableFamilyLookup((family) => built.entries.get(family)?.variable === true);
  return built;
};

/** Full catalog (lazy, cached). Includes the bundled "Inter". */
export const loadFontCatalog = async (): Promise<FontFamilyInfo[]> => {
  catalogPromise ??= importCatalog().catch((error: unknown) => {
    catalogPromise = null;
    throw error;
  });
  const loaded = await catalogPromise;
  return [...loaded.entries.values()].map((entry) => entry.info);
};

const entryOf = (family: string): CatalogEntry | undefined => catalog?.entries.get(family);

/** Catalog entry for a family once the catalog has loaded; undefined when unknown. */
export const findFontFamily = (family: string): FontFamilyInfo | undefined => entryOf(family)?.info;

/**
 * CanvasKit `TextStyle.fontVariations` that select the weight of a variable family (undefined for
 * static families, where `fontStyle` picks the registered face). Needs the catalog loaded.
 */
export const fontVariationsFor = (
  face: FontFaceSpec,
): { axis: string; value: number }[] | undefined =>
  entryOf(face.family)?.variable ? [{ axis: "wght", value: face.weight }] : undefined;

const fontBytes = new Map<string, ArrayBuffer>();
const inflight = new Map<string, Promise<boolean>>();
const done = new Set<string>();
/** Families whose upright face is already in the DOM, so a tiny preview must not shadow it. */
const domUprightFamilies = new Set<string>([BUNDLED_FACE_FAMILY]);

const looksLikeSfnt = (bytes: ArrayBuffer): boolean => {
  if (bytes.byteLength < 12) return false;
  const tag = new TextDecoder("latin1").decode(bytes.slice(0, 4));
  return tag === "\u0000\u0001\u0000\u0000" || tag === "OTTO" || tag === "true" || tag === "ttcf";
};

const fetchFontBytes = async (url: string): Promise<ArrayBuffer | null> => {
  const cached = fontBytes.get(url);
  if (cached) return cached;
  const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) return null;
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FONT_BYTES) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_FONT_BYTES || !looksLikeSfnt(bytes)) return null;
  fontBytes.set(url, bytes);
  return bytes;
};

const weightRange = (info: FontFamilyInfo, italic: boolean): string => {
  const weights =
    italic && info.weights.italic.length > 0 ? info.weights.italic : info.weights.normal;
  return `${weights[0] ?? 400} ${weights[weights.length - 1] ?? 400}`;
};

const addToDom = async (
  entry: CatalogEntry,
  file: { weight: number; italic: boolean; variable: boolean },
  bytes: ArrayBuffer,
): Promise<void> => {
  const family = entry.info.family;
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const face = new FontFace(family, bytes.slice(0), {
    weight: file.variable ? weightRange(entry.info, file.italic) : String(file.weight),
    style: file.italic ? "italic" : "normal",
  });
  document.fonts.add(await face.load());
  if (!file.italic) domUprightFamilies.add(family);
};

const registerFace = async (
  res: CanvasKitResources,
  catalogValue: Catalog,
  entry: CatalogEntry,
  face: FontFaceSpec,
): Promise<boolean> => {
  const file = resolveFile(entry, face);
  if (!file) return false;
  const url = buildFontFileUrl(catalogValue, entry, file.file);
  if (done.has(url)) return true;
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = (async () => {
    try {
      const bytes = await fetchFontBytes(url);
      if (!bytes) return false;
      res.fontProvider.registerFont(bytes, entry.info.family);
      done.add(url);
      await addToDom(entry, file, bytes).catch(() => undefined);
      useFontEvents.getState().fontsChanged();
      return true;
    } catch {
      return false;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, task);
  return task;
};

/**
 * Make a face usable everywhere: registered with CanvasKit for drawing/measuring (then
 * `useFontEvents().fontsChanged()` is called) and available to the DOM for the text editor.
 * Resolves false when the face cannot be loaded (the renderer falls back to Inter).
 */
export const ensureFontFace = async (face: FontFaceSpec): Promise<boolean> => {
  try {
    await loadFontCatalog();
    const entry = entryOf(face.family);
    if (!catalog || !entry) return false;
    if (face.family === BUNDLED_FACE_FAMILY && face.style === "normal") return true;
    return await registerFace(await loadCanvasKit(), catalog, entry, face);
  } catch {
    return false;
  }
};

const previewRequested = new Set<string>();
let previewQueue: string[] = [];
let previewTimer: ReturnType<typeof setTimeout> | null = null;

const flushPreviews = () => {
  previewTimer = null;
  const families = previewQueue.filter((family) => !domUprightFamilies.has(family));
  previewQueue = [];
  for (let start = 0; start < families.length; start += PREVIEW_BATCH_SIZE) {
    const chunk = families.slice(start, start + PREVIEW_BATCH_SIZE);
    const text = [...new Set(chunk.join(""))].join("");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = buildPreviewCssUrl(chunk, text);
    link.referrerPolicy = "no-referrer";
    document.head.appendChild(link);
  }
};

/**
 * Load a lightweight DOM-only preview of a family (for picker rows). Idempotent and batched: rows
 * requested within a few ms share one CSS2 request limited to the glyphs of the family names.
 */
export const ensureFontPreview = (family: string): void => {
  if (typeof document === "undefined" || previewRequested.has(family)) return;
  void loadFontCatalog()
    .then(() => {
      if (!entryOf(family) || previewRequested.has(family)) return;
      previewRequested.add(family);
      previewQueue.push(family);
      previewTimer ??= setTimeout(flushPreviews, PREVIEW_BATCH_DELAY_MS);
    })
    .catch(() => undefined);
};
