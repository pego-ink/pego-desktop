import { useEffect } from "react";
import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { isTextEditing } from "@/store/use-text-edit-store";
import { toggleBothPanels, togglePanel, usePanelsStore } from "./use-panels-store";

type Side = "left" | "right";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = isMac ? "⌘\\" : "Ctrl+\\";
const LABELS: Record<Side, string> = { left: "layers and agent", right: "properties" };
const ICONS: Record<Side, typeof PanelLeftIcon> = { left: PanelLeftIcon, right: PanelRightIcon };

/** Ctrl/⌘ + \ hides both side panels, or shows both when any is hidden. */
export const usePanelShortcut = () =>
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "\\" || isTextEditing()) return;
      event.preventDefault();
      toggleBothPanels();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

/** Small button inside a side panel that hides it. */
export const HidePanelButton = ({ side, className }: { side: Side; className?: string }) => {
  const Icon = ICONS[side];
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Hide ${side} panel`}
      title={`Hide ${LABELS[side]} (${SHORTCUT} for both panels)`}
      className={cn("text-muted-foreground", className)}
      onClick={() => togglePanel(side)}
    >
      <Icon />
    </Button>
  );
};

/** Floating buttons over the canvas that bring hidden side panels back. */
export const ShowPanelButtons = () => {
  const { left, right } = usePanelsStore();
  return (
    <>
      {left ? null : <FloatingShow side="left" />}
      {right ? null : <FloatingShow side="right" />}
    </>
  );
};

const FloatingShow = ({ side }: { side: Side }) => {
  const Icon = ICONS[side];
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Show ${side} panel`}
      title={`Show ${LABELS[side]} (${SHORTCUT} for both panels)`}
      className={cn(
        "absolute top-3 z-20 border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-accent",
        side === "left" ? "left-3" : "right-3",
      )}
      onClick={() => togglePanel(side)}
    >
      <Icon />
    </Button>
  );
};
