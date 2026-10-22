export type FontStyle = "normal" | "italic";

/** One loadable face of a family. */
export type FontFaceSpec = { family: string; weight: number; style: FontStyle };

export type FontCategory = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";

/** A Google Fonts family and the faces it offers (static weights, or a weight range when variable). */
export type FontFamilyInfo = {
  family: string;
  category: FontCategory;
  /** Available weights per style, ascending, e.g. { normal: [400, 700], italic: [400] }. */
  weights: { normal: number[]; italic: number[] };
  /** Popularity rank from the catalog (lower = more popular), for default sorting. */
  popularity: number;
};
