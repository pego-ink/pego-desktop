import { hex } from "./mask";

/**
 * The on-device background model: Silueta (a compact U²-Net, Apache-2.0), downloaded once from a
 * pinned Hugging Face revision, checked against its SHA-256 and kept in the Cache API.
 */
export const BACKGROUND_MODEL = {
  name: "Silueta",
  url: "https://huggingface.co/jellybox/silueta/resolve/e7790d0bfdea4b12877cf4189cf9c1a2e97401c9/silueta_320.onnx",
  sha256: "75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb",
  bytes: 44_173_029,
} as const;

const CACHE_NAME = "pego-models-v1";

export type DownloadProgress = (loaded: number, total: number) => void;

const matchesChecksum = async (bytes: ArrayBuffer): Promise<boolean> =>
  hex(await crypto.subtle.digest("SHA-256", bytes)) === BACKGROUND_MODEL.sha256;

const openCache = async (): Promise<Cache | null> => {
  try {
    return "caches" in globalThis ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
};

/** Whether the model is already downloaded (so the first run can say it downloads 44 MB). */
export const modelIsCached = async (): Promise<boolean> =>
  Boolean(await (await openCache())?.match(BACKGROUND_MODEL.url));

const download = async (onProgress?: DownloadProgress): Promise<ArrayBuffer> => {
  let response: Response;
  try {
    response = await fetch(BACKGROUND_MODEL.url);
  } catch (error) {
    throw new Error("Could not download the background model. Check the connection.", {
      cause: error,
    });
  }
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the background model (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get("content-length")) || BACKGROUND_MODEL.bytes;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(BACKGROUND_MODEL.bytes);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > bytes.length) {
      throw new Error("The background model is larger than expected; it was not used.");
    }
    bytes.set(value, loaded);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  return bytes.buffer.slice(0, loaded);
};

/** The model's bytes, from the cache or downloaded (and then cached). Rejects with a message. */
export const loadModelBytes = async (onProgress?: DownloadProgress): Promise<ArrayBuffer> => {
  const cache = await openCache();
  const cached = await cache?.match(BACKGROUND_MODEL.url);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (await matchesChecksum(bytes)) return bytes;
    await cache?.delete(BACKGROUND_MODEL.url);
  }
  const bytes = await download(onProgress);
  if (!(await matchesChecksum(bytes))) {
    throw new Error("The downloaded background model did not match its checksum; it was not used.");
  }
  await cache?.put(BACKGROUND_MODEL.url, new Response(bytes.slice(0))).catch(() => undefined);
  return bytes;
};
