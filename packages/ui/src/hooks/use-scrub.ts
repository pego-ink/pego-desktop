import { useRef, type PointerEvent } from "react";

type ScrubOptions = {
  /** Current value in display units, read when the gesture starts. */
  getValue: () => number;
  /** Value change per pixel. Shift multiplies by 10. */
  step?: number;
  /** First change of a gesture is "commit", every later one is "extend". */
  onChange: (value: number, phase: "commit" | "extend") => void;
};

type Gesture = { startValue: number; offset: number; changes: number; last: number };

/** Pointer-drag scrubbing for a label: spread the returned props on the handle element. */
export const useScrub = ({ getValue, step = 1, onChange }: ScrubOptions) => {
  const gesture = useRef<Gesture | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startValue = getValue();
    gesture.current = { startValue, offset: 0, changes: 0, last: startValue };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    // Accumulate per event so toggling shift mid-drag does not make the value jump.
    g.offset += event.movementX * step * (event.shiftKey ? 10 : 1);
    const value = Math.round((g.startValue + Math.round(g.offset / step) * step) * 1e4) / 1e4;
    if (value === g.last) return;
    g.last = value;
    onChange(value, g.changes === 0 ? "commit" : "extend");
    g.changes += 1;
  };

  const end = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current) return;
    gesture.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end };
};
