import { useEffect } from "react";
import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { isTextEditing } from "@/store/use-text-edit-store";
import { toggleBothPanels, togglePanel, usePanelsStore } from "./use-panels-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** Header buttons to hide or show the left (layers, agent) and right (properties) panels. */
export const PanelToggles = () => {
  const { left, right } = usePanelsStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "\\" || isTextEditing()) return;
      event.preventDefault();
      toggleBothPanels();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={left}
        aria-label={left ? "Hide left panel" : "Show left panel"}
        title={`${left ? "Hide" : "Show"} layers and agent (${MOD}\\ for both panels)`}
        className={cn(!left && "text-muted-foreground")}
        onClick={() => togglePanel("left")}
      >
        <PanelLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={right}
        aria-label={right ? "Hide right panel" : "Show right panel"}
        title={`${right ? "Hide" : "Show"} properties (${MOD}\\ for both panels)`}
        className={cn(!right && "text-muted-foreground")}
        onClick={() => togglePanel("right")}
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
};
