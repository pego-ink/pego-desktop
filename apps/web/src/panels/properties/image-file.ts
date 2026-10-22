/** Longest side of an embedded image; larger pictures are scaled down on import. */
export const MAX_IMAGE_SIDE = 2048;
const MAX_EMBED_BYTES = 3 * 1024 * 1024;
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const readAsDataUri = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * A picked image file as a base64 data URI for an image fill. Files that are small, embeddable
 * and within MAX_IMAGE_SIDE are kept byte for byte; others are re-encoded (JPEG stays JPEG,
 * everything else becomes PNG) at most MAX_IMAGE_SIDE on the long edge.
 */
export const imageFileToDataUri = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (EMBEDDABLE.has(file.type) && file.size <= MAX_EMBED_BYTES && longest <= MAX_IMAGE_SIDE) {
      return await readAsDataUri(file);
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2D is not available");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return file.type === "image/jpeg"
      ? canvas.toDataURL("image/jpeg", 0.9)
      : canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
};

/** Opens the file picker for one image; resolves null when cancelled. */
export const pickImageFile = () =>
  new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
