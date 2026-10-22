import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampWidth,
  parseStoredWidth,
  resolveMax,
  type PanelWidthConfig,
} from "@/hooks/panel-width";

type Options = PanelWidthConfig & { storageKey: string };

const readStored = (key: string): number | null => {
  try {
    return parseStoredWidth(localStorage.getItem(key));
  } catch {
    return null;
  }
};

const writeStored = (key: string, width: number) => {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // storage unavailable (private mode, blocked): width simply is not persisted
  }
};

/**
 * Resizable panel width: clamped, persisted, restored.
 * During a drag `preview` writes the width straight to the element (one write per
 * animation frame, no React render); `commit` stores it in state and localStorage.
 */
export const usePanelWidth = ({
  storageKey,
  defaultWidth,
  min,
  max,
  maxViewportRatio,
}: Options) => {
  const maxNow = () => resolveMax({ defaultWidth, min, max, maxViewportRatio }, window.innerWidth);
  const [width, setWidth] = useState(() =>
    clampWidth(readStored(storageKey) ?? defaultWidth, min, maxNow()),
  );
  const [maxWidth, setMaxWidth] = useState(maxNow);
  const [element, setElement] = useState<HTMLElement | null>(null);
  /** Pending animation frame for live drag updates. */
  const frame = useRef(0);

  const preview = useCallback(
    (next: number) => {
      const value = clampWidth(next, min, maxNow());
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        element?.style.setProperty("width", `${value}px`);
      });
      return value;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element, min, max, maxViewportRatio],
  );

  const commit = useCallback(
    (next: number) => {
      const value = clampWidth(next, min, maxNow());
      cancelAnimationFrame(frame.current);
      element?.style.setProperty("width", `${value}px`);
      setWidth(value);
      writeStored(storageKey, value);
      return value;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element, storageKey, min, max, maxViewportRatio],
  );

  const reset = useCallback(() => commit(defaultWidth), [commit, defaultWidth]);

  // Keep the width inside the allowed range when the window shrinks.
  useEffect(() => {
    const onResize = () => {
      const limit = maxNow();
      setMaxWidth(limit);
      setWidth((current) => clampWidth(current, min, limit));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, maxViewportRatio]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { width, min, max: maxWidth, attachElement: setElement, preview, commit, reset };
};
