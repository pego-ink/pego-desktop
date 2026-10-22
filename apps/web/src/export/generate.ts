import { exportCode, exportSvg, loadIcons, type CodeFormat, type ExportFile } from "@pego/agent";
import type { PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import "@/export/register-icons";
import { base64ToBytes } from "@/export/download";
import { loadDocumentFonts } from "@/fonts/use-document-fonts";

/** Longest PNG side we allow; `renderNodeImage` enforces the same ceiling. */
const MAX_PNG_SIZE = 4096;

export const generateCode = async (
  doc: PegoDocument,
  nodeId: string,
  format: CodeFormat,
): Promise<ExportFile[]> => {
  await Promise.all([loadIcons(), loadDocumentFonts(doc)]);
  return exportCode(doc, nodeId, { format, layout: getLayout(doc) });
};

export const generateSvg = async (doc: PegoDocument, nodeId: string): Promise<string> => {
  // Font metrics decide wrapping and hug sizes in the layout.
  await Promise.all([loadIcons(), loadDocumentFonts(doc)]);
  return exportSvg(doc, nodeId, { layout: getLayout(doc) });
};

/** Render with the editor's renderer at `scale` (CanvasKit loads on first use). */
export const generatePng = async (
  doc: PegoDocument,
  nodeId: string,
  scale: number,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const [{ loadCanvasKit }, { renderNodeImage }] = await Promise.all([
    import("@/canvas/load-canvaskit"),
    import("@/canvas/render-image"),
  ]);
  const res = await loadCanvasKit();
  await loadDocumentFonts(doc);
  const image = renderNodeImage(res, doc, getLayout(doc), nodeId, {
    scale,
    maxSize: MAX_PNG_SIZE,
  });
  return {
    blob: new Blob([base64ToBytes(image.data)], { type: image.mediaType }),
    width: image.width,
    height: image.height,
  };
};
