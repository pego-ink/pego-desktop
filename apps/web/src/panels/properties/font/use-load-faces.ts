import { useCallback } from "react";
import { ensureFontFace } from "@/fonts/font-service";
import type { FontFaceSpec } from "@/fonts/types";

/** Fire-and-forget face loading for the faces a commit just selected (the canvas refreshes itself). */
export const useLoadFaces = () =>
  useCallback((faces: readonly FontFaceSpec[]) => {
    const unique = new Map(
      faces.map((face) => [`${face.family}|${face.weight}|${face.style}`, face]),
    );
    for (const face of unique.values()) ensureFontFace(face).catch(() => false);
  }, []);
