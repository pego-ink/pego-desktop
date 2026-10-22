import { toast } from "sonner";
import { findRenderedNode, type PegoDocument } from "@pego/doc";
import { exportHtml, exportSvg, type TextLines } from "@pego/export";
import { getLayout } from "@/canvas/layout";
import { getIconMarkup } from "@/canvas/icons";
import { useDocumentStore } from "@/store/use-document-store";

export type ExportFormat = "png@1x" | "png@2x" | "png@3x" | "svg" | "html";

export const EXPORT_FORMATS: readonly [ExportFormat, string][] = [
  ["png@1x", "PNG 1x"],
  ["png@2x", "PNG 2x"],
  ["png@3x", "PNG 3x"],
  ["svg", "SVG"],
  ["html", "HTML + CSS"],
];

/** A file name from the node's name: lowercase words joined by dashes, never empty. */
export const exportFileName = (name: string | undefined, format: ExportFormat): string => {
  const base =
    (name ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  const [kind, scale] = format.split("@");
  if (kind === "png") return scale === "1x" ? `${base}.png` : `${base}@${scale}.png`;
  return `${base}.${kind}`;
};

const download = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** The export of one node as a file blob, without downloading it. */
export const renderExport = async (doc: PegoDocument, nodeId: string, format: ExportFormat) => {
  if (format === "html") {
    const layout = getLayout(doc);
    const html = exportHtml(doc, layout, nodeId, { icon: (name) => getIconMarkup(name) });
    return new Blob([html], { type: "text/html" });
  }
  // CanvasKit drives PNG and the SVG text line breaks, so both match the canvas exactly.
  const [{ loadCanvasKit }, { renderNodeImage, HARD_MAX_IMAGE_SIZE }, { getParagraph }] =
    await Promise.all([
      import("@/canvas/load-canvaskit"),
      import("@/canvas/render-image"),
      import("@/canvas/measure-text"),
    ]);
  const res = await loadCanvasKit();
  const { requestDocumentFonts } = await import("@/canvas/fonts");
  await requestDocumentFonts(res.fonts, doc, res.fontFamily);
  // After the fonts: their metrics decide wrapping and hug sizes.
  const layout = getLayout(doc);
  if (format === "svg") {
    const textLines: TextLines = (node, width) => {
      const paragraph = getParagraph(res, node, doc.variables, width);
      const content = node.content.startsWith("$")
        ? String(doc.variables[node.content.slice(1)]?.value ?? node.content)
        : node.content;
      return paragraph.getLineMetrics().map((line) => ({
        text: content.slice(line.startIndex, line.endExcludingWhitespaces),
        x: line.left,
        baseline: line.baseline,
      }));
    };
    const imageSize = (src: string) => {
      const image = res.ck.MakeImageFromEncoded(base64ToBytes(src.slice(src.indexOf(",") + 1)));
      if (!image) return null;
      const size = { width: image.width(), height: image.height() };
      image.delete();
      return size;
    };
    const svg = exportSvg(doc, layout, nodeId, {
      icon: (name) => getIconMarkup(name),
      textLines,
      imageSize,
    });
    return new Blob([svg], { type: "image/svg+xml" });
  }
  const scale = Number(format.slice(4, 5));
  const image = renderNodeImage(res, doc, layout, nodeId, {
    scale,
    maxSize: HARD_MAX_IMAGE_SIZE,
    background: null,
  });
  return new Blob([base64ToBytes(image.data)], { type: "image/png" });
};

/** Export one node (and its subtree) and download it. */
export const exportNode = async (nodeId: string, format: ExportFormat) => {
  const doc = useDocumentStore.getState().doc;
  const node = findRenderedNode(doc, nodeId);
  if (!node) return;
  try {
    download(exportFileName(node.name, format), await renderExport(doc, nodeId, format));
  } catch (error) {
    toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
