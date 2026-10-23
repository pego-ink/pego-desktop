import { toast } from "sonner";
import { bridgeHttpUrl } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { screenToDoc } from "@/canvas/types";
import { insertImageCentered, readImageFile } from "@/interaction/image-file";
import { useViewportStore } from "@/store/use-viewport-store";

/**
 * Images from the web, by URL: "From URL" in Assets › Images and pasting an image link (or an
 * image copied from a web page) on the canvas. The image is downloaded and embedded like a pasted
 * file. Most sites send no CORS headers, so when the editor cannot fetch the image itself the
 * local bridge does (its /fetch-image only fetches public https images; see the bridge).
 */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const TIMEOUT_MS = 25_000;

/** An https URL, or null. */
export const httpsUrl = (text: string): string | null => {
  const trimmed = text.trim();
  if (!/^https:\/\/\S+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
};

/** Text that is just a link to an image file (…/photo.jpg?w=800), or null. */
export const imageLinkFromText = (text: string): string | null => {
  const url = httpsUrl(text);
  return url && /\.(png|jpe?g|gif|webp|avif)$/i.test(new URL(url).pathname) ? url : null;
};

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * The image of HTML copied from a web page ("Copy image" puts `<img src="…">` there): its https
 * src when the HTML is just an image. HTML with text around it is a text paste, not an image.
 */
export const imageLinkFromHtml = (html: string): string | null => {
  const images = [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  if (images.length !== 1) return null;
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  if (text !== "") return null;
  return httpsUrl(decodeEntities(images[0]?.[2] ?? ""));
};

export type LoadImageDeps = {
  fetch?: typeof fetch;
  /** Whether the local bridge is there to fetch what CORS blocks. */
  bridgeConnected?: () => boolean;
  bridgeUrl?: (path: string) => string;
};

const asImage = async (response: Response, what: string): Promise<Blob> => {
  if (!response.ok) {
    const reason = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(reason || `${what} answered HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  const type = (response.headers.get("content-type") ?? blob.type).split(";")[0]!.trim();
  if (!IMAGE_TYPES.has(type)) throw new Error("That link is not an image.");
  return blob.type === type ? blob : new Blob([blob], { type });
};

/** The image at `url`: fetched by the editor, else through the bridge. */
export const loadImageFromUrl = async (url: string, deps: LoadImageDeps = {}): Promise<Blob> => {
  const doFetch = deps.fetch ?? fetch;
  const host = new URL(url).hostname;
  try {
    return await asImage(
      await doFetch(url, { mode: "cors", signal: AbortSignal.timeout(TIMEOUT_MS) }),
      host,
    );
  } catch (direct) {
    // Usually CORS ("Failed to fetch"); an answer that is not an image will not change.
    if (direct instanceof Error && direct.message === "That link is not an image.") throw direct;
    const connected = (deps.bridgeConnected ?? (() => useAgentStore.getState().bridge.connected))();
    if (!connected) {
      throw new Error(
        `${host} does not let other sites load its images. Start the Pego bridge (bun run dev, or the desktop app) to fetch it.`,
        { cause: direct },
      );
    }
    const viaBridge = (deps.bridgeUrl ?? bridgeHttpUrl)(
      `/fetch-image?url=${encodeURIComponent(url)}`,
    );
    let response: Response;
    try {
      response = await doFetch(viaBridge, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new Error("The Pego bridge did not answer.", { cause: error });
    }
    return asImage(response, host);
  }
};

/** File name for a downloaded image: the URL's last path part, else "image". */
export const fileNameFor = (url: string, type: string): string => {
  const last = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
  const clean = last.replace(/[^\w.\- ]+/g, "").slice(0, 80);
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(clean)) return clean;
  return `${clean || "image"}.${type.split("/")[1] ?? "png"}`;
};

/**
 * Download the image at `url` and place it like a pasted image file: centered on canvas point
 * (x, y) or the middle of the view. Toasts progress and errors; resolves whether it was placed.
 */
export const placeImageFromUrl = async (
  url: string,
  screen?: { x: number; y: number },
): Promise<boolean> => {
  const host = new URL(url).hostname;
  const progress = toast.loading(`Getting the image from ${host}…`);
  try {
    const blob = await loadImageFromUrl(url);
    const asset = await readImageFile(
      new File([blob], fileNameFor(url, blob.type), { type: blob.type }),
    );
    if (!asset) {
      toast.dismiss(progress);
      return false;
    }
    const { camera, size } = useViewportStore.getState();
    const point = screen ?? { x: size.width / 2, y: size.height / 2 };
    insertImageCentered(asset, screenToDoc(camera, point.x, point.y));
    toast.success(`Placed the image from ${host}`, { id: progress });
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not get that image.", {
      id: progress,
    });
    return false;
  }
};
