import { toast } from "sonner";
import { useDocumentStore } from "@/store/use-document-store";
import { copyPayload } from "./node-clipboard";
import { topmostSelected } from "./transform";

export type CopyAsFormat = "svg" | "png" | "react-tailwind" | "html-css" | "json";

const LABELS: Record<CopyAsFormat, string> = {
  svg: "SVG",
  png: "PNG",
  "react-tailwind": "React + Tailwind",
  "html-css": "HTML/CSS",
  json: "JSON",
};

/** PNG is rendered at this scale (like the Export section's default retina size). */
const PNG_SCALE = 2;

/** The selected layer's export text for a text format. */
const textFor = async (
  format: Exclude<CopyAsFormat, "png" | "json">,
  id: string,
): Promise<string> => {
  const { doc } = useDocumentStore.getState();
  // The export engine (and its icon data) loads on first use.
  const { generateCode, generateSvg } = await import("@/export/generate");
  if (format === "svg") return generateSvg(doc, id);
  const files = await generateCode(doc, id, format);
  return files.map((file) => file.contents).join("\n\n");
};

/**
 * Copy as ›: puts the selection on the clipboard as SVG, PNG (image), React + Tailwind, HTML/CSS
 * or Pego JSON. All but JSON need exactly one layer. Toasts the result.
 */
export const runCopyAs = async (format: CopyAsFormat): Promise<boolean> => {
  const { doc, selection } = useDocumentStore.getState();
  const ids = topmostSelected(doc, selection);
  const label = LABELS[format];
  try {
    if (format === "json") {
      const payload = copyPayload(doc, ids);
      if (!payload) throw new Error("Select a layer first.");
      await navigator.clipboard.writeText(JSON.stringify(payload.nodes, null, 2));
    } else {
      const id = ids[0];
      if (ids.length !== 1 || !id) throw new Error(`Select one layer to copy as ${label}.`);
      if (format === "png") {
        const { generatePng } = await import("@/export/generate");
        // Handing the clipboard a promise keeps the user gesture alive while CanvasKit loads.
        const blob = generatePng(doc, id, PNG_SCALE).then((image) => image.blob);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        await navigator.clipboard.writeText(await textFor(format, id));
      }
    }
    toast(`Copied as ${label}`);
    return true;
  } catch (error) {
    toast(
      error instanceof Error
        ? `Could not copy as ${label}: ${error.message}`
        : `Could not copy as ${label}`,
    );
    return false;
  }
};
