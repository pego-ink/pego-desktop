import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useViewportStore } from "@/store/use-viewport-store";

/**
 * The visible part of the canvas: the whole of it, or (floating panels) the area between the
 * panels. Overlays that belong to the view, like the toolbar, sit here so they stay clear of the
 * panels. Only its children take pointer events; the rest reaches the canvas.
 */
export const ViewStage = ({ children }: { children: ReactNode }) => {
  const { top, right, bottom, left } = useViewportStore(useShallow((s) => s.insets));
  return (
    <div
      // Above the floating layer: on a cramped canvas the tools win over the zoom control.
      className="pointer-events-none absolute z-30 [&>*]:pointer-events-auto"
      style={{ top, right, bottom, left }}
    >
      {children}
    </div>
  );
};
