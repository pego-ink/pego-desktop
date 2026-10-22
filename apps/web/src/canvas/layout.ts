import { computeLayout, type Layout, type PegoDocument, type TextMeasurer } from "@pego/doc";

/** Rough metrics until CanvasKit is loaded and registers the real measurer. */
const estimateText: TextMeasurer = (node, maxWidth) => {
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : 14;
  const width = node.content.length * fontSize * 0.55;
  return { width: maxWidth ?? width, height: fontSize * 1.2 };
};

let measureText: TextMeasurer = estimateText;
let cache = new WeakMap<PegoDocument, Layout>();

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
  cache.set(doc, layout);
  return layout;
};
