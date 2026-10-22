import { create } from "zustand";

type LayerEvents = {
  /** Bumped when something outside the document/camera changed how the document draws. */
  version: number;
  invalidate: () => void;
};

/**
 * The canvas caches the rendered document layer. Async inputs the layer depends on (decoded
 * images) call `invalidate()` so the cache is rebuilt; fonts use `useFontEvents`.
 */
export const useLayerEvents = create<LayerEvents>((set) => ({
  version: 0,
  invalidate: () => set((state) => ({ version: state.version + 1 })),
}));
