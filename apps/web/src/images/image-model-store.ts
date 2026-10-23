import { create } from "zustand";

/**
 * The image model the user picked for generating images (`imageModelKey` of a provider and
 * model), remembered on this device. Null: the first image model found is used.
 */
const KEY = "pego:image-model";

const read = (): string | null => {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    return value && value.length <= 400 ? value : null;
  } catch {
    return null;
  }
};

type ImageModelState = { preferred: string | null; setPreferred: (key: string | null) => void };

export const useImageModelStore = create<ImageModelState>((set) => ({
  preferred: read(),
  setPreferred: (preferred) => {
    try {
      if (preferred) globalThis.localStorage?.setItem(KEY, preferred);
      else globalThis.localStorage?.removeItem(KEY);
    } catch {
      // Best effort: the pick just won't survive a reload.
    }
    set({ preferred });
  },
}));

/** The picked image model now (for the generator, outside React). */
export const readPreferredImageModel = (): string | null => useImageModelStore.getState().preferred;
