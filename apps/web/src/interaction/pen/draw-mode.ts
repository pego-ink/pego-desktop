import { createId, findNode, type PegoDocument } from "@pego/doc";
import type { Canvas as SkCanvas } from "canvaskit-wasm";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { getLayout } from "@/canvas/layout";
import { docToScreen, type Camera } from "@/canvas/types";
import { hitPath } from "@/interaction/hit-test";
import { resolvePlacement, uniqueName, type Placement } from "@/interaction/create-node";
import { useToolPreview, type ToolPointer, type ToolSession } from "@/interaction/tool-handlers";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";
import {
  canClose,
  constrain45,
  cornerAnchor,
  creationDrag,
  dist,
  type Anchor,
  type Pt,
} from "./anchors";
import { newPathNode } from "./build-node";
import { drawAnchorHandles, drawAnchorMarker, drawContours, drawRubberBand } from "./overlay";

const DRAG_THRESHOLD = 3;
/** Screen px within which a click on the first anchor closes the path. */
const CLOSE_RADIUS = 8;

type DrawState = {
  anchors: Anchor[];
  placement: Placement | null;
  /** Latest pointer position in document space (for the rubber band). */
  cursor: Pt | null;
  shift: boolean;
};

const fresh = (): DrawState => ({ anchors: [], placement: null, cursor: null, shift: false });
let state: DrawState = fresh();

const invalidate = () => useToolPreview.getState().invalidate();
const zoom = () => useViewportStore.getState().camera.zoom;

export const isDrawing = (): boolean => state.anchors.length > 0;

export const resetDraw = () => {
  state = fresh();
  invalidate();
};

const closeTolerance = () => CLOSE_RADIUS / zoom();

const siblingsOf = (doc: PegoDocument, parentId: string | null) => {
  if (parentId === null) return doc.children;
  const parent = findNode(doc, parentId);
  return parent && (parent.type === "frame" || parent.type === "group") ? parent.children : [];
};

/**
 * Turn the pending anchors into one `path` node (one undo step) and select it. Fewer than two
 * anchors are discarded. Returns whether a node was created.
 */
export const finishDraw = (closed: boolean): boolean => {
  const { anchors, placement } = state;
  state = fresh();
  invalidate();
  if (anchors.length < 2 || !placement) return false;
  const store = useDocumentStore.getState();
  const isClosed = closed && anchors.length >= 3;
  const id = createId();
  const name = uniqueName(isClosed ? "Vector" : "Path", siblingsOf(store.doc, placement.parentId));
  const node = newPathNode(
    store.doc,
    id,
    name,
    [{ anchors, closed: isClosed }],
    { x: placement.originX, y: placement.originY },
    placement.flex,
  );
  if (!node) return false;
  const ok = store.commit([{ op: "insert", parentId: placement.parentId, node }], {
    label: isClosed ? "Create vector" : "Create path",
  });
  if (ok) useDocumentStore.getState().select([id]);
  return ok;
};

/** Finish and hand control back to the select tool (like Figma). */
export const finishAndLeave = (closed: boolean) => {
  finishDraw(closed);
  useToolStore.getState().setTool("select");
};

const nearFirst = (screen: Pt): boolean => {
  const [first] = state.anchors;
  if (!first || state.anchors.length < 2) return false;
  const camera = useViewportStore.getState().camera;
  const f = docToScreen(camera, first.p.x, first.p.y);
  return Math.hypot(f.x - screen.x, f.y - screen.y) <= CLOSE_RADIUS;
};

export const drawBegin = (p: ToolPointer): ToolSession | null => {
  if (state.anchors.length === 0) {
    const { doc } = useDocumentStore.getState();
    const layout = getLayout(doc);
    state.placement = resolvePlacement(doc, layout, hitPath(doc, layout, p.doc.x, p.doc.y));
  }
  if (nearFirst(p.screen)) {
    finishAndLeave(true);
    return null;
  }
  const last = state.anchors[state.anchors.length - 1];
  const position = p.shiftKey && last ? constrain45(last.p, p.doc) : p.doc;
  const index = state.anchors.length;
  state = { ...state, anchors: [...state.anchors, cornerAnchor(position)], cursor: position };
  invalidate();

  return {
    move: (m) => {
      if (dist(m.screen, p.screen) < DRAG_THRESHOLD) return;
      const handle = m.shiftKey ? constrain45(position, m.doc) : m.doc;
      const anchors = state.anchors.map((a, i) =>
        i === index ? creationDrag(a, handle, m.altKey) : a,
      );
      state = { ...state, anchors, cursor: m.doc };
      invalidate();
    },
    up: () => undefined,
    cancel: () => undefined,
  };
};

export const drawHover = (p: ToolPointer) => {
  if (state.anchors.length === 0) return;
  state = { ...state, cursor: p.doc, shift: p.shiftKey };
  invalidate();
};

export const drawKeyDown = (e: KeyboardEvent): boolean => {
  if (state.anchors.length === 0) return false;
  if (e.key === "Enter" || e.key === "Escape") {
    // Escape with fewer than two anchors discards but keeps the tool armed.
    if (state.anchors.length < 2) resetDraw();
    else finishAndLeave(false);
    return true;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    state = { ...state, anchors: state.anchors.slice(0, -1) };
    invalidate();
    return true;
  }
  return false;
};

export const drawOverlay = (res: CanvasKitResources, canvas: SkCanvas, camera: Camera) => {
  const { anchors, cursor, shift } = state;
  const last = anchors[anchors.length - 1];
  if (!last) return;
  drawContours(res, canvas, [{ anchors, closed: false }], camera);

  const first = anchors[0] as Anchor;
  let closing = false;
  if (cursor) {
    closing = canClose({ anchors, closed: false }, cursor, closeTolerance());
    const target = closing ? first.p : shift ? constrain45(last.p, cursor) : cursor;
    drawRubberBand(res, canvas, last, target, closing ? first.in : null, camera);
  }
  drawAnchorHandles(res, canvas, last, camera);
  anchors.forEach((a, i) => {
    drawAnchorMarker(res, canvas, a.p, camera, {
      filled: i === anchors.length - 1,
      hot: closing && i === 0,
    });
  });
};
