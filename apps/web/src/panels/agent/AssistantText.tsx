import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Markdown } from "@pego/ui/components/markdown";
import { prefersReducedMotion } from "@pego/ui/lib/motion";
import { cn } from "@pego/ui/lib/utils";
import {
  COLLAPSE_MAX_PX,
  countWords,
  revealAdvance,
  revealDurationMs,
  revealRate,
  revealTarget,
  shouldCollapse,
  visibleHeight,
} from "@/panels/agent/reveal-text";

/** Soft top-to-bottom sweep; `--reveal` (px) is driven per frame without re-rendering. */
// Literal string so Tailwind sees it. The 24px soft edge must match REVEAL_EDGE_PX.
const REVEAL_MASK =
  "[mask-image:linear-gradient(to_bottom,#000_calc(var(--reveal,0px)-24px),transparent_var(--reveal,0px))]";

/**
 * Sweeps `ref` into view with a mask while the full text already holds its final layout, so the
 * reveal never reflows. Growing (streamed) text keeps sweeping at the tail. Off for entries that
 * were already there on first render and under reduced motion.
 */
const useTextReveal = (
  ref: RefObject<HTMLDivElement | null>,
  text: string,
  enabled: boolean,
  expanded: boolean,
) => {
  const [armed] = useState(() => enabled && !prefersReducedMotion());
  const [revealing, setRevealing] = useState(armed);
  const revealedRef = useRef(0);
  const wordsRef = useRef(0);
  const addedRef = useRef(1);
  const lastTextRef = useRef<string | null>(null);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!armed || !el) return;
    // Re-runs for the same text (StrictMode) keep the first run's word delta.
    if (lastTextRef.current !== text) {
      const words = countWords(text);
      addedRef.current = Math.max(1, words - wordsRef.current);
      wordsRef.current = words;
      lastTextRef.current = text;
    }

    const remaining =
      revealTarget(visibleHeight(el.offsetHeight, expandedRef.current)) - revealedRef.current;
    if (remaining <= 0) return;
    const rate = revealRate(remaining, revealDurationMs(addedRef.current));
    setRevealing(true);
    el.style.setProperty("--reveal", `${revealedRef.current}px`);

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const target = revealTarget(visibleHeight(el.offsetHeight, expandedRef.current));
      revealedRef.current = revealAdvance(revealedRef.current, target, dt, rate);
      el.style.setProperty("--reveal", `${revealedRef.current}px`);
      if (revealedRef.current >= target) {
        setRevealing(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [armed, ref, text]);

  return revealing;
};

/**
 * Assistant Markdown that eases in instead of popping, and folds past ~8 lines behind a soft fade
 * with a Show more / Show less toggle.
 */
export const AssistantText = ({
  text,
  animate,
  className,
}: {
  text: string;
  animate: boolean;
  className?: string;
}) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const [contentHeight, setContentHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const revealing = useTextReveal(innerRef, text, animate, expanded);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContentHeight(Math.round(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const collapsible = shouldCollapse(contentHeight);
  const folded = collapsible && !expanded;
  const toggle = () => {
    setToggling(true);
    setExpanded((value) => !value);
  };

  return (
    <div className={className}>
      <div
        id={bodyId}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setToggling(false);
        }}
        style={collapsible ? { maxHeight: expanded ? contentHeight : COLLAPSE_MAX_PX } : undefined}
        className={cn(
          "relative",
          collapsible && "overflow-hidden",
          collapsible && toggling && "transition-[max-height] duration-(--duration-base) ease-out",
          "motion-reduce:transition-none",
        )}
      >
        <div ref={innerRef} className={cn(revealing && REVEAL_MASK)}>
          <Markdown text={text} />
        </div>
        {collapsible ? (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent transition-opacity duration-(--duration-base) ease-out",
              folded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}
      </div>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggle}
          className="mt-0.5 -ml-1 flex h-6 items-center gap-1 rounded-sm px-1 text-[11px] text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? "Show less" : "Show more"}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 transition-transform duration-(--duration-fast) ease-out",
              expanded && "rotate-180",
            )}
          />
        </button>
      ) : null}
    </div>
  );
};
