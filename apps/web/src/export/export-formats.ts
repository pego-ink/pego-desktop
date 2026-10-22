import type { CodeFormat } from "@pego/agent";

export type ExportFormat = "png-1x" | "png-2x" | "png-3x" | "svg" | CodeFormat;

export type ExportFormatOption = { value: ExportFormat; label: string; group: "Image" | "Code" };

export const EXPORT_FORMATS: readonly ExportFormatOption[] = [
  { value: "png-1x", label: "PNG 1x", group: "Image" },
  { value: "png-2x", label: "PNG 2x", group: "Image" },
  { value: "png-3x", label: "PNG 3x", group: "Image" },
  { value: "svg", label: "SVG", group: "Image" },
  { value: "react-tailwind", label: "React + Tailwind", group: "Code" },
  { value: "html-css", label: "HTML / CSS", group: "Code" },
];

export const isCodeFormat = (format: ExportFormat): format is CodeFormat =>
  format === "react-tailwind" || format === "html-css";

/** Pixel scale of a PNG format, undefined for the others. */
export const pngScale = (format: ExportFormat): number | undefined => {
  const match = /^png-(\d)x$/.exec(format);
  return match ? Number(match[1]) : undefined;
};

/** File-name stem for a node: kebab-case of its name, falling back to its type. */
export const exportBaseName = (node: { name?: string; type: string }): string => {
  const words = (node.name ?? "").match(/[A-Za-z0-9]+/g);
  return words ? words.join("-").toLowerCase() : node.type;
};

/** Download name of an image export, e.g. `board@2x.png`. */
export const imageFileName = (base: string, format: ExportFormat): string => {
  const scale = pngScale(format);
  if (scale === undefined) return `${base}.svg`;
  return scale === 1 ? `${base}.png` : `${base}@${scale}x.png`;
};

/** Code files keep their own name but lose their folder (downloads are flat). */
export const codeFileName = (path: string): string => path.split("/").at(-1) ?? path;

const MIME: Record<string, string> = {
  tsx: "text/typescript",
  css: "text/css",
  html: "text/html",
  svg: "image/svg+xml",
};

export const mimeFor = (path: string): string => MIME[path.split(".").at(-1) ?? ""] ?? "text/plain";

/** All files as one text block, each under a path header, for the clipboard. */
export const joinFilesForCopy = (files: readonly { path: string; contents: string }[]): string =>
  files.length === 1
    ? (files[0]?.contents ?? "")
    : files.map((f) => `/* ${f.path} */\n${f.contents}`).join("\n");
