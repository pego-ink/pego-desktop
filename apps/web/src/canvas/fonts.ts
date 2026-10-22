import type { TypefaceFontProvider } from "canvaskit-wasm";
import { create } from "zustand";
import {
  resolveNumber,
  resolveString,
  walkRendered,
  type PegoDocument,
  type Variables,
} from "@pego/doc";

/**
 * Fonts for document text beyond the bundled Inter. Families used in the document are fetched as
 * TTF (CanvasKit cannot read woff2) from Fontsource on jsDelivr, which mirrors Google Fonts and
 * a few others (Geist). Unknown families and offline use fall back to Inter.
 */

const API = "https://api.fontsource.org/v1/fonts";
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const SUBSET = "latin";

/** Fontsource id of a family name: "Geist Mono" -> "geist-mono". */
export const fontsourceId = (family: string): string =>
  family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The available weight closest to `weight` (ties go to the heavier one, like CSS). */
export const nearestWeight = (weight: number, available: readonly number[]): number =>
  available.reduce((best, w) =>
    Math.abs(w - weight) < Math.abs(best - weight) ||
    (Math.abs(w - weight) === Math.abs(best - weight) && w > best)
      ? w
      : best,
  );

export const fontFileUrl = (family: string, weight: number): string =>
  `${CDN}/${fontsourceId(family)}@latest/${SUBSET}-${weight}-normal.ttf`;

/** Every (family, weight) pair used by text in the document, instances included. */
export const usedFonts = (doc: PegoDocument, fallback: string): Map<string, Set<number>> => {
  const used = new Map<string, Set<number>>();
  const variables: Variables = doc.variables;
  walkRendered(doc, doc.children, (node) => {
    if (node.type !== "text") return;
    const family =
      node.fontFamily === undefined ? fallback : resolveString(node.fontFamily, variables);
    const weight = resolveNumber(node.fontWeight, variables, 400);
    const weights = used.get(family) ?? new Set<number>();
    weights.add(weight);
    used.set(family, weights);
  });
  return used;
};

/** Bumped whenever a font finishes loading: text must be measured and drawn again. */
export const useFontStore = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
}));

type FamilyInfo = { weights: number[] } | null;

const families = new Map<string, Promise<FamilyInfo>>();
/** `${family}@${weight}` of files requested (loaded, loading or failed). */
const requested = new Set<string>();

const familyInfo = (family: string): Promise<FamilyInfo> => {
  let info = families.get(family);
  if (!info) {
    info = fetch(`${API}/${fontsourceId(family)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { weights?: unknown; styles?: unknown };
        const weights = Array.isArray(json.weights)
          ? json.weights.filter((w): w is number => typeof w === "number")
          : [];
        return weights.length > 0 ? { weights } : null;
      })
      .catch(() => null);
    families.set(family, info);
  }
  return info;
};

const cssFaces = new Set<string>();

/** Same file as a CSS font, so the DOM text editor overlay matches the canvas. */
const registerCssFont = (family: string, weight: number, data: ArrayBuffer) => {
  const key = `${family}@${weight}`;
  if (typeof FontFace === "undefined" || typeof document === "undefined" || cssFaces.has(key)) {
    return;
  }
  cssFaces.add(key);
  const face = new FontFace(family, data, { weight: String(weight) });
  void face.load().then(
    (loaded) => document.fonts.add(loaded),
    () => cssFaces.delete(key),
  );
};

const loadFile = async (provider: TypefaceFontProvider, family: string, weight: number) => {
  const info = await familyInfo(family);
  if (!info) return false;
  const fileWeight = nearestWeight(weight, info.weights);
  const key = `${family}@${fileWeight}`;
  if (requested.has(key)) return false;
  requested.add(key);
  try {
    const res = await fetch(fontFileUrl(family, fileWeight));
    if (!res.ok) return false;
    const data = await res.arrayBuffer();
    provider.registerFont(data, family);
    registerCssFont(family, fileWeight, data);
    return true;
  } catch {
    return false;
  }
};

/**
 * Fetch the fonts the document uses that are not loaded yet, register them with CanvasKit and
 * bump `useFontStore` once something new arrived. Safe to call on every document change: each
 * family/weight is fetched at most once per page load.
 */
export const requestDocumentFonts = async (
  provider: TypefaceFontProvider,
  doc: PegoDocument,
  bundled: string,
): Promise<void> => {
  const pending: Promise<boolean>[] = [];
  for (const [family, weights] of usedFonts(doc, bundled)) {
    if (family === bundled || family === "") continue;
    for (const weight of weights) {
      if (requested.has(`${family}@${weight}`)) continue;
      pending.push(loadFile(provider, family, weight));
    }
  }
  if (pending.length === 0) return;
  const loaded = await Promise.all(pending);
  if (loaded.some(Boolean)) useFontStore.getState().bump();
};
