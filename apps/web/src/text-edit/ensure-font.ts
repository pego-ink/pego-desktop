let loading: Promise<void> | null = null;

/** Register the bundled Inter TTF as a CSS font so DOM text matches the CanvasKit font. */
export const ensureInterFont = (): Promise<void> => {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  loading ??= (async () => {
    if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === "Inter")) return;
    const face = new FontFace("Inter", "url(/fonts/Inter.ttf)", { weight: "100 900" });
    document.fonts.add(await face.load());
  })().catch(() => {
    loading = null;
  });
  return loading;
};
