import { useEffect } from "react";
import { findNode, type PegoDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { isTextEditing } from "@/store/use-text-edit-store";

/** Clipboard type of copied layers: which document, which ids (read by the agent composer). */
export const LAYERS_MIME = "application/x-pego-layers";

/**
 * What copying selected layers puts on the clipboard: their ids as text (for an agent in a
 * terminal, e.g. "Node IDs: a, b") and, for the composer, the document and ids.
 */
export const layerClipboard = (doc: PegoDocument, ids: readonly string[]) => {
  const kept = ids.filter((id) => findNode(doc, id) != null);
  if (kept.length === 0) return null;
  return {
    text: `${kept.length === 1 ? "Node ID" : "Node IDs"}: ${kept.join(", ")}`,
    payload: JSON.stringify({ docId: doc.id, ids: kept }),
  };
};

/** The ids of layers copied from `doc` that still exist in it; null for anything else. */
export const readLayerClipboard = (data: string, doc: PegoDocument): string[] | null => {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { docId?: unknown; ids?: unknown };
    if (parsed.docId !== doc.id || !Array.isArray(parsed.ids)) return null;
    const ids = parsed.ids.filter(
      (id): id is string => typeof id === "string" && findNode(doc, id) != null,
    );
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Copy (⌘C, Edit > Copy) with layers selected and no field focused copies their references. */
export const useLayerCopy = () => {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (!e.clipboardData || isEditable(e.target) || isTextEditing()) return;
      if (window.getSelection()?.toString()) return; // copying selected UI text stays the browser's
      const { doc, selection } = useDocumentStore.getState();
      const copied = layerClipboard(doc, selection);
      if (!copied) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", copied.text);
      e.clipboardData.setData(LAYERS_MIME, copied.payload);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
};
