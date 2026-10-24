import { useEffect, type RefObject } from "react";
import { createId, findNode, type Op, type PegoDocument } from "@pego/doc";
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
import {
  childrenAmong,
  insertionLine,
  planDrag,
  sameSegment,
  type Segment,
} from "@/interaction/drag-target";
import { hitPath, HIT_TOLERANCE_PX } from "@/interaction/hit-test";
import { pickOnCanvas } from "./pick-on-canvas";
import { useSettingsStore } from "@/store/use-settings-store";
import { wheelAction } from "@/interaction/wheel-behavior";
import { snapEnabled } from "@/interaction/snap";
import { isDiscreteWheel, wheelNotchFactor } from "@/interaction/camera";
import { useInteractionState } from "@/interaction/interaction-state";
import {
  drillTarget,
  marqueeSelect,
  normalizeRect,
  toggleSelection,
} from "@/interaction/selection";
import { constrainAxis, resizeOps, type Handle } from "@/interaction/transform";
import {
  frameHandleCursor,
  getSelectionFrame,
  hitFrameHandle,
  resizeFrame,
  toScreenMatrix,
  type SelectionFrame,
} from "@/interaction/selection-frame";
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
      /** Whether the drag's undo step exists yet (a reorder can start with no ops). */
      committed: boolean;
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
      /** Start-state placement of the node (rotation of the node and its ancestors included). */
      frame: SelectionFrame;
      started: boolean;
      committed: boolean;
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

/** The handle under the screen point on the single selected node (rotation-aware), if any. */
const handleAt = (
  x: number,
  y: number,
): { id: string; frame: SelectionFrame; handle: Handle } | null => {
  const { doc, selection } = useDocumentStore.getState();
  const [id] = selection;
  if (selection.length !== 1 || !id) return null;
  const frame = getSelectionFrame(doc, getLayout(doc), id);
  if (!frame) return null;
  const screen = toScreenMatrix(useViewportStore.getState().camera, frame.matrix);
  const handle = hitFrameHandle(screen, frame.box.width, frame.box.height, x, y, HANDLE_HIT_RADIUS);
  return handle ? { id, frame, handle } : null;
};

