import { maskToAlpha, MODEL_SIZE, toInputTensor } from "./mask";
import { loadModelBytes, type DownloadProgress } from "./model";

/**
 * Background removal on this device: the image is scaled to the model's 320 px input, the worker
 * returns a saliency mask, and the mask becomes the alpha channel of the image at full size.
 */

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (mask: Float32Array) => void; reject: (e: Error) => void }
>();

const startWorker = (onProgress?: DownloadProgress): Promise<void> => {
  ready ??= (async () => {
    const model = await loadModelBytes(onProgress);
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (
      event: MessageEvent<{ id: number; mask?: Float32Array; error?: string }>,
    ) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.mask) job.resolve(event.data.mask);
      else job.reject(new Error(event.data.error ?? "The background model failed."));
    };
    worker.postMessage({ model }, [model]);
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
};

const runModel = (input: Float32Array): Promise<Float32Array> =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, input }, [input.buffer]);
  });

/** `bitmap` with its background removed, as a PNG blob at the same size. */
export const removeBackgroundLocally = async (
  bitmap: ImageBitmap,
  onProgress?: DownloadProgress,
): Promise<Blob> => {
  await startWorker(onProgress);
  const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const smallContext = small.getContext("2d")!;
  smallContext.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const pixels = smallContext.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const mask = await runModel(toInputTensor(pixels));

  // The mask as a 320 px alpha image, scaled up smoothly onto the full-size image.
  const alpha = maskToAlpha(mask);
  const maskCanvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const maskContext = maskCanvas.getContext("2d")!;
  const maskImage = maskContext.createImageData(MODEL_SIZE, MODEL_SIZE);
  for (let i = 0; i < alpha.length; i++) maskImage.data[i * 4 + 3] = alpha[i]!;
  maskContext.putImageData(maskImage, 0, 0);

  const out = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = out.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(maskCanvas, 0, 0, bitmap.width, bitmap.height);
  context.globalCompositeOperation = "source-in";
  context.drawImage(bitmap, 0, 0);
  return out.convertToBlob({ type: "image/png" });
};
