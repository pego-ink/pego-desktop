import { findNode, type PathNode } from "@pego/doc";
import type { Canvas as SkCanvas } from "canvaskit-wasm";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { getNodeIndex, hitPath, HIT_TOLERANCE_PX } from "@/interaction/hit-test";
import { pickAt } from "@/interaction/selection";
import { useToolPreview, type ToolPointer, type ToolSession } from "@/interaction/tool-handlers";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";
import {
  constrain45,
  dist,
  dragHandle,
  removeAnchor,
  toggleSmooth,
  translateAnchor,
  translateContours,
  type Contour,
  type Pt,
} from "./anchors";
import { hitTestSegments, insertAnchorAt } from "./bezier";
import { parentOriginOf, pathGeometryProps } from "./build-node";
import { drawAnchorHandles, drawAnchorMarker, drawContours } from "./overlay";
import { parseSvgPath } from "./svg-path";

const DRAG_THRESHOLD = 3;
const ANCHOR_HIT = 7;
const HANDLE_HIT = 6;
const SEGMENT_HIT = 6;

type Sel = { c: number; i: number };

type EditState = {
  id: string;
  /** Contours in document coordinates. */
  contours: Contour[];
  sel: Sel | null;
  hover: Sel | null;
  /** Parent origin in document coordinates, and whether the parent positions children itself. */
  origin: Pt;
  flex: boolean;
  /** `geometry|x|y` last read from / written to the document; a mismatch means an external change. */
  signature: string;
  /** `KeyboardEvent.timeStamp` of the key press that opened edit mode (ignored by `editKeyDown`). */
  openedBy: number | null;
};

let state: EditState | null = null;

const invalidate = () => useToolPreview.getState().invalidate();
const zoom = () => useViewportStore.getState().camera.zoom;

export const isEditing = (): boolean => state !== null;
export const resetEdit = () => {
  state = null;
  invalidate();
};

const signatureOf = (node: PathNode) => `${node.geometry}|${String(node.x)}|${String(node.y)}`;

/** Read a path node into an edit state, or null when it cannot be edited. */
const load = (id: string): EditState | null => {
  const { doc } = useDocumentStore.getState();
  const node = findNode(doc, id);
  if (node?.type !== "path") return null;
  const box = getLayout(doc).get(id);
  const parsed = parseSvgPath(node.geometry);
  if (!box || !parsed) return null;
  const parentId = getNodeIndex(doc).get(id)?.parentId ?? null;
  const parent = parentId ? findNode(doc, parentId) : null;
  return {
    id,
    contours: translateContours(parsed, box.x, box.y),
    sel: null,
    hover: null,
    origin: parentOriginOf(box, node, doc),
    flex: parent?.type === "frame" && parent.layout !== "none",
    signature: signatureOf(node),
    openedBy: null,
  };
};

/** Enter edit mode for a path node: the pen tool in its "edit" sub-mode. */
export const enterEdit = (id: string, openedBy: number | null = null): boolean => {
  const next = load(id);
  if (!next) return false;
  state = { ...next, openedBy };
  useDocumentStore.getState().select([id]);
  useToolStore.getState().setTool("pen");
  invalidate();
  return true;
};

export const exitEdit = () => {
  state = null;
  useToolStore.getState().setTool("select");
  invalidate();
};

/** Current state, re-read from the document when something else (undo, agent) changed the node. */
const sync = (): EditState | null => {
  if (!state) return null;
  const node = findNode(useDocumentStore.getState().doc, state.id);
  if (node?.type !== "path") {
    exitEdit();
    return null;
  }
  if (signatureOf(node) !== state.signature) {
    const reloaded = load(state.id);
    if (!reloaded) {
      exitEdit();
      return null;
    }
    const { sel } = state;
    const valid = sel && reloaded.contours[sel.c]?.anchors[sel.i];
    state = { ...reloaded, sel: valid ? sel : null, openedBy: state.openedBy };
  }
  return state;
};

