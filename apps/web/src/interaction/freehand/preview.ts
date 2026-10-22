import type { Canvas as SkCanvas } from "canvaskit-wasm";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { strokePathWithExtras, type PathExtras } from "@/canvas/render-path-extras";
import type { Camera } from "@/canvas/types";
import { PATH_STROKE } from "@/interaction/freehand/create-path-node";
import type { FreehandPath } from "@/interaction/freehand/geometry";

/** Draw an in-progress path in the overlay exactly like the renderer will (same cap/join/markers). */
export const drawPathPreview = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  camera: Camera,
  shape: FreehandPath,
  extras: PathExtras,
): void => {
  const { ck } = res;
  const path = ck.Path.MakeFromSVGString(shape.geometry);
  if (!path) return;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setColor(ck.parseColorString(PATH_STROKE.color));
  paint.setStrokeWidth(PATH_STROKE.width);
  canvas.save();
  canvas.translate(camera.panX + shape.x * camera.zoom, camera.panY + shape.y * camera.zoom);
  canvas.scale(camera.zoom, camera.zoom);
  strokePathWithExtras(ck, canvas, path, paint, extras, PATH_STROKE.width);
  canvas.restore();
  paint.delete();
  path.delete();
};
