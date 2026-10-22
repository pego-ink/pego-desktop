import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@pego/ui/lib/motion";
import { isNearBottom } from "@/panels/agent/pinned-scroll";

/**
 * Keeps a scroll container pinned to its bottom while the user is at the bottom. Content growth
 * (streamed text) follows instantly; `follow()` after a new entry scrolls smoothly. Scrolling up
 * unpins; `jumpToLatest()` pins again. Pass `contentRef` the element whose size changes.
 */
export const usePinnedScroll = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const smoothingRef = useRef(false);
  const lastTopRef = useRef(0);
  const timerRef = useRef<number>(0);
  const [pinned, setPinnedState] = useState(true);

  const setPinned = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinnedState(next);
  }, []);

  const snapToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const endSmooth = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (!smoothingRef.current) return;
    smoothingRef.current = false;
    if (pinnedRef.current) snapToBottom();
  }, [snapToBottom]);

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const el = containerRef.current;
      if (!el) return;
      setPinned(true);
      if (!smooth || prefersReducedMotion()) {
        snapToBottom();
        return;
      }
      smoothingRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(endSmooth, 450);
    },
    [endSmooth, setPinned, snapToBottom],
  );

  /** Call after a new entry was appended. `force` re-pins even if the user had scrolled up. */
  const follow = useCallback(
    (force = false) => {
      if (force || pinnedRef.current) scrollToBottom(true);
    },
    [scrollToBottom],
  );

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    const scrolledUp = el.scrollTop < lastTopRef.current;
    lastTopRef.current = el.scrollTop;
    if (smoothingRef.current) {
      if (near) endSmooth();
      return;
    }
    // Only a real upward scroll unpins; the viewport shrinking (cards mounting below) also grows
    // the distance from the bottom but must keep following.
    if (near) {
      if (!pinnedRef.current) setPinned(true);
    } else if (scrolledUp && pinnedRef.current) setPinned(false);
  }, [endSmooth, setPinned]);

  // A user gesture cancels any in-flight programmatic smooth scroll and takes over.
  const onUserScrollIntent = useCallback(() => {
    window.clearTimeout(timerRef.current);
    smoothingRef.current = false;
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current && !smoothingRef.current) snapToBottom();
    });
    observer.observe(content);
    // The viewport also shrinks when cards mount below the log; stay at the bottom then too.
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [snapToBottom]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return {
    containerRef,
    contentRef,
    pinned,
    follow,
    jumpToLatest: () => scrollToBottom(true),
    scrollProps: {
      onScroll,
      onWheel: onUserScrollIntent,
      onTouchStart: onUserScrollIntent,
      onPointerDown: onUserScrollIntent,
    },
  };
};
