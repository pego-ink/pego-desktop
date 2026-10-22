import type { FontCategory, FontFaceSpec, FontFamilyInfo } from "./types";

/**
 * Compact catalog format of `google-fonts.json` (written by scripts/build-font-catalog.ts):
 * `[family, categoryIndex, popularity, normalWeights, italicWeights, dir, variable, faces]` where
 * `dir` is the google/fonts license folder ("" = ofl) and `faces` are `[italic, weight, file]`.
 */
export type RawFaceEntry = [italic: 0 | 1, weight: number, file: string];

const fileBase = (family: string) => family.replace(/ /g, "");

/**
 * Shorten a font file name for the catalog: drop ".ttf" and the family-name prefix when what remains
 * starts with "-" or "[" (or is empty). `expandFile` is the inverse.
 */
export const compactFile = (family: string, file: string): string => {
  const name = file.endsWith(".ttf") ? file.slice(0, -4) : file;
  const base = fileBase(family);
  if (!name.startsWith(base)) return name;
  const rest = name.slice(base.length);
  return rest === "" || rest.startsWith("-") || rest.startsWith("[") ? rest : name;
};

export const expandFile = (family: string, compact: string): string =>
  compact === "" || compact.startsWith("-") || compact.startsWith("[")
    ? `${fileBase(family)}${compact}.ttf`
    : `${compact}.ttf`;
export type RawFamilyEntry = [
  family: string,
  category: number,
  popularity: number,
  normal: number[],
  italic: number[],
  dir: string,
  variable: 0 | 1,
  faces: RawFaceEntry[],
];
export type RawCatalog = { ref: string; categories: FontCategory[]; families: RawFamilyEntry[] };

export type CatalogEntry = {
  info: FontFamilyInfo;
  /** Folder of the family inside github.com/google/fonts (e.g. "ofl/playfairdisplay"). */
  folder: string;
  /** True when each style is a single variable-weight file. */
  variable: boolean;
  faces: RawFaceEntry[];
};

export type Catalog = { ref: string; entries: Map<string, CatalogEntry> };

/** google/fonts folder name of a family: lowercase alphanumerics only. */
export const familySlug = (family: string): string =>
  family.toLowerCase().replace(/[^a-z0-9]/g, "");

export const buildCatalog = (raw: RawCatalog): Catalog => {
  const entries = new Map<string, CatalogEntry>();
  for (const [family, category, popularity, normal, italic, dir, variable, faces] of raw.families) {
    entries.set(family, {
      info: {
        family,
        category: raw.categories[category] ?? "display",
        weights: { normal, italic },
        popularity,
      },
      folder: `${dir || "ofl"}/${familySlug(family)}`,
      variable: variable === 1,
      faces,
    });
  }
  return { ref: raw.ref, entries };
};

export type ResolvedFile = {
  file: string;
  /** Weight the file is registered as (the requested weight is kept for variable files). */
  weight: number;
  italic: boolean;
  variable: boolean;
};

const nearest = (faces: RawFaceEntry[], weight: number): RawFaceEntry | undefined =>
  faces.reduce<RawFaceEntry | undefined>(
    (best, face) =>
      best === undefined || Math.abs(face[1] - weight) < Math.abs(best[1] - weight) ? face : best,
    undefined,
  );

/**
 * Pick the file that serves a face. Variable families have one file per style (weight comes from the
 * `wght` axis); static families get the nearest available weight. A family without italic files
 * resolves to its upright file.
 */
export const resolveFile = (entry: CatalogEntry, face: FontFaceSpec): ResolvedFile | undefined => {
  const wantItalic = face.style === "italic";
  const upright = entry.faces.filter(([italic]) => italic === 0);
  const slanted = entry.faces.filter(([italic]) => italic === 1);
  const pool = wantItalic && slanted.length > 0 ? slanted : upright.length > 0 ? upright : slanted;
  const match = nearest(pool, face.weight);
  if (!match) return undefined;
  return {
    file: expandFile(entry.info.family, match[2]),
    weight: entry.variable ? face.weight : match[1],
    italic: match[0] === 1,
    variable: entry.variable,
  };
};

export const FONT_CDN_ORIGIN = "https://cdn.jsdelivr.net";

/** Pinned (commit sha) jsDelivr URL of a font file in the google/fonts repo. */
export const buildFontFileUrl = (catalog: Catalog, entry: CatalogEntry, file: string): string =>
  `${FONT_CDN_ORIGIN}/gh/google/fonts@${catalog.ref}/${entry.folder}/${encodeURIComponent(file)}`;

/**
 * Google Fonts CSS2 URL for DOM-only previews: one request for many families, limited to the glyphs
 * of `text` so each font file stays tiny.
 */
export const buildPreviewCssUrl = (families: string[], text: string): string => {
  const params = families.map(
    (family) => `family=${encodeURIComponent(family).replace(/%20/g, "+")}`,
  );
  params.push(`text=${encodeURIComponent(text)}`, "display=swap");
  return `https://fonts.googleapis.com/css2?${params.join("&")}`;
};
