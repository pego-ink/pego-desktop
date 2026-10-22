import * as React from "react";
import { cn } from "@pego/ui/lib/utils";

type ResizeHandleProps = {
  /** Current size in px (aria-valuenow). */
  value: number;
  min: number;
  max: number;
  /** Accessible name, e.g. "Resize left panel". */
  label: string;
  /** Which edge of the panel the handle sits on; "end" grows with pointer moving right. */
  edge?: "start" | "end";
  /** Called while dragging or on key press, with the proposed size. */
  onResize: (next: number) => void;
  /** Called when a drag ends or after a key press, with the final size. */
  onResizeEnd: (next: number) => void;
  onReset?: () => void;
  className?: string;
};

const KEY_STEP = 16;
const KEY_STEP_SHIFT = 64;

/** Vertical separator handle: pointer drag (with capture), arrow keys, double-click reset. */
function ResizeHandle({
  value,
  min,
  max,
  label,
  edge = "end",
  onResize,
  onResizeEnd,
  onReset,
  className,
}: ResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ startX: number; startValue: number; last: number } | null>(null);
  const sign = edge === "end" ? 1 : -1;

  const stopDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setDragging(false);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (commit) onResizeEnd(state.last);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { startX: e.clientX, startValue: value, last: value };
    setDragging(true);
    document.body.style.setProperty("user-select", "none");
    document.body.style.setProperty("cursor", "col-resize");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const next = Math.min(max, Math.max(min, state.startValue + sign * (e.clientX - state.startX)));
    state.last = next;
    onResize(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
    const growKey = edge === "end" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = edge === "end" ? "ArrowLeft" : "ArrowRight";
    let next: number;
    if (e.key === growKey) next = value + step;
    else if (e.key === shrinkKey) next = value - step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    onResizeEnd(Math.min(max, Math.max(min, next)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-slot="resize-handle"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => stopDrag(e, true)}
      onPointerCancel={(e) => stopDrag(e, false)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none outline-none",
        edge === "end" ? "-right-[3px]" : "-left-[3px]",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-ring group-hover:delay-100 group-focus-visible:bg-ring group-focus-visible:delay-0 group-data-[dragging]:bg-ring group-data-[dragging]:transition-none"
      />
    </div>
  );
}

export { ResizeHandle };
