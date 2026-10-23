import { session } from "electron";
import {
  isDeclaredSizeOk,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_REDIRECTS,
  parseImageContentType,
  parseImageUrl,
  resolveRedirect,
} from "@/browser-image";

const PARTITION = "persist:pego-browser";
const TIMEOUT_MS = 15_000;

const readLimited = async (response: Response, controller: AbortController): Promise<Buffer> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      controller.abort();
      throw new Error("Image is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};

/** Downloads an http(s) image with the browser view's session and returns a data: URL. */
export const fetchImageAsDataUrl = async (url: string, referrer: string): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const ses = session.fromPartition(PARTITION);
    const headers = parseImageUrl(referrer) ? { Referer: referrer } : undefined;
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const response = await ses.fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers,
      });
      if (response.status >= 300 && response.status < 400) {
        if (hop >= MAX_IMAGE_REDIRECTS) throw new Error("Too many redirects");
        const next = resolveRedirect(response.headers.get("location"), current);
        if (!next) throw new Error("Redirect to a disallowed URL");
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`Image request failed (${response.status})`);
      const type = parseImageContentType(response.headers.get("content-type"));
      if (!type) throw new Error("Response is not an image");
      if (!isDeclaredSizeOk(response.headers.get("content-length")))
        throw new Error("Image is too large");
      const bytes = await readLimited(response, controller);
      return `data:${type};base64,${bytes.toString("base64")}`;
    }
  } finally {
    clearTimeout(timer);
  }
};
