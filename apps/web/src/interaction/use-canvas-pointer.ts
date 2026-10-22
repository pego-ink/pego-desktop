import { useEffect, type RefObject } from "react";
import { type Box, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { useInteractionState } from "@/interaction/interaction-state";
import {
  drillTarget,
  marqueeSelect,
  normalizeRect,
  pickAt,
  toggleSelection,
} from "@/interaction/selection";
import {
  constrainAxis,
  HANDLE_CURSORS,
  hitHandle,
  moveOps,
  resizeBox,
  resizeOps,
  type Handle,
} from "@/interaction/transform";
import { docToScreen } from "@/canvas/types";

const DRAG_THRESHOLD = 3;
const HANDLE_HIT_RADIUS = 6;

type Gesture =
  | { kind: "pan"; lastX: number; lastY: number }
  | {
      kind: "move";
      startX: number;
      startY: number;
      startDoc: PegoDocument;
      ids: string[];
      started: boolean;
      /** Click without drag on a multi-selection collapses it to the clicked node. */
      collapseTo: string | null;
    }
  | {
      kind: "resize";
      handle: Handle;
      startX: number;
      startY: number;
      startDoc: PegoDocument;
      id: string;
      startBox: Box;
      started: boolean;
    }
  | { kind: "marquee"; startDocX: number; startDocY: number; base: string[] };

/** The single selected node's screen box, for handle hit-testing. */
const selectedScreenBox = (): { id: string; box: Box } | null => {
  const { doc, selection } = useDocumentStore.getState();
  const [id] = selection;
  if (selection.length !== 1 || !id) return null;
  const box = getLayout(doc).get(id);
  if (!box) return null;
  const { camera } = useViewportStore.getState();
  const topLeft = docToScreen(camera, box.x, box.y);
  return {
    id,
    box: { ...topLeft, width: box.width * camera.zoom, height: box.height * camera.zoom },
  };
};

/** Wire pointer + wheel interaction (pan, zoom, select, move, resize, marquee) to the canvas element. */
export const useCanvasPointer = (elementRef: RefObject<HTMLCanvasElement | null>) => {
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let gesture: Gesture | null = null;
    const ui = useInteractionState.getState();

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toDoc = (sx: number, sy: number) =>
      screenToDoc(useViewportStore.getState().camera, sx, sy);
    const isDeep = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const viewport = useViewportStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const p = local(e);
        viewport.zoomBy(Math.exp(-dy * 0.01), p.x, p.y);
        return;
      }
      viewport.panBy(-dx, -dy);
    };

    const onPointerDown = (e: PointerEvent) => {
      const p = local(e);
      const state = useDocumentStore.getState();
      const panRequested =
        e.button === 1 || (e.button === 0 && useInteractionState.getState().spaceDown);
      if (panRequested) {
        e.preventDefault();
        gesture = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
        element.setPointerCapture(e.pointerId);
        ui.set({ panning: true });
        return;
      }
      if (e.button !== 0) return;
      element.setPointerCapture(e.pointerId);

      const sel = selectedScreenBox();
      const handle = sel ? hitHandle(sel.box, p.x, p.y, HANDLE_HIT_RADIUS) : null;
      if (sel && handle) {
        const startBox = getLayout(state.doc).get(sel.id);
        if (startBox) {
          gesture = {
            kind: "resize",
            handle,
            startX: p.x,
            startY: p.y,
            startDoc: state.doc,
            id: sel.id,
            startBox,
            started: false,
          };
          ui.set({ handleCursor: HANDLE_CURSORS[handle] });
          return;
        }
      }

      const d = toDoc(p.x, p.y);
      const layout = getLayout(state.doc);
      const hit = pickAt(state.doc, layout, d.x, d.y, state.selection, isDeep(e));

      if (!hit) {
        if (!e.shiftKey) state.select([]);
        gesture = {
          kind: "marquee",
          startDocX: d.x,
          startDocY: d.y,
          base: e.shiftKey ? state.selection : [],
        };
        return;
      }
      if (e.shiftKey) {
        state.select(toggleSelection(state.selection, hit));
        return;
      }
      const inSelection = state.selection.includes(hit);
      const ids = inSelection ? state.selection : [hit];
      if (!inSelection) state.select(ids);
      gesture = {
        kind: "move",
        startX: p.x,
        startY: p.y,
        startDoc: state.doc,
        ids,
        started: false,
        collapseTo: inSelection && ids.length > 1 ? hit : null,
      };
    };

    const updateHover = (e: PointerEvent) => {
      const p = local(e);
      const state = useDocumentStore.getState();
      const sel = selectedScreenBox();
      const handle = sel ? hitHandle(sel.box, p.x, p.y, HANDLE_HIT_RADIUS) : null;
      const cursor = handle ? HANDLE_CURSORS[handle] : null;
      if (useInteractionState.getState().handleCursor !== cursor) ui.set({ handleCursor: cursor });
      const d = toDoc(p.x, p.y);
      const hit = handle
        ? null
        : pickAt(state.doc, getLayout(state.doc), d.x, d.y, state.selection, isDeep(e));
      if (state.hoveredId !== hit) state.setHovered(hit);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!gesture) {
        updateHover(e);
        return;
      }
      const p = local(e);
      const store = useDocumentStore.getState();
      const { zoom } = useViewportStore.getState().camera;

      if (gesture.kind === "pan") {
        useViewportStore.getState().panBy(e.clientX - gesture.lastX, e.clientY - gesture.lastY);
        gesture.lastX = e.clientX;
        gesture.lastY = e.clientY;
        return;
      }

      if (gesture.kind === "marquee") {
        const d = toDoc(p.x, p.y);
        const rect = normalizeRect(gesture.startDocX, gesture.startDocY, d.x, d.y);
        ui.set({ marquee: rect });
        const hits = marqueeSelect(store.doc, getLayout(store.doc), rect);
        store.select([...new Set([...gesture.base, ...hits])]);
        return;
      }

      const screenDx = p.x - gesture.startX;
      const screenDy = p.y - gesture.startY;
      if (!gesture.started && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
      const first = !gesture.started;
      gesture.started = true;
      if (store.hoveredId) store.setHovered(null);

      const apply = (ops: ReturnType<typeof moveOps>, label: string) => {
        if (ops.length === 0) return true;
        return first ? store.commit(ops, { label }) : store.extendLast(ops);
      };

      let ok: boolean;
      if (gesture.kind === "move") {
        const delta = e.shiftKey
          ? constrainAxis(screenDx / zoom, screenDy / zoom)
          : { dx: screenDx / zoom, dy: screenDy / zoom };
        ok = apply(moveOps(gesture.startDoc, gesture.ids, delta.dx, delta.dy), "Move");
      } else {
        const next = resizeBox(gesture.startBox, gesture.handle, screenDx / zoom, screenDy / zoom, {
          shift: e.shiftKey,
          alt: e.altKey,
        });
        ok = apply(resizeOps(gesture.startDoc, gesture.id, gesture.startBox, next), "Resize");
      }
      if (!ok) endGesture();
    };

    const endGesture = () => {
      const g = gesture;
      gesture = null;
      ui.set({ panning: false, marquee: null, handleCursor: null });
      if (g?.kind === "move" && !g.started && g.collapseTo) {
        useDocumentStore.getState().select([g.collapseTo]);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      endGesture();
    };

    const onPointerLeave = () => {
      if (!gesture) useDocumentStore.getState().setHovered(null);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const p = local(e);
      const state = useDocumentStore.getState();
      const d = toDoc(p.x, p.y);
      const target = drillTarget(state.doc, getLayout(state.doc), d.x, d.y, state.selection);
      if (target) state.select([target]);
    };

    const preventMiddleScroll = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("mousedown", preventMiddleScroll);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("mousedown", preventMiddleScroll);
      ui.set({ panning: false, marquee: null, handleCursor: null });
    };
  }, [elementRef]);
};
