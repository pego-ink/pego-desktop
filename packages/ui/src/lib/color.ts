const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Normalise user input to an uppercase `#RGB(A)` / `#RRGGBB(AA)` string, or null when invalid. */
export const parseHex = (input: string): string | null => {
  const match = HEX_PATTERN.exec(input.trim());
  return match?.[1] ? `#${match[1].toUpperCase()}` : null;
};

/** `<input type="color">` only understands `#rrggbb`: expand short forms and drop alpha. */
export const toColorInputValue = (hex: string | undefined): string => {
  const parsed = hex ? parseHex(hex) : null;
  if (!parsed) return "#000000";
  const digits = parsed.slice(1);
  if (digits.length <= 4) {
    const [r = "0", g = "0", b = "0"] = digits;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return `#${digits.slice(0, 6)}`.toLowerCase();
};
