import { MAX_DATA_URL_LENGTH } from "@pego/agent";
import { removeBackgroundLocally } from "./local-engine";
import type { DownloadProgress } from "./model";
import { removeBackgroundWithProvider } from "./provider-engine";

export { BACKGROUND_MODEL, modelIsCached } from "./model";
export { providerRemovalAvailable } from "./provider-engine";

/** "standard": on this device (Silueta). "high": the user's gpt-image model. */
export type RemovalQuality = "standard" | "high";

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the image"));
    reader.readAsDataURL(blob);
  });

/**
 * A base64 data URL's bytes. Decoded by hand: the desktop app's CSP has no `data:` in
 * connect-src, so `fetch(dataUrl)` is refused there.
 */
export const dataUrlToBlob = (dataUrl: string): Blob => {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("That image cannot be read.");
  const bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
};

const sourceBlob = async (src: string): Promise<Blob> => {
  if (src.startsWith("data:")) return dataUrlToBlob(src);
  const { imageUrlAsDataUrl } = await import("@/images/image-from-url");
  return dataUrlToBlob(await imageUrlAsDataUrl(src));
};

/** An image (with transparency) small enough to embed: PNG, else WebP, else scaled down. */
const embeddable = async (image: Blob): Promise<string> => {
  const png = await blobToDataUrl(image);
  if (png.length <= MAX_DATA_URL_LENGTH) return png;
  const bitmap = await createImageBitmap(image);
  for (let scale = 1; scale >= 0.25; scale /= 1.5) {
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = await blobToDataUrl(
      await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }),
    );
    if (webp.length <= MAX_DATA_URL_LENGTH) return webp;
  }
  throw new Error("The cut-out image is too large to keep in the file.");
};

/**
 * `src` (a data URL or https image) with its background removed, as a data URL with
 * transparency. `onProgress` reports the one-time model download (standard quality).
 */
export const removeBackground = async (
  src: string,
  quality: RemovalQuality = "standard",
  onProgress?: DownloadProgress,
): Promise<string> => {
  const blob = await sourceBlob(src);
  if (quality === "high") {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const result = await removeBackgroundWithProvider(
      await canvas.convertToBlob({ type: "image/png" }),
    );
    return embeddable(dataUrlToBlob(result));
  }
  return embeddable(await removeBackgroundLocally(await createImageBitmap(blob), onProgress));
};
