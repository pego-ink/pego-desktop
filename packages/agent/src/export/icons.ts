import type { IconProvider } from "./types";

let provider: IconProvider | undefined;
let loader: (() => Promise<IconProvider>) | undefined;

/** Register the icon data source (the web app injects lucide; this package has no lucide dep). */
export const setIconProvider = (next: IconProvider | undefined): void => {
  provider = next;
};

/** Register a lazy source; `loadIcons` resolves it once before async exports. */
export const setIconLoader = (next: (() => Promise<IconProvider>) | undefined): void => {
  loader = next;
};

export const getIconProvider = (): IconProvider | undefined => provider;

/** Resolve the registered loader (if any) and return the provider. */
export const loadIcons = async (): Promise<IconProvider | undefined> => {
  if (!provider && loader) provider = await loader();
  return provider;
};

/** kebab-case icon name to the PascalCase export name used by lucide and lucide-react. */
export const iconPascalName = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
