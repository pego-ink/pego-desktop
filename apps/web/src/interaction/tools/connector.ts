// Connector tool: press on a layer, drag to another and release to connect them with a line that
// follows both (wireflows). Screens by default; hold ⌘/Ctrl to attach to a button or card inside.
import {
  CONNECTOR_DEFAULT_STROKE,
  connectorGeometry,
  type Box,
  type ConnectorGeometry,
} from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { strokePathWithExtras } from "@/canvas/render-path-extras";
import { connectEndAt, connectOp } from "@/interaction/connector-target";
import { HIT_TOLERANCE_PX } from "@/interaction/hit-test";
import {
  registerToolHandler,
  useToolPreview,
  type ToolHandler,
  type ToolPointer,
} from "@/interaction/tool-handlers";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";

const TARGET_COLOR = "#7C5CFF";

type Drag = { from: string; fromBox: Box; to: string | null; toBox: Box | null; point: Box };

let active: Drag | null = null;

const endAt = (p: ToolPointer): { id: string; box: Box } | null => {
  const { doc, pageId } = useDocumentStore.getState();
  const layout = getLayout(doc);
  const zoom = useViewportStore.getState().camera.zoom;
  const id = connectEndAt(doc, layout, p.doc, {
    deep: p.metaKey,
    pageId,
    tolerance: HIT_TOLERANCE_PX / zoom,
  });
  const box = id ? layout.get(id) : undefined;
  return id && box ? { id, box } : null;
};

const clear = () => {
  active = null;
  useToolPreview.getState().invalidate();
};

/** The line being dragged: to the target layer when over one, else to the pointer. */
const previewGeometry = (drag: Drag): ConnectorGeometry =>
  connectorGeometry(drag.fromBox, drag.to !== null && drag.toBox ? drag.toBox : drag.point);

const handler: ToolHandler = {
  cursor: "crosshair",
  begin: (p) => {
    const start = endAt(p);
    if (!start) return null;
    const drag: Drag = {
      from: start.id,
      fromBox: start.box,
      to: null,
      toBox: null,
      point: { x: p.doc.x, y: p.doc.y, width: 0, height: 0 },
    };
    active = drag;
    const update = (next: ToolPointer) => {
      const target = endAt(next);
      drag.to = target && target.id !== drag.from ? target.id : null;
      drag.toBox = drag.to ? (target?.box ?? null) : null;
      drag.point = { x: next.doc.x, y: next.doc.y, width: 0, height: 0 };
      useToolPreview.getState().invalidate();
    };
    return {
      move: update,
      up: (next) => {
        update(next);
        const to = drag.to;
        clear();
        if (!to) return;
        const state = useDocumentStore.getState();
        const made = connectOp(state.doc, activePage(state).id, drag.from, to);
        if (!made || !state.commit([made.op], { label: "Create connector" })) return;
        useDocumentStore.getState().select([made.id]);
        useToolStore.getState().setTool("select");
      },
      cancel: clear,
    };
  },
  onKeyDown: (e) => {
    if (e.key !== "Escape" || !active) return false;
    clear();
    return true;
  },
  deactivate: clear,
  renderOverlay: (res, canvas, camera) => {
    if (!active) return;
    const { ck } = res;
    const geometry = previewGeometry(active);
    const path = ck.Path.MakeFromSVGString(geometry.d);
    if (!path) return;
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(ck.PaintStyle.Stroke);
    canvas.save();
    canvas.translate(camera.panX, camera.panY);
    canvas.scale(camera.zoom, camera.zoom);
    // The layers being connected, outlined like a hover.
    paint.setColor(ck.parseColorString(TARGET_COLOR));
    paint.setStrokeWidth(2 / camera.zoom);
    for (const box of [active.fromBox, active.toBox]) {
      if (box) canvas.drawRect(ck.XYWHRect(box.x, box.y, box.width, box.height), paint);
    }
    // The line as it will be drawn.
    const width = CONNECTOR_DEFAULT_STROKE.width;
    paint.setColor(ck.parseColorString(CONNECTOR_DEFAULT_STROKE.color));
    paint.setStrokeWidth(width);
    strokePathWithExtras(
      ck,
      canvas,
      path,
      paint,
      { strokeCap: "round", strokeJoin: "round", endMarker: "arrow" },
      width,
    );
    canvas.restore();
    paint.delete();
    path.delete();
  },
};

registerToolHandler("connector", handler);
