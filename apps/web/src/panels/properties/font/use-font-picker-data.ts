import { useEffect, useState } from "react";
import { loadFontCatalog } from "@/fonts/font-service";
import type { FontFamilyInfo } from "@/fonts/types";
import { loadRecent, pushRecent, saveRecent } from "@/panels/properties/font/font-utils";

const NO_FONTS: readonly FontFamilyInfo[] = [];

/** The Google Fonts catalog; empty until loaded (or when it cannot load). */
export const useFontCatalog = (): readonly FontFamilyInfo[] => {
  const [catalog, setCatalog] = useState(NO_FONTS);
  useEffect(() => {
    let cancelled = false;
    loadFontCatalog().then(
      (loaded) => !cancelled && setCatalog(loaded),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
};

/** Recently picked families, read once per picker open. */
export const useRecentFonts = (): readonly string[] => useState(loadRecent)[0];

export const rememberFont = (family: string) => saveRecent(pushRecent(loadRecent(), family));
