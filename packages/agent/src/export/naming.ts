const words = (value: string): string[] => value.match(/[A-Za-z0-9]+/g) ?? [];

export const pascalCase = (value: string, fallback: string): string => {
  const out = words(value)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (!out) return fallback;
  return /^\d/.test(out) ? `${fallback}${out}` : out;
};

export const camelCase = (value: string, fallback: string): string => {
  const out = pascalCase(value, "");
  if (!out) return fallback;
  const first = out.charAt(0).toLowerCase() + out.slice(1);
  return /^[a-z]/.test(first) ? first : fallback;
};

export const kebabCase = (value: string, fallback: string): string => {
  const out = words(value)
    .map((w) => w.toLowerCase())
    .join("-");
  if (!out) return fallback;
  return /^\d/.test(out) ? `${fallback}-${out}` : out;
};

/** First free `base`, `base2`, `base3`... in `taken`; reserves the result. */
export const uniqueName = (base: string, taken: Set<string>, separator = ""): string => {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${separator}${n}`;
  taken.add(name);
  return name;
};

/** CSS custom property name for a document variable (without the leading `--`). */
export const cssVarName = (name: string): string => {
  const slug = kebabCase(name, "var");
  // `--spacing` would redefine Tailwind's spacing scale.
  return slug === "spacing" ? "spacing-token" : slug;
};
