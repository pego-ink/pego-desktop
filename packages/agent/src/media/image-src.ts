/** Validation for image sources placed on the canvas (https URLs and data:image URLs). */

/** Max length of a data URL string (about 3.7 MB of image bytes once base64-decoded). */
export const MAX_DATA_URL_LENGTH = 5 * 1024 * 1024;
export const MAX_URL_LENGTH = 2048;

/** SVG is excluded on purpose: it can carry scripts. Vector art goes through insert_svg. */
const DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/i;

export class ImageSrcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageSrcError";
  }
}

/** Returns the normalized source or throws ImageSrcError with a message the model can act on. */
export const validateImageSrc = (raw: string): string => {
  const src = raw.trim();
  if (src.length === 0) throw new ImageSrcError("src is empty");
  if (/^data:/i.test(src)) {
    if (src.length > MAX_DATA_URL_LENGTH) {
      throw new ImageSrcError(
        `data URL is larger than ${MAX_DATA_URL_LENGTH / (1024 * 1024)} MB; use a smaller image or an https URL`,
      );
    }
    if (!DATA_URL.test(src)) {
      throw new ImageSrcError(
        "data URLs must be base64 data:image/png, jpeg, gif, webp or avif (SVG data URLs are not allowed; use insert_svg for vectors)",
      );
    }
    return src;
  }
  if (src.length > MAX_URL_LENGTH) throw new ImageSrcError("URL is too long");
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    throw new ImageSrcError("src is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new ImageSrcError("only https URLs and data:image URLs are allowed");
  }
  if (url.username || url.password)
    throw new ImageSrcError("URLs with credentials are not allowed");
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new ImageSrcError("URLs pointing at local or private hosts are not allowed");
  }
  return url.href;
};
