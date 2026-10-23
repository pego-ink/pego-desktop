import { NORMALIZED_MAX_SIDE, fitScale } from "./snapshot-images";

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("the image could not be decoded"));
    img.src = src;
  });

/**
 * Redraws a data URL Pego cannot take (svg, avif, bmp...) through a canvas into webp (png when
 * the browser has no webp encoder), long side capped at 2560 px. Needs a DOM.
 */
export const normalizeImageDataUrl = async (dataUrl: string): Promise<string> => {
  const img = await loadImage(dataUrl);
  // An svg without intrinsic size reports 0 (or the 300x150 default): give it a usable raster.
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || 1024;
  const scale = fitScale(width, height, NORMALIZED_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas available");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
};
