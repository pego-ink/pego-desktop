import type { FontUse } from "./ir";

const SYSTEM_FONTS = new Set(
  [
    "arial",
    "helvetica",
    "helvetica neue",
    "georgia",
    "times",
    "times new roman",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "courier",
    "courier new",
    "impact",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace",
    "sf pro",
    "sf pro display",
    "sf pro text",
    "segoe ui",
  ].map((f) => f.toLowerCase()),
);

export const isGoogleFont = (family: string): boolean => !SYSTEM_FONTS.has(family.toLowerCase());

const axis = (use: FontUse): string => {
  const normal = [...use.normal].sort((a, b) => a - b);
  const italic = [...use.italic].sort((a, b) => a - b);
  if (italic.length === 0) return `wght@${normal.join(";")}`;
  const tuples = [...normal.map((w) => `0,${w}`), ...italic.map((w) => `1,${w}`)];
  return `ital,wght@${tuples.join(";")}`;
};

/** Google Fonts stylesheet URL for the used families, or undefined when only system fonts. */
export const googleFontsUrl = (fonts: ReadonlyMap<string, FontUse>): string | undefined => {
  const families = [...fonts]
    .filter(([family]) => isGoogleFont(family))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, use]) => `family=${family.trim().replace(/\s+/g, "+")}:${axis(use)}`);
  if (families.length === 0) return undefined;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
};
