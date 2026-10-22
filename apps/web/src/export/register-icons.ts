import { setIconLoader, type IconProvider } from "@pego/agent";

const toPascalCase = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * Give the code/SVG exporters the lucide icon data. Lazy: lucide is its own chunk and is only
 * fetched when something exports (inline SVG needs the shapes, React output only the names).
 */
setIconLoader(async (): Promise<IconProvider> => {
  const { icons } = await import("lucide");
  return (name) => icons[toPascalCase(name) as keyof typeof icons];
});
