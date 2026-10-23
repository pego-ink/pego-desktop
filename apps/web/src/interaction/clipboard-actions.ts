import { toast } from "sonner";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore, viewportCenter } from "@/store/use-viewport-store";
import {
  payloadFromText,
  pasteNodesAt,
  readPayload,
  replaceWithNodes,
  type NodesPayload,
} from "./node-clipboard";

/**
 * Paste here / Paste to replace. The async Clipboard API cannot read our custom layer type, so the
 * last copy also leaves its data here, keyed by the plain text it put on the clipboard: when the
 * clipboard still holds that text, the layers are used; any other text pastes as SVG or text.
 */
let lastCopy: { text: string; data: string } | null = null;

/** Remember what a copy put on the clipboard (called by the copy handler). */
export const rememberCopy = (text: string, data: string): void => {
  lastCopy = { text, data };
};

/** The layers (or SVG / text) on the clipboard; null, with a toast, when there is nothing usable. */
const readClipboardPayload = async (): Promise<NodesPayload | null> => {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    toast("Pego can't read the clipboard. Allow clipboard access and try again.");
    return null;
  }
  const payload =
    (lastCopy && lastCopy.text === text ? readPayload(lastCopy.data) : null) ??
    payloadFromText(useDocumentStore.getState().doc, text);
  if (!payload) toast("Nothing to paste.");
  return payload;
};

/** The middle of the view, in canvas coordinates. */
export const viewCenter = () => {
  const middle = viewportCenter();
  return screenToDoc(useViewportStore.getState().camera, middle.x, middle.y);
};

/** Paste here: the clipboard's layers with their top-left at `at` (the view's middle by default). */
export const runPasteHere = async (
  at: { x: number; y: number } = viewCenter(),
): Promise<boolean> => {
  const payload = await readClipboardPayload();
  if (!payload) return false;
  const state = useDocumentStore.getState();
  const plan = pasteNodesAt(state.doc, getLayout(state.doc), payload, at, {
    pageId: activePage(state).id,
    selection: state.selection,
  });
  if (!plan || !state.commit(plan.ops, { label: plan.label })) return false;
  useDocumentStore.getState().select(plan.select);
  return true;
};

/** Paste to replace (⌘⇧R): swap the selected layers for the clipboard's, one undo step. */
export const runPasteReplace = async (): Promise<boolean> => {
  if (useDocumentStore.getState().selection.length === 0) return false;
  const payload = await readClipboardPayload();
  if (!payload) return false;
  const state = useDocumentStore.getState();
  const plan = replaceWithNodes(state.doc, payload, state.selection);
  if ("error" in plan) {
    toast(plan.error);
    return false;
  }
  if (!state.commit(plan.ops, { label: plan.label })) return false;
  useDocumentStore.getState().select(plan.select);
  return true;
};
