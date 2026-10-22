/** JS mirror of the motion tokens in styles/globals.css. Keep both in sync. */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

export const DURATION_INSTANT = 100;
export const DURATION_FAST = 150;
export const DURATION_BASE = 200;
export const DURATION_SLOW = 250;

let reducedQuery: MediaQueryList | null = null;
let reduced = false;

/** Cached `prefers-reduced-motion: reduce`; a change listener keeps it current (safe per frame). */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!reducedQuery) {
    reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced = reducedQuery.matches;
    reducedQuery.addEventListener("change", (event) => {
      reduced = event.matches;
    });
  }
  return reduced;
};
