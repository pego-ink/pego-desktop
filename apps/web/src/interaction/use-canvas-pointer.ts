import { useEffect, type RefObject } from "react";
import { createId, findNode, type Box, type Op, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { isTextEditing, useTextEditStore } from "@/store/use-text-edit-store";
import { isDrawTool, useToolStore, type Tool } from "@/store/use-tool-store";
import { getToolHandler, type ToolPointer, type ToolSession } from "@/interaction/tool-handlers";
import "@/interaction/tools";
import {
  clickBox,
  createLabel,
  createNodeOp,
  drawBox,
  drawUpdateOps,
  resolvePlacement,
  toParentSpace,
  type DrawTool,
  type Placement,
} from "@/interaction/create-node";
import { applyAll, duplicateOps } from "@/interaction/duplicate";
import { hitPath } from "@/interaction/hit-test";
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
import { enterPathEdit } from "@/interaction/tools/pen";

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
  | { kind: "marquee"; startDocX: number; startDocY: number; base: string[] }
  | {
      kind: "draw";
      tool: DrawTool;
      id: string;
      startX: number;
      startY: number;
      start: { x: number; y: number };
      placement: Placement;
      started: boolean;
    }
  | { kind: "text"; placement: Placement; point: { x: number; y: number } }
  | { kind: "tool"; session: ToolSession };

const setTool = (tool: Tool) => useToolStore.getState().setTool(tool);

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
    const toolPointer = (e: PointerEvent | MouseEvent): ToolPointer => {
      const screen = local(e);
      return {
        screen,
        doc: toDoc(screen.x, screen.y),
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey || e.ctrlKey,
        pressure: "pressure" in e ? e.pressure : 0.5,
        pointerType: "pointerType" in e ? e.pointerType : "mouse",
      };
    };

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
      const tool = useToolStore.getState().tool;
      const panRequested =
        e.button === 1 ||
        (e.button === 0 && (useInteractionState.getState().spaceDown || tool === "hand"));
      if (panRequested) {
        e.preventDefault();
        gesture = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
        element.setPointerCapture(e.pointerId);
        ui.set({ panning: true });
        return;
      }
      if (e.button !== 0) return;
      // While the text editor is open the overlay owns confirm-on-blur; no new gesture starts.
      if (isTextEditing()) return;
      element.setPointerCapture(e.pointerId);

      const handler = getToolHandler(tool);
      if (handler) {
        const session = handler.begin(toolPointer(e));
        if (session) gesture = { kind: "tool", session };
        return;
      }

      if (isDrawTool(tool) || tool === "text") {
        const start = toDoc(p.x, p.y);
        const placement = resolvePlacement(
          state.doc,
          getLayout(state.doc),
          hitPath(state.doc, getLayout(state.doc), start.x, start.y),
        );
        gesture = isDrawTool(tool)
          ? {
              kind: "draw",
              tool,
              id: createId(),
              startX: p.x,
              startY: p.y,
              start,
              placement,
              started: false,
            }
          : { kind: "text", placement, point: start };
        return;
      }

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
      if (useToolStore.getState().tool !== "select") {
        if (useDocumentStore.getState().hoveredId) useDocumentStore.getState().setHovered(null);
        return;
      }
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
        const hover = getToolHandler(useToolStore.getState().tool)?.hover;
        if (hover) hover(toolPointer(e));
        else updateHover(e);
        return;
      }
      if (gesture.kind === "tool") {
        gesture.session.move(toolPointer(e));
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

      if (gesture.kind === "text") return;

      if (gesture.kind === "draw") {
        if (
          !gesture.started &&
          Math.hypot(p.x - gesture.startX, p.y - gesture.startY) < DRAG_THRESHOLD
        )
          return;
        const box = drawBox(gesture.start, toDoc(p.x, p.y), { shift: e.shiftKey, alt: e.altKey });
        if (!gesture.started) {
          gesture.started = true;
          const ok = store.commit(
            [createNodeOp(store.doc, gesture.tool, gesture.id, gesture.placement, box)],
            { label: createLabel(gesture.tool) },
          );
          if (!ok) {
            endGesture();
            return;
          }
          store.select([gesture.id]);
          return;
        }
        if (!store.extendLast(drawUpdateOps(gesture.id, gesture.placement, box))) endGesture();
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

      const apply = (ops: Op[], label: string) => {
        if (ops.length === 0) return true;
        return first ? store.commit(ops, { label }) : store.extendLast(ops);
      };

      let ok: boolean;
      if (gesture.kind === "move") {
        // Alt+drag: the first change inserts copies in place and drags those instead.
        let copyOps: Op[] = [];
        if (first && e.altKey) {
          const plan = duplicateOps(gesture.startDoc, gesture.ids, 0);
          if (plan.ops.length > 0) {
            copyOps = plan.ops;
            gesture.startDoc = applyAll(gesture.startDoc, plan.ops);
            gesture.ids = plan.ids;
            gesture.collapseTo = null;
          }
        }
        const delta = e.shiftKey
          ? constrainAxis(screenDx / zoom, screenDy / zoom)
          : { dx: screenDx / zoom, dy: screenDy / zoom };
        ok = apply(
          [...copyOps, ...moveOps(gesture.startDoc, gesture.ids, delta.dx, delta.dy)],
          copyOps.length > 0 ? "Duplicate" : "Move",
        );
        if (ok && copyOps.length > 0) store.select(gesture.ids);
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

    /** Click-to-create and tool reset happen on pointer up (not on cancel). */
    const finishCreate = () => {
      const g = gesture;
      if (g?.kind === "draw") {
        const store = useDocumentStore.getState();
        if (!g.started) {
          const ok = store.commit(
            [createNodeOp(store.doc, g.tool, g.id, g.placement, clickBox(g.tool, g.start))],
            { label: createLabel(g.tool) },
          );
          if (ok) useDocumentStore.getState().select([g.id]);
        }
        setTool("select");
      } else if (g?.kind === "text") {
        const { x, y } = toParentSpace(g.placement, g.point.x, g.point.y);
        useTextEditStore.getState().start({ mode: "create", parentId: g.placement.parentId, x, y });
        setTool("select");
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      if (gesture?.kind === "tool") {
        if (e.type === "pointerup") gesture.session.up(toolPointer(e));
        else gesture.session.cancel();
        gesture = null;
        return;
      }
      if (e.type === "pointerup") finishCreate();
      endGesture();
    };

    const onPointerLeave = () => {
      if (!gesture) useDocumentStore.getState().setHovered(null);
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (isTextEditing()) return;
      const toolHandler = getToolHandler(useToolStore.getState().tool);
      if (toolHandler?.doubleClick?.(toolPointer(e))) return;
      if (useToolStore.getState().tool !== "select") return;
      const p = local(e);
      const state = useDocumentStore.getState();
      const d = toDoc(p.x, p.y);
      const path = hitPath(state.doc, getLayout(state.doc), d.x, d.y);
      const leafId = path?.[path.length - 1];
      // Pen tool: double-clicking a path enters its vector edit mode (see tools/pen.ts).
      if (leafId && findNode(state.doc, leafId)?.type === "path" && enterPathEdit(leafId)) return;
      if (leafId && findNode(state.doc, leafId)?.type === "text") {
        state.select([leafId]);
        useTextEditStore.getState().start({ mode: "edit", id: leafId });
        return;
      }
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
