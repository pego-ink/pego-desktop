import { isContainer, type PegoDocument, type PegoNode } from "@pego/doc";
import type { FontCategory, FontFamilyInfo, FontStyle } from "@/fonts/types";

export const DEFAULT_FAMILY = "Inter";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** "Bold 700"; unnamed weights fall back to the number. */
export const weightLabel = (weight: number): string => {
  const name = WEIGHT_NAMES[weight];
  return name ? `${name} ${weight}` : String(weight);
};

export const weightsFor = (info: FontFamilyInfo, style: FontStyle): number[] => info.weights[style];

/** Weights the family offers in any style, ascending. */
export const allWeights = (info: FontFamilyInfo): number[] =>
  [...new Set([...info.weights.normal, ...info.weights.italic])].toSorted((a, b) => a - b);

/** The available weight closest to `target` (ties go to the lighter one); `target` when none. */
export const nearestWeight = (weights: readonly number[], target: number): number => {
  let best: number | undefined;
  for (const weight of weights) {
    if (best === undefined || Math.abs(weight - target) < Math.abs(best - target)) best = weight;
  }
  return best ?? target;
};

export const hasItalicAt = (info: FontFamilyInfo, weight: number): boolean =>
  info.weights.italic.includes(weight);

/**
 * Face to use after switching to `info`: keeps the weight when present, else the nearest one,
 * and drops italic when the result has no italic face.
 */
export const resolveFace = (
  info: FontFamilyInfo,
  weight: number,
  style: FontStyle,
): { weight: number; style: FontStyle } => {
  const wantsItalic = style === "italic" && info.weights.italic.length > 0;
  const pool = wantsItalic ? info.weights.italic : info.weights.normal;
  const resolved = pool.length > 0 ? nearestWeight(pool, weight) : weight;
  return { weight: resolved, style: wantsItalic ? "italic" : "normal" };
};

export type FontFilter = FontCategory | "all";

export const CATEGORY_CHIPS: readonly { value: FontFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sans-serif", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Handwriting" },
  { value: "monospace", label: "Mono" },
];

const matchScore = (family: string, query: string): number => {
  const name = family.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[\s-]+/).some((word) => word.startsWith(query))) return 2;
  return name.includes(query) ? 3 : -1;
};

/** Filter by category and rank by search match (exact, prefix, word start, substring), then popularity. */
export const searchFamilies = (
  catalog: readonly FontFamilyInfo[],
  query: string,
  category: FontFilter,
): FontFamilyInfo[] => {
  const needle = query.trim().toLowerCase();
  const pool = category === "all" ? catalog : catalog.filter((f) => f.category === category);
  if (!needle) return pool.toSorted((a, b) => a.popularity - b.popularity);
  return pool
    .map((info) => ({ info, score: matchScore(info.family, needle) }))
    .filter((entry) => entry.score >= 0)
    .toSorted((a, b) => a.score - b.score || a.info.popularity - b.info.popularity)
    .map((entry) => entry.info);
};

/** Distinct font families used by text nodes, in document order. */
export const documentFamilies = (doc: PegoDocument): string[] => {
  const seen = new Set<string>();
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      if (node.type === "text" && node.fontFamily && !node.fontFamily.startsWith("$")) {
        seen.add(node.fontFamily);
      }
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  return [...seen];
};

export const MAX_RECENT = 8;

/** Move `family` to the front, dedupe, cap. */
export const pushRecent = (recent: readonly string[], family: string, max = MAX_RECENT): string[] =>
  [family, ...recent.filter((entry) => entry !== family)].slice(0, max);

const RECENT_KEY = "pego:recent-fonts";

export const loadRecent = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
};

export const saveRecent = (recent: readonly string[]) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable: recents are a convenience only
  }
};

export type PickerRow =
  { kind: "header"; key: string; label: string } | { kind: "font"; key: string; family: string };

export type PickerGroups = {
  documentFamilies: readonly string[];
  recent: readonly string[];
  catalog: readonly string[];
};

/**
 * Flat row list: "In this document" and "Recent" groups (only when browsing without a query,
 * filtered to the category), then the catalog. A family is listed once per group.
 */
export const buildRows = (groups: PickerGroups, showGroups: boolean): PickerRow[] => {
  const rows: PickerRow[] = [];
  const addGroup = (id: string, label: string, families: readonly string[]) => {
    if (families.length === 0) return;
    rows.push({ kind: "header", key: `h:${id}`, label });
    for (const family of families) rows.push({ kind: "font", key: `${id}:${family}`, family });
  };
  if (showGroups) {
    addGroup("doc", "In this document", groups.documentFamilies);
    addGroup("recent", "Recent", groups.recent);
  }
  addGroup("all", showGroups ? "All fonts" : "Results", groups.catalog);
  return rows;
};

/** Index range [start, end) of rows to render for a scroll position, with overscan. */
export const visibleRange = (
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 6,
): { start: number; end: number } => {
  const first = Math.floor(scrollTop / rowHeight);
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, Math.max(0, last) + overscan),
  };
};

/** Next focusable (font) row index moving by `delta`, skipping headers; stays put at the ends. */
export const stepActive = (rows: readonly PickerRow[], from: number, delta: 1 | -1): number => {
  for (let i = from + delta; i >= 0 && i < rows.length; i += delta) {
    if (rows[i]?.kind === "font") return i;
  }
  return from;
};

export const firstFontIndex = (rows: readonly PickerRow[]): number =>
  Math.max(
    0,
    rows.findIndex((row) => row.kind === "font"),
  );
