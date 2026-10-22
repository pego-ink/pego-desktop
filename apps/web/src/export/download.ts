/** Save a blob through a temporary link; works in browsers and in Electron's renderer. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadText = (filename: string, text: string, mime = "text/plain"): void =>
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

/** Decode base64 into bytes (the renderer hands PNGs over as base64). */
export const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