/** Resize cursor for a handle, rotated with the node. */
const cursorFor = (frame: SelectionFrame, handle: Handle): string =>
  frameHandleCursor(toScreenMatrix(useViewportStore.getState().camera, frame.matrix), handle);

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
    /** Screen-space click tolerance in document units. */
    const hitTolerance = () => HIT_TOLERANCE_PX / useViewportStore.getState().camera.zoom;
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
      const action = wheelAction(useSettingsStore.getState().wheelBehavior, e);
      if (action === "zoom") {
        const p = local(e);
        // Notched wheels ease toward a clamped step; trackpad pinch stays 1:1.
        if (isDiscreteWheel(e)) viewport.wheelZoomBy(wheelNotchFactor(dy), p.x, p.y);
        else viewport.zoomBy(Math.exp(-dy * 0.01), p.x, p.y);
        return;
      }
      // Shift+wheel: browsers may already report the delta as deltaX, otherwise use deltaY.
      if (action === "pan-horizontal") viewport.panBy(-(dx || dy), 0);
      else viewport.panBy(-dx, -dy);
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
          hitPath(state.doc, getLayout(state.doc), start.x, start.y, { pageId: state.pageId }),
          state.pageId,
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

      const grabbed = handleAt(p.x, p.y);
      if (grabbed) {
        gesture = {
          kind: "resize",
          handle: grabbed.handle,
          startX: p.x,
          startY: p.y,
          startDoc: state.doc,
          id: grabbed.id,
          frame: grabbed.frame,
          started: false,
          committed: false,
        };
        ui.set({ handleCursor: cursorFor(grabbed.frame, grabbed.handle) });
        return;
      }

      const d = toDoc(p.x, p.y);
      // A frame's caption picks the frame itself (its body picks what is inside).
      const hit = pickOnCanvas(
        state,
        getLayout(state.doc),
        useViewportStore.getState().camera,
        p,
        isDeep(e),
      );

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
        committed: false,
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
      const grabbed = handleAt(p.x, p.y);
      const handle = grabbed?.handle ?? null;
      const cursor = grabbed ? cursorFor(grabbed.frame, grabbed.handle) : null;
      if (useInteractionState.getState().handleCursor !== cursor) ui.set({ handleCursor: cursor });
      const hit = handle
        ? null
        : pickOnCanvas(
            state,
            getLayout(state.doc),
            useViewportStore.getState().camera,
            p,
            isDeep(e),
          );
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
        // One move per coalesced sample: freehand strokes keep the hardware's full sample rate.
        const samples = e.getCoalescedEvents?.() ?? [];
        if (samples.length === 0) gesture.session.move(toolPointer(e));
        for (const sample of samples) gesture.session.move(toolPointer(sample));
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
        const box = drawBox(gesture.start, toDoc(p.x, p.y), {
          shift: e.shiftKey,
          alt: e.altKey,
          snap: snapEnabled(),
        });
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
        const hits = marqueeSelect(store.doc, getLayout(store.doc), rect, store.pageId);
        store.select([...new Set([...gesture.base, ...hits])]);
        return;
      }

      const screenDx = p.x - gesture.startX;
      const screenDy = p.y - gesture.startY;
      if (!gesture.started && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
      const first = !gesture.started;
      gesture.started = true;
      if (store.hoveredId) store.setHovered(null);

      const active = gesture;
      const apply = (ops: Op[], label: string) => {
        if (ops.length === 0 || (active.kind !== "move" && active.kind !== "resize")) return true;
        // Only the first non-empty change opens the undo step; later ones fold into it.
        const opened = active.committed;
        active.committed = true;
        return opened ? store.extendLast(ops) : store.commit(ops, { label });
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
        // On the duplicate frame the copies are not in the store yet; startDoc already has them.
        const current = copyOps.length > 0 ? gesture.startDoc : store.doc;
        const plan = planDrag({
          startDoc: gesture.startDoc,
          startLayout: getLayout(gesture.startDoc),
          doc: current,
          layout: getLayout(current),
          ids: gesture.ids,
          point: toDoc(p.x, p.y),
          dx: delta.dx,
          dy: delta.dy,
          snap: snapEnabled(),
        });
        ok = apply([...copyOps, ...plan.ops], copyOps.length > 0 ? "Duplicate" : "Move");
        if (ok) showDropLine(plan.flexParentId, gesture.ids);
        if (ok && copyOps.length > 0) store.select(gesture.ids);
      } else {
        const next = resizeFrame(gesture.frame, gesture.handle, screenDx / zoom, screenDy / zoom, {
          shift: e.shiftKey,
          alt: e.altKey,
          snap: snapEnabled(),
        });
        ok = apply(
          resizeOps(
            gesture.startDoc,
            gesture.id,
            gesture.frame.box,
            next,
            snapEnabled(),
            getLayout(gesture.startDoc),
          ),
          "Resize",
        );
      }
      if (!ok) endGesture();
    };

    /** Show the auto-layout insertion line for `ids` after the latest drag ops, or clear it. */
    const showDropLine = (flexParentId: string | null, ids: readonly string[]) => {
      const { doc } = useDocumentStore.getState();
      const line: Segment | null = flexParentId
        ? insertionLine(doc, getLayout(doc), flexParentId, childrenAmong(doc, flexParentId, ids))
        : null;
      if (!sameSegment(useInteractionState.getState().dropLine, line)) ui.set({ dropLine: line });
    };

    const endGesture = () => {
      const g = gesture;
      gesture = null;
      ui.set({ panning: false, marquee: null, handleCursor: null, dropLine: null });
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
      const path = hitPath(state.doc, getLayout(state.doc), d.x, d.y, {
        tolerance: hitTolerance(),
        pageId: state.pageId,
      });
      const leafId = path?.[path.length - 1];
      // Pen tool: double-clicking a path enters its vector edit mode (see tools/pen.ts).
      if (leafId && findNode(state.doc, leafId)?.type === "path" && enterPathEdit(leafId)) return;
      if (leafId && findNode(state.doc, leafId)?.type === "text") {
        state.select([leafId]);
        useTextEditStore.getState().start({ mode: "edit", id: leafId });
        return;
      }
      const target = drillTarget(state.doc, getLayout(state.doc), d.x, d.y, state.selection, {
        pageId: state.pageId,
      });
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
