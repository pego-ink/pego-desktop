import { create } from "zustand";
import { invalidateLayout } from "@/canvas/layout";

type FontEvents = {
  /** Increments whenever a font face finishes loading into CanvasKit. */
  version: number;
  /** Call after registering a new face: text metrics changed, so layouts and the canvas refresh. */
  fontsChanged: () => void;
};

export const useFontEvents = create<FontEvents>((set) => ({
  version: 0,
  fontsChanged: () => {
    invalidateLayout();
    set((state) => ({ version: state.version + 1 }));
  },
}));