/** Write `contours` to the node. The first write of a gesture is a commit, later ones fold into it. */
const write = (contours: Contour[], first: boolean, label: string): boolean => {
  const s = state;
  if (!s) return false;
  const props = pathGeometryProps(contours, s.origin, s.flex);
  if (!props) return false;
  const store = useDocumentStore.getState();
  const ops = [{ op: "update" as const, id: s.id, props }];
  const ok = first ? store.commit(ops, { label }) : store.extendLast(ops);
  if (!ok) return false;
  const node = findNode(useDocumentStore.getState().doc, s.id);
  state = {
    ...s,
    contours,
    signature: node?.type === "path" ? signatureOf(node) : s.signature,
  };
  invalidate();
  return true;
};

const screenTol = (px: number) => px / zoom();

type AnchorHit = Sel;
const hitAnchor = (s: EditState, doc: Pt): AnchorHit | null => {
  const tol = screenTol(ANCHOR_HIT);
  let best: { sel: Sel; d: number } | null = null;
  s.contours.forEach((c, ci) =>
    c.anchors.forEach((a, i) => {
      const d = dist(a.p, doc);
      if (d <= tol && (!best || d < best.d)) best = { sel: { c: ci, i }, d };
    }),
  );
  return (best as { sel: Sel } | null)?.sel ?? null;
};

const hitHandle = (s: EditState, doc: Pt): { sel: Sel; which: "in" | "out" } | null => {
  if (!s.sel) return null;
  const a = s.contours[s.sel.c]?.anchors[s.sel.i];
  if (!a) return null;
  const tol = screenTol(HANDLE_HIT);
  const candidates = (["in", "out"] as const)
    .map((which) => ({ which, h: a[which] }))
    .filter((x): x is { which: "in" | "out"; h: Pt } => x.h !== null && dist(x.h, doc) <= tol);
  const nearest = candidates.sort((x, y) => dist(x.h, doc) - dist(y.h, doc))[0];
  return nearest ? { sel: s.sel, which: nearest.which } : null;
};

const replaceContour = (contours: Contour[], ci: number, next: Contour): Contour[] =>
  contours.map((c, i) => (i === ci ? next : c));

/** Drag the selected anchor (with its handles). `committed`: the gesture already has its undo step. */
const anchorDrag = (start: ToolPointer, sel: Sel, committed: boolean): ToolSession => {
  const base = state?.contours ?? [];
  let started = committed;
  return {
    move: (m) => {
      if (!started && dist(m.screen, start.screen) < DRAG_THRESHOLD) return;
      const raw = { x: m.doc.x - start.doc.x, y: m.doc.y - start.doc.y };
      const delta = m.shiftKey ? constrain45({ x: 0, y: 0 }, { x: raw.x, y: raw.y }) : raw;
      const contours = base.map((c, ci) =>
        ci === sel.c
          ? {
              ...c,
              anchors: c.anchors.map((a, i) =>
                i === sel.i ? translateAnchor(a, delta.x, delta.y) : a,
              ),
            }
          : c,
      );
      if (write(contours, !started, "Move anchor")) started = true;
    },
    up: () => undefined,
    cancel: () => undefined,
  };
};

const handleDrag = (start: ToolPointer, sel: Sel, which: "in" | "out"): ToolSession => {
  const base = state?.contours ?? [];
  let started = false;
  return {
    move: (m) => {
      if (!started && dist(m.screen, start.screen) < DRAG_THRESHOLD) return;
      const contour = base[sel.c];
      const anchor = contour?.anchors[sel.i];
      if (!contour || !anchor) return;
      const target = m.shiftKey ? constrain45(anchor.p, m.doc) : m.doc;
      const next = dragHandle(anchor, which, target, m.altKey);
      const contours = replaceContour(base, sel.c, {
        ...contour,
        anchors: contour.anchors.map((a, i) => (i === sel.i ? next : a)),
      });
      if (write(contours, !started, "Move handle")) started = true;
    },
    up: () => undefined,
    cancel: () => undefined,
  };
};

