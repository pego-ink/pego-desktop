import { useCallback, useEffect, useState } from "react";
import { PanelRightIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { ZoomControl } from "@/components/ZoomControl";
import { LayersPanel } from "@/panels/LayersPanel";
import { AgentPanel } from "@/panels/agent/AgentPanel";
import { selectRunsActive, useAgentStore } from "@/agent/use-agent-store";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { FramePresetsPanel } from "@/panels/frame-presets/FramePresetsPanel";
import { useToolStore } from "@/store/use-tool-store";
import { useDocumentStore } from "@/store/use-document-store";
import { showProperties, useLayoutStore } from "@/store/use-layout-store";
import { Button } from "@pego/ui/components/button";
import { ResizeHandle } from "@pego/ui/components/resize-handle";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { cn } from "@pego/ui/lib/utils";
import { FileMenu } from "@/persistence/FileMenu";
import { IconRail, railPanelId, railTabId } from "@/components/IconRail";
import {
  RAIL_TABS,
  pressTab,
  readRailState,
  writeRailState,
  type RailState,
  type RailTab,
} from "@/components/rail-state";

const HistoryButtons = () => {
  const canUndo = useDocumentStore((s) => s.history.past.length > 0);
  const canRedo = useDocumentStore((s) => s.history.future.length > 0);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2Icon />
      </Button>
    </div>
  );
};

const LEFT_PANEL = {
  storageKey: "pego:left-panel-width",
  defaultWidth: 300,
  min: 240,
  max: 520,
  maxViewportRatio: 0.4,
} as const;

/** Side panel: file header, then the agent or layer panel. Width is user-resizable. */
const LeftColumn = ({ rail }: { rail: RailState }) => {
  const { attachElement, ...panel } = usePanelWidth(LEFT_PANEL);
  return (
    <aside
      ref={attachElement}
      aria-label="Side panel"
      hidden={!rail.open}
      style={{ width: panel.width }}
      className="relative shrink-0 flex-col border-r border-border bg-card [&:not([hidden])]:flex"
    >
      <FileMenu />
      {RAIL_TABS.map(({ id }) => (
        <div
          key={id}
          id={railPanelId(id)}
          role="tabpanel"
          aria-labelledby={railTabId(id)}
          hidden={rail.tab !== id}
          className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex"
        >
          {id === "agent" ? <AgentPanel /> : <LayersPanel />}
        </div>
      ))}
      <ResizeHandle
        label="Resize left panel"
        value={panel.width}
        min={panel.min}
        max={panel.max}
        onResize={panel.preview}
        onResizeEnd={panel.commit}
        onReset={panel.reset}
      />
    </aside>
  );
};

const PropertiesToggle = () => {
  const pinned = useLayoutStore((s) => s.propertiesPinned);
  const toggle = useLayoutStore((s) => s.togglePropertiesPinned);
  const label = pinned ? "Hide properties when nothing is selected" : "Always show properties";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      onClick={toggle}
      className={cn(pinned && "bg-muted text-foreground")}
    >
      <PanelRightIcon />
    </Button>
  );
};

/** Properties column: hidden while nothing is selected unless pinned or the Frame tool is active. */
const RightColumn = () => {
  const hasSelection = useDocumentStore((s) => s.selection.length > 0);
  const pinned = useLayoutStore((s) => s.propertiesPinned);
  const frameTool = useToolStore((s) => s.tool === "frame");
  if (!showProperties(hasSelection ? 1 : 0, pinned, frameTool)) return null;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      {frameTool ? <FramePresetsPanel /> : <PropertiesPanel />}
    </aside>
  );
};

export const EditorShell = () => {
  const [rail, setRail] = useState(readRailState);
  const working = useAgentStore((s) => selectRunsActive(s) > 0);
  const press = useCallback((tab: RailTab) => setRail((prev) => pressTab(prev, tab)), []);
  useEffect(() => writeRailState(rail), [rail]);
  return (
    <div className="flex h-full bg-background text-foreground">
      <IconRail state={rail} agentWorking={working} onPress={press} />
      <LeftColumn rail={rail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-3">
          <HistoryButtons />
          <div className="flex items-center gap-2">
            <PropertiesToggle />
            <Button size="sm" variant="secondary">
              Share
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            <Canvas />
            <ZoomControl />
          </main>
          <RightColumn />
        </div>
      </div>
    </div>
  );
};
