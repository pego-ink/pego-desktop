export const DARK_TEXT = "#1B1B21";
export const LIGHT_TEXT = "#F2F2F5";

/** Relative luminance (0..1) of a #rgb / #rrggbb(aa) color, or null when not parseable. */
export const hexLuminance = (hex: string): number | null => {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** Readable default text color on a parent fill; no/unknown fill means the dark canvas. */
export const defaultTextColor = (parentFill: string | undefined): string => {
  const luminance = parentFill ? hexLuminance(parentFill) : null;
  if (luminance === null) return LIGHT_TEXT;
  return luminance > 0.4 ? DARK_TEXT : LIGHT_TEXT;
};