export const editBegin = (p: ToolPointer): ToolSession | null => {
  const s = sync();
  if (!s) return null;

  const handle = hitHandle(s, p.doc);
  if (handle) return handleDrag(p, handle.sel, handle.which);

  const anchor = hitAnchor(s, p.doc);
  if (anchor) {
    state = { ...s, sel: anchor };
    invalidate();
    if (p.altKey) {
      const contour = s.contours[anchor.c];
      if (contour)
        write(
          replaceContour(s.contours, anchor.c, toggleSmooth(contour, anchor.i)),
          true,
          "Toggle corner/smooth",
        );
      return null;
    }
    return anchorDrag(p, anchor, false);
  }

  const segment = hitTestSegments(s.contours, p.doc, screenTol(SEGMENT_HIT));
  if (segment) {
    const contour = s.contours[segment.contour];
    if (contour) {
      const inserted = insertAnchorAt(contour, segment.index, segment.t);
      const contours = replaceContour(s.contours, segment.contour, inserted.contour);
      if (write(contours, true, "Add anchor")) {
        const sel = { c: segment.contour, i: inserted.index };
        state = state ? { ...state, sel } : state;
        return anchorDrag(p, sel, true);
      }
    }
    return null;
  }

  // Empty canvas ends edit mode; another node under the click is selected instead.
  const { doc, selection, pageId } = useDocumentStore.getState();
  const layout = getLayout(doc);
  const hit = { tolerance: screenTol(HIT_TOLERANCE_PX), pageId };
  // A click on the path's own body just drops the anchor selection.
  if (hitPath(doc, layout, p.doc.x, p.doc.y, hit)?.includes(s.id)) {
    state = { ...s, sel: null };
    invalidate();
    return null;
  }
  const picked = pickAt(doc, layout, p.doc.x, p.doc.y, selection, p.metaKey, hit);
  exitEdit();
  useDocumentStore.getState().select(picked ? [picked] : []);
  return null;
};

export const editHover = (p: ToolPointer) => {
  const s = sync();
  if (!s) return;
  const hover = hitAnchor(s, p.doc);
  const same = hover?.c === s.hover?.c && hover?.i === s.hover?.i;
  if (same) return;
  state = { ...s, hover };
  invalidate();
};

const deleteSelected = (s: EditState): boolean => {
  if (!s.sel) return false;
  const { sel } = s;
  const contour = s.contours[sel.c];
  if (!contour) return false;
  const next = removeAnchor(contour, sel.i);
  const contours =
    next.anchors.length === 0
      ? s.contours.filter((_, i) => i !== sel.c)
      : replaceContour(s.contours, sel.c, next);
  const remaining = contours.reduce((n, c) => n + c.anchors.length, 0);
  if (remaining < 2) {
    // Nothing drawable is left: delete the node, like removing the last anchors in Figma.
    const id = s.id;
    state = null;
    useToolStore.getState().setTool("select");
    useDocumentStore.getState().commit([{ op: "delete", id }], { label: "Delete path" });
    return true;
  }
  if (write(contours, true, "Delete anchor")) {
    state = state ? { ...state, sel: null } : state;
    invalidate();
  }
  return true;
};

export const editKeyDown = (e: KeyboardEvent): boolean => {
  const s = sync();
  if (!s) return false;
  if (s.openedBy !== null && e.timeStamp === s.openedBy) return true;
  if (e.key === "Enter" || e.key === "Escape") {
    exitEdit();
    return true;
  }
  if (e.key === "Delete" || e.key === "Backspace") return deleteSelected(s);
  return false;
};

export const editOverlay = (res: CanvasKitResources, canvas: SkCanvas, camera: Camera) => {
  const s = sync();
  if (!s) return;
  drawContours(res, canvas, s.contours, camera, 1);
  const selected = s.sel ? s.contours[s.sel.c]?.anchors[s.sel.i] : undefined;
  if (selected) drawAnchorHandles(res, canvas, selected, camera);
  s.contours.forEach((c, ci) =>
    c.anchors.forEach((a, i) => {
      const isSel = s.sel?.c === ci && s.sel.i === i;
      const isHover = s.hover?.c === ci && s.hover.i === i;
      drawAnchorMarker(res, canvas, a.p, camera, { filled: isSel, hot: isHover && !isSel });
    }),
  );
};
