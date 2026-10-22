/**
 * Variable-font lookup for the text measurer, kept dependency-free so canvas code can use it
 * without importing the font service (which imports CanvasKit loading → import cycle).
 * The font service installs the real lookup once the catalog has loaded.
 */
const BUNDLED_VARIABLE_FAMILIES = new Set(["Inter"]);

let isVariableFamily: (family: string) => boolean = () => false;

export const setVariableFamilyLookup = (lookup: (family: string) => boolean) => {
  isVariableFamily = lookup;
};

/**
 * `fontVariations` for a face: variable families need an explicit `wght` axis value, otherwise
 * Skia synthesizes a faux bold from the default instance. Static families return undefined.
 */
export const fontVariationsFor = (
  family: string,
  weight: number,
): { axis: string; value: number }[] | undefined =>
  BUNDLED_VARIABLE_FAMILIES.has(family) || isVariableFamily(family)
    ? [{ axis: "wght", value: weight }]
    : undefined;
