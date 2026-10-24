import {
  computeLayout,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type TextMeasurer,
} from "@pego/doc";

/** Rough metrics until CanvasKit is loaded and registers the real measurer. */
const estimateText: TextMeasurer = (node, maxWidth) => {
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  const width = node.content.length * fontSize * 0.55;
  return { width: maxWidth ?? width, height: fontSize * 1.2 };
};

let measureText: TextMeasurer = estimateText;
let cache = new WeakMap<PegoDocument, Layout>();
let connectorsShown = true;

/**
 * Show or hide wireflow connectors in the editor (Settings). Hidden ones get no box, so the
 * canvas, hit-testing, marquee and selection all skip them; the document keeps them.
 */
export const setConnectorsShown = (shown: boolean) => {
  if (shown === connectorsShown) return;
  connectorsShown = shown;
  cache = new WeakMap();
};

const dropConnectors = (nodes: readonly PegoNode[], layout: Layout) => {
  for (const node of nodes) {
    if (node.type === "connector") layout.delete(node.id);
    else if ("children" in node) dropConnectors(node.children, layout);
  }
};

/** Drop cached layouts, e.g. after a web font finished loading and text metrics changed. */
export const invalidateLayout = () => {
  cache = new WeakMap();
};

/** Register the CanvasKit-backed text measurer. Invalidates cached layouts. */
export const setTextMeasurer = (measurer: TextMeasurer) => {
  measureText = measurer;
  cache = new WeakMap();
};

/** Layout for a document snapshot, memoized by document identity (documents are immutable). */
export const getLayout = (doc: PegoDocument): Layout => {
  const cached = cache.get(doc);
  if (cached) return cached;
  const layout = computeLayout(doc, measureText);
  if (!connectorsShown) dropConnectors(doc.children, layout);
  cache.set(doc, layout);
  return layout;
};
