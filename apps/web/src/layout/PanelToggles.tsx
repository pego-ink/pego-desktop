import { useEffect } from "react";
import { PanelRightIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { useLayoutStore } from "@/store/use-layout-store";
import { isTextEditing } from "@/store/use-text-edit-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = isMac ? "⌘\\" : "Ctrl+\\";

/** Ctrl/⌘ + \ hides both side panels, or shows both when any is hidden. */
export const usePanelShortcut = () =>
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "\\" || isTextEditing()) return;
      event.preventDefault();
      useLayoutStore.getState().toggleBothPanels();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

/** Small button in the properties header that hides the right column. */
export const HideRightPanelButton = ({ className }: { className?: string }) => (
  <Button
    variant="ghost"
    size="icon-xs"
    aria-label="Hide properties panel"
    title={`Hide properties (${SHORTCUT} for both panels)`}
    className={cn("text-muted-foreground", className)}
    onClick={() => useLayoutStore.getState().toggleRight()}
  >
    <PanelRightIcon />
  </Button>
);

/**
 * Floating button over the canvas that brings the hidden properties column back. The left side
 * needs none: its icon rail always stays visible.
 */
export const ShowRightPanelButton = () => {
  const hidden = useLayoutStore((s) => s.rightHidden);
  if (!hidden) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Show properties panel"
      title={`Show properties (${SHORTCUT} for both panels)`}
      className="absolute top-3 right-3 z-20 border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-accent"
      onClick={() => useLayoutStore.getState().toggleRight()}
    >
      <PanelRightIcon />
    </Button>
  );
};
