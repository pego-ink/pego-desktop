import type { ImageFill } from "./schema";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Start and end of a linear gradient across a `width` x `height` box, the way CSS
 * `linear-gradient(<angle>deg, ...)` places them: through the center, long enough that the
 * corners hit the 0 and 1 stops. 0 degrees points up, 90 right.
 */
export const linearGradientPoints = (
  angle: number,
  width: number,
  height: number,
): { start: Point; end: Point } => {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return {
    start: { x: cx - dx * half, y: cy - dy * half },
    end: { x: cx + dx * half, y: cy + dy * half },
  };
};

/**
 * Where an image of `imageWidth` x `imageHeight` lands in a box, like CSS `background-size`
 * (centered): cover fills and crops, contain fits inside, stretch distorts to the box.
 */
export const imageFitRect = (
  fit: ImageFill["fit"],
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number,
): Rect => {
  if (fit === "stretch" || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width, height };
  }
  const sx = width / imageWidth;
  const sy = height / imageHeight;
  const scale = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
};
