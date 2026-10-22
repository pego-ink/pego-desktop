import type { Canvas as SkCanvas, CanvasKit, Paint } from "canvaskit-wasm";
import type { Box, Layout } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { docToScreen, type Camera } from "@/canvas/types";
import { HANDLES, handlePoint } from "@/interaction/transform";

export const ACCENT = "#B79CFF";
const LABEL_TEXT = "#141418";
const HANDLE_SIZE = 8;

export type OverlayState = {
  layout: Layout;
  camera: Camera;
  selection: readonly string[];
  hoveredId: string | null;
  /** Marquee in document coordinates. */
  marquee: Box | null;
  /** Nodes the agent is working on right now (empty when no run is active). */
  agentFocusIds?: readonly string[];
};

const toScreenBox = (camera: Camera, box: Box): Box => ({
  ...docToScreen(camera, box.x, box.y),
  width: box.width * camera.zoom,
  height: box.height * camera.zoom,
});

const withPaint = (ck: CanvasKit, setup: (paint: Paint) => void, draw: (paint: Paint) => void) => {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  try {
    setup(paint);
    draw(paint);
  } finally {
    paint.delete();
  }
};

const strokeRect = (ck: CanvasKit, canvas: SkCanvas, box: Box, color: string, width: number) =>
  withPaint(
    ck,
    (p) => {
      p.setStyle(ck.PaintStyle.Stroke);
      p.setStrokeWidth(width);
      p.setColor(ck.parseColorString(color));
    },
    (p) => canvas.drawRect(ck.XYWHRect(box.x, box.y, box.width, box.height), p),
  );

const fillRect = (ck: CanvasKit, canvas: SkCanvas, box: Box, color: string) =>
  withPaint(
    ck,
    (p) => {
      p.setStyle(ck.PaintStyle.Fill);
      p.setColor(ck.parseColorString(color));
    },
    (p) => canvas.drawRect(ck.XYWHRect(box.x, box.y, box.width, box.height), p),
  );

const drawHandles = (ck: CanvasKit, canvas: SkCanvas, box: Box) => {
  for (const handle of HANDLES) {
    const c = handlePoint(box, handle);
    const rect = {
      x: c.x - HANDLE_SIZE / 2,
      y: c.y - HANDLE_SIZE / 2,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    };
    fillRect(ck, canvas, rect, "#FFFFFF");
    strokeRect(ck, canvas, rect, ACCENT, 1.5);
  }
};

const drawSizeLabel = (res: CanvasKitResources, canvas: SkCanvas, box: Box, docBox: Box) => {
  const { ck, fontMgr, fontFamily } = res;
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(LABEL_TEXT),
      fontFamilies: [fontFamily],
      fontSize: 11,
      fontStyle: { weight: { value: 600 } },
    },
  });
  const builder = ck.ParagraphBuilder.Make(style, fontMgr);
  try {
    builder.addText(`${Math.round(docBox.width)} × ${Math.round(docBox.height)}`);
    const paragraph = builder.build();
    try {
      paragraph.layout(1000);
      const textW = paragraph.getLongestLine();
      const textH = paragraph.getHeight();
      const padX = 6;
      const padY = 3;
      const w = textW + padX * 2;
      const h = textH + padY * 2;
      const x = box.x + box.width / 2 - w / 2;
      const y = box.y + box.height + HANDLE_SIZE + 4;
      withPaint(
        ck,
        (p) => {
          p.setStyle(ck.PaintStyle.Fill);
          p.setColor(ck.parseColorString(ACCENT));
        },
        (p) => canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x, y, w, h), 4, 4), p),
      );
      canvas.drawParagraph(paragraph, x + padX, y + padY);
    } finally {
      paragraph.delete();
    }
  } finally {
    builder.delete();
  }
};

const dashedStrokeRect = (ck: CanvasKit, canvas: SkCanvas, box: Box, color: string) =>
  withPaint(
    ck,
    (p) => {
      p.setStyle(ck.PaintStyle.Stroke);
      p.setStrokeWidth(1.5);
      p.setColor(ck.parseColorString(color));
      p.setPathEffect(ck.PathEffect.MakeDash([5, 4], 0));
    },
    (p) => {
      try {
        canvas.drawRect(ck.XYWHRect(box.x, box.y, box.width, box.height), p);
      } finally {
        p.setPathEffect(null);
      }
    },
  );

/** Small "Agent" pill sitting on the top-left edge of a focused box. */
const drawAgentTag = (res: CanvasKitResources, canvas: SkCanvas, box: Box) => {
  const { ck, fontMgr, fontFamily } = res;
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: ck.parseColorString(LABEL_TEXT),
      fontFamilies: [fontFamily],
      fontSize: 10,
      fontStyle: { weight: { value: 600 } },
    },
  });
  const builder = ck.ParagraphBuilder.Make(style, fontMgr);
  try {
    builder.addText("Agent");
    const paragraph = builder.build();
    try {
      paragraph.layout(200);
      const w = paragraph.getLongestLine() + 12;
      const h = paragraph.getHeight() + 4;
      const x = box.x;
      const y = box.y - h - 3;
      withPaint(
        ck,
        (p) => {
          p.setStyle(ck.PaintStyle.Fill);
          p.setColor(ck.parseColorString(ACCENT));
        },
        (p) => canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x, y, w, h), 4, 4), p),
      );
      canvas.drawParagraph(paragraph, x + 6, y + 2);
    } finally {
      paragraph.delete();
    }
  } finally {
    builder.delete();
  }
};

const drawAgentFocus = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  layout: Layout,
  camera: Camera,
  ids: readonly string[],
) => {
  for (const id of ids) {
    const box = layout.get(id);
    if (!box) continue;
    const screen = toScreenBox(camera, box);
    fillRect(res.ck, canvas, screen, "#B79CFF14");
    dashedStrokeRect(res.ck, canvas, screen, ACCENT);
    drawAgentTag(res, canvas, screen);
  }
};

/** Editor chrome in screen space (CSS px; the caller applies the device pixel ratio). */
export const renderOverlay = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  { layout, camera, selection, hoveredId, marquee, agentFocusIds }: OverlayState,
) => {
  const { ck } = res;

  if (agentFocusIds && agentFocusIds.length > 0)
    drawAgentFocus(res, canvas, layout, camera, agentFocusIds);

  if (hoveredId && !selection.includes(hoveredId)) {
    const box = layout.get(hoveredId);
    if (box) strokeRect(ck, canvas, toScreenBox(camera, box), ACCENT, 1);
  }

  for (const id of selection) {
    const box = layout.get(id);
    if (box) strokeRect(ck, canvas, toScreenBox(camera, box), ACCENT, 1.5);
  }

  const [only] = selection;
  const single = selection.length === 1 && only ? layout.get(only) : undefined;
  if (single) {
    const screen = toScreenBox(camera, single);
    drawHandles(ck, canvas, screen);
    drawSizeLabel(res, canvas, screen, single);
  }

  if (marquee) {
    const screen = toScreenBox(camera, marquee);
    fillRect(ck, canvas, screen, "#B79CFF1A");
    strokeRect(ck, canvas, screen, ACCENT, 1);
  }
};
