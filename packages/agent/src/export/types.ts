import type { Layout } from "@pego/doc";

export type CodeFormat = "react-tailwind" | "html-css";

export type ExportFile = { path: string; contents: string };

/** One drawing element of a lucide icon: `[tag, attributes]`, the shape lucide's data uses. */
export type IconElement = readonly [
  tag: string,
  attrs: Readonly<Record<string, string | number | undefined>>,
];

/** Lucide icon data by kebab-case name; undefined when the icon is unknown. */
export type IconProvider = (name: string) => readonly IconElement[] | undefined;

export type ExportOptions = {
  /** Absolute boxes (as the renderer computed them). Used to size hugging absolute containers. */
  layout?: Layout;
  /** Icon data for inline SVG. Defaults to the registered provider (see icons.ts). */
  icons?: IconProvider;
};

export type CodeExportOptions = ExportOptions & { format: CodeFormat };
