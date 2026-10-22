import { PanelRightIcon, Redo2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { LayersPanel } from "@/panels/LayersPanel";
import { AssetsPanel } from "@/assets/AssetsPanel";
import { AgentPanel } from "@/panels/agent/AgentPanel";
import { isRunActive } from "@/panels/agent/agent-format";
import { useAgentStore } from "@/agent/use-agent-store";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { FramePresetsPanel } from "@/panels/frame-presets/FramePresetsPanel";
import { HidePanelButton, ShowPanelButtons, usePanelShortcut } from "@/layout/PanelToggles";
import { setLeftTab, usePanelsStore } from "@/layout/use-panels-store";
import { useToolStore } from "@/store/use-tool-store";
import { useDocumentStore } from "@/store/use-document-store";
import { showProperties, useLayoutStore } from "@/store/use-layout-store";
import { Dashboard } from "@/workspace/Dashboard";
import { HomeButton } from "@/workspace/HomeButton";
import { WorkspaceTabs } from "@/workspace/WorkspaceTabs";
import { useWorkspaceStore } from "@/workspace/use-workspace-store";
import { Button } from "@pego/ui/components/button";
import { ResizeHandle } from "@pego/ui/components/resize-handle";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { cn } from "@pego/ui/lib/utils";
import { FileMenu } from "@/persistence/FileMenu";
import { ThemeToggle } from "@/theme/ThemeToggle";

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

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={cn(
      "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
      active && "bg-secondary text-foreground shadow-xs",
    )}
  >
    {children}
  </button>
);

const LEFT_PANEL = {
  storageKey: "pego:left-panel-width",
  defaultWidth: 300,
  min: 240,
  max: 520,
  maxViewportRatio: 0.4,
} as const;

/** Left column: layers, the document's assets, or the agent panel. Width is user-resizable. */
const LeftColumn = () => {
  const tab = usePanelsStore((s) => s.leftTab);
  const setTab = setLeftTab;
  const working = useAgentStore((s) => isRunActive(s.status));
  const { attachElement, ...panel } = usePanelWidth(LEFT_PANEL);
  return (
    <aside
      ref={attachElement}
      aria-label="Side panel"
      style={{ width: panel.width }}
      className="relative flex shrink-0 flex-col border-r border-border bg-card"
    >
      <div
        role="tablist"
        aria-label="Left panel"
        className="flex shrink-0 items-center gap-0.5 border-b border-border p-1.5"
      >
        <TabButton active={tab === "layers"} onClick={() => setTab("layers")}>
          Layers
        </TabButton>
        <TabButton active={tab === "assets"} onClick={() => setTab("assets")}>
          Assets
        </TabButton>
        <TabButton active={tab === "agent"} onClick={() => setTab("agent")}>
          <SparklesIcon />
          Agent
          {working && tab !== "agent" ? (
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-violet" />
          ) : null}
        </TabButton>
        <HidePanelButton side="left" className="ml-1" />
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "layers" ? "flex" : "hidden")}>
        <LayersPanel />
      </div>
      {tab === "assets" ? <AssetsPanel /> : null}
      {/* Kept mounted so the agent log and composer survive tab switches. */}
      <div className={cn("min-h-0 flex-1 flex-col", tab === "agent" ? "flex" : "hidden")}>
        <AgentPanel />
      </div>
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
  const view = useWorkspaceStore((s) => s.view);
  const { left, right } = usePanelsStore();
  usePanelShortcut();
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
        <div className="flex min-w-0 items-center gap-3">
          <HomeButton />
          {view === "editor" ? <FileMenu /> : null}
          <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
          <WorkspaceTabs />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view === "editor" ? (
            <>
              <HistoryButtons />
              <PropertiesToggle />
            </>
          ) : null}
          <ThemeToggle />
          <Button size="sm" variant="secondary">
            Share
          </Button>
        </div>
      </header>
      {view === "dashboard" ? (
        <Dashboard />
      ) : (
        <div className="flex min-h-0 flex-1">
          {left ? <LeftColumn /> : null}
          <main className="relative flex min-w-0 flex-1 flex-col">
            <ShowPanelButtons />
            <div className="min-h-0 flex-1">
              <Canvas />
            </div>
          </main>
          {right ? <RightColumn /> : null}
        </div>
      )}
    </div>
  );
};
