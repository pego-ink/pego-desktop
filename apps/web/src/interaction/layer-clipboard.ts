import { useEffect } from "react";
import { findNode, type PegoDocument } from "@pego/doc";
import { screenToDoc } from "@/canvas/types";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import {
  copyPayload,
  NODES_MIME,
  pasteNodes,
  pasteSvg,
  pasteText,
  readPayload,
} from "./node-clipboard";
import { rememberCopy } from "./clipboard-actions";
import { runDelete } from "./structure-actions";
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

/** What a copy or cut event looks like to `shouldHandleLayerClipboard`. */
export type ClipboardContext = {
  /** The event target or the focused element is an input, textarea, select or contenteditable. */
  inEditable: boolean;
  /** The canvas text editor is open. */
  textEditing: boolean;
  /** The text the user has selected on the page (empty when nothing is). */
  selectedText: string;
  /** The selection's anchor sits in an editable field. */
  selectionInEditable: boolean;
  /** Layers are selected on the canvas. */
  hasLayers: boolean;
};

/**
 * Whether a copy or cut is about the selected layers. Not when a field or the text editor has it,
 * nor when the user selected text anywhere (the agent transcript, a panel): that text stays theirs.
 */
export const shouldHandleLayerClipboard = (ctx: ClipboardContext): boolean =>
  ctx.hasLayers &&
  !ctx.inEditable &&
  !ctx.textEditing &&
  !ctx.selectionInEditable &&
  ctx.selectedText.length === 0;

/** Puts the selected layers on the clipboard (ids as text, ids for the composer, the layers). */
const writeSelection = (data: DataTransfer): boolean => {
  const { doc, selection } = useDocumentStore.getState();
  const copied = layerClipboard(doc, selection);
  const payload = copyPayload(doc, selection);
  if (!copied || !payload) return false;
  data.setData("text/plain", copied.text);
  data.setData(LAYERS_MIME, copied.payload);
  const nodes = JSON.stringify(payload);
  data.setData(NODES_MIME, nodes);
  rememberCopy(copied.text, nodes);
  return true;
};

/** What a paste on the canvas makes: copied layers, SVG markup or plain text (images: see use-image-paste). */
const pastePlanFor = (data: DataTransfer) => {
  const state = useDocumentStore.getState();
  const { camera, size } = useViewportStore.getState();
  const target = {
    pageId: activePage(state).id,
    selection: state.selection,
    center: screenToDoc(camera, size.width / 2, size.height / 2),
  };
  const payload = readPayload(data.getData(NODES_MIME));
  if (payload) return pasteNodes(state.doc, payload, target);
  // Image files are use-image-paste's.
  if (data.files.length > 0) return null;
  const text = data.getData("text/plain");
  return pasteSvg(state.doc, text, target) ?? pasteText(state.doc, text, target);
};

/**
 * Copy, cut and paste of layers while no field is focused (⌘C, ⌘X, ⌘V and the Edit menu). Copy
 * also gives the composer and agents in a terminal the layer ids ("Node IDs: a, b").
 */
export const useLayerCopy = () => {
  useEffect(() => {
    const outsideFields = (e: ClipboardEvent) =>
      e.clipboardData !== null && !isEditable(e.target) && !isTextEditing();
    const canCopyLayers = (e: ClipboardEvent) => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      return shouldHandleLayerClipboard({
        inEditable: isEditable(e.target) || isEditable(document.activeElement),
        textEditing: isTextEditing(),
        selectedText: selection?.toString() ?? "",
        selectionInEditable: isEditable(
          anchor instanceof Element ? anchor : (anchor?.parentElement ?? null),
        ),
        hasLayers: useDocumentStore.getState().selection.length > 0,
      });
    };
    const onCopy = (e: ClipboardEvent) => {
      if (e.clipboardData === null || !canCopyLayers(e)) return;
      if (writeSelection(e.clipboardData)) e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (e.clipboardData === null || !canCopyLayers(e)) return;
      if (!writeSelection(e.clipboardData)) return;
      e.preventDefault();
      runDelete();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!outsideFields(e)) return;
      const plan = pastePlanFor(e.clipboardData!);
      if (!plan) return;
      e.preventDefault();
      const state = useDocumentStore.getState();
      if (state.commit(plan.ops, { label: plan.label })) state.select(plan.select);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);
};
