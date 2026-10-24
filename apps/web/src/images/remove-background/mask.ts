/**
 * The math around the background model (Silueta, a U²-Net): pixels in, a soft mask out. Pure, so
 * it is tested without a browser.
 */

/** The model's square input side, in px. */
export const MODEL_SIZE = 320;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/**
 * RGBA pixels of a `size` x `size` image as the model's input: planar RGB, scaled to 0..1 and
 * normalized with the ImageNet mean and deviation ([1, 3, size, size] row-major).
 */
export const toInputTensor = (rgba: Uint8ClampedArray, size = MODEL_SIZE): Float32Array => {
  const area = size * size;
  const tensor = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * area + i] =
        ((rgba[i * 4 + channel] ?? 0) / 255 - MEAN[channel]!) / STD[channel]!;
    }
  }
  return tensor;
};

/**
 * The model's saliency map as alpha (0 = background, 255 = subject), stretched to the full range
 * like the reference implementation (rembg) does.
 */
export const maskToAlpha = (mask: ArrayLike<number>): Uint8ClampedArray => {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  const range = high - low || 1;
  const alpha = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) alpha[i] = Math.round(((mask[i]! - low) / range) * 255);
  return alpha;
};

/** Hex of a SHA-256 digest. */
export const hex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
