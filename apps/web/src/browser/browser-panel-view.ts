import type { DesktopBrowserBounds } from "@/desktop/desktop-api";

/** A measured rectangle (a `DOMRect` fits), CSS px from the top-left of the page viewport. */
export type ViewRect = { x: number; y: number; width: number; height: number };

export type ViewInput = {
  /** The region the native view covers, or null before it is measured. */
  rect: ViewRect | null;
  /** A page is loaded and not in an error state; otherwise the panel's own text must show. */
  hasContent: boolean;
  /** A dialog, menu or popover is open: the native view would be drawn over it. */
  overlayOpen: boolean;
};

/**
 * Where the native view goes, or null when it must be hidden: nothing to show, an overlay is
 * open, or the region has no area (panel collapsed, tab switched, window too small).
 */
export const viewBounds = ({
  rect,
  hasContent,
  overlayOpen,
}: ViewInput): DesktopBrowserBounds | null => {
  if (!rect || !hasContent || overlayOpen) return null;
  const bounds = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  return bounds.width < 1 || bounds.height < 1 ? null : bounds;
};

export const sameBounds = (a: DesktopBrowserBounds | null, b: DesktopBrowserBounds | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

/**
 * Anything that paints above the editor and must not be covered by the native view. Tooltips
 * share Radix's popper wrapper but are small and transient, so they are left out (the toolbar
 * opens them upward, over DOM only).
 */
export const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[data-radix-popper-content-wrapper]:not(:has([data-slot="tooltip-content"]))',
].join(", ");

export const hasOpenOverlay = (root: Pick<ParentNode, "querySelector">): boolean =>
  root.querySelector(OVERLAY_SELECTOR) !== null;
