import { loadFontCatalog } from "./font-service";

/**
 * Well-known system / web fonts -> the closest Google Fonts family (lowercase keys). Targets that
 * are missing from the catalog are skipped at lookup time.
 */
export const FONT_ALIASES: Readonly<Record<string, string>> = {
  "-apple-system": "Inter",
  blinkmacsystemfont: "Inter",
  "system-ui": "Inter",
  "ui-sans-serif": "Inter",
  "sf pro": "Inter",
  "sf pro text": "Inter",
  "sf pro display": "Inter",
  "segoe ui": "Inter",
  "helvetica neue": "Inter",
  "sans-serif": "Inter",
  helvetica: "Arimo",
  arial: "Arimo",
  "liberation sans": "Arimo",
  // Wide humanist sans: Open Sans is closer in width and x-height than the narrower PT Sans.
  verdana: "Open Sans",
  tahoma: "Open Sans",
  geneva: "Open Sans",
  georgia: "Tinos",
  times: "Tinos",
  "times new roman": "Tinos",
  "ui-serif": "Tinos",
  serif: "Tinos",
  courier: "Cousine",
  "courier new": "Cousine",
  menlo: "JetBrains Mono",
  monaco: "JetBrains Mono",
  "sf mono": "JetBrains Mono",
  consolas: "JetBrains Mono",
  "ui-monospace": "JetBrains Mono",
  monospace: "JetBrains Mono",
};

const clean = (family: string): string =>
  family
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

/**
 * First family (in CSS order) that is in the catalog, or whose well-known alias is. `lookup` maps
 * a name to its canonical catalog spelling (case-insensitive) or undefined.
 */
export const resolveFontFamily = (
  families: readonly string[],
  lookup: (name: string) => string | undefined,
): string | undefined => {
  for (const raw of families) {
    const name = clean(raw);
    if (!name) continue;
    const exact = lookup(name);
    if (exact) return exact;
    const alias = FONT_ALIASES[name.toLowerCase()];
    const mapped = alias === undefined ? undefined : lookup(alias);
    if (mapped) return mapped;
  }
  return undefined;
};

let byLowercase: Map<string, string> | null = null;

/** Loads the catalog so `resolveFont` can answer; call (and await) before using it. */
export const primeFontResolver = async (): Promise<void> => {
  if (byLowercase) return;
  const infos = await loadFontCatalog();
  byLowercase = new Map(infos.map((info) => [info.family.toLowerCase(), info.family]));
};

/** `ToolHost.resolveFont`: undefined until the catalog is primed. */
export const resolveFont = (families: string[]): string | undefined => {
  const map = byLowercase;
  return map ? resolveFontFamily(families, (name) => map.get(name.toLowerCase())) : undefined;
};
