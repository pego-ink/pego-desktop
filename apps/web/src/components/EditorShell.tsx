import { PanelRightIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { ZoomControl } from "@/components/ZoomControl";
import { LayersPanel } from "@/panels/LayersPanel";
import { PagesPanel } from "@/pages/PagesPanel";
import { AssetsPanel } from "@/assets/AssetsPanel";
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
import {
  WINDOW_CONTROLS_GUTTER_CLASS,
  WINDOW_DRAG_CLASS,
  useWindowControlsInset,
} from "@/desktop/window-controls";
import { IconRail, railPanelId, railTabId } from "@/components/IconRail";
import { RAIL_TABS, type RailTab } from "@/components/rail-state";
import { ShowRightPanelButton, usePanelShortcut } from "@/layout/PanelToggles";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { Dashboard } from "@/workspace/Dashboard";
import { WorkspaceTabs } from "@/workspace/WorkspaceTabs";
import { showDashboard, useWorkspaceStore } from "@/workspace/use-workspace-store";

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

const RailPanel = ({ tab }: { tab: RailTab }) => {
  if (tab === "agent") return <AgentPanel />;
  if (tab === "assets") return <AssetsPanel />;
  return (
    <>
      <PagesPanel />
      <LayersPanel />
    </>
  );
};

/** Side panel: file header, then the agent, the pages and layers, or the assets. Resizable. */
const LeftColumn = () => {
  const rail = useLayoutStore((s) => s.rail);
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
          {/* Assets are derived from the whole document: only compute them while shown. */}
          {id !== "assets" || rail.tab === "assets" ? <RailPanel tab={id} /> : null}
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

/**
 * Properties column: hidden while nothing is selected unless pinned or the Frame tool is active,
 * and always hidden while the user hid it.
 */
const RightColumn = () => {
  const hasSelection = useDocumentStore((s) => s.selection.length > 0);
  const pinned = useLayoutStore((s) => s.propertiesPinned);
  const hidden = useLayoutStore((s) => s.rightHidden);
  const frameTool = useToolStore((s) => s.tool === "frame");
  if (!showProperties(hasSelection ? 1 : 0, pinned, frameTool, hidden)) return null;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      {frameTool ? <FramePresetsPanel /> : <PropertiesPanel />}
    </aside>
  );
};

/** Bridge projects (dashboard, project tabs) exist only while a bridge serves a design folder. */
const useProjectsAvailable = () =>
  useAgentStore((s) => s.bridge.connected && s.bridge.projectDir !== null);

export const EditorShell = () => {
  const rail = useLayoutStore((s) => s.rail);
  const pressRailTab = useLayoutStore((s) => s.pressRailTab);
  const working = useAgentStore((s) => selectRunsActive(s) > 0);
  const projects = useProjectsAvailable();
  const dashboard = useWorkspaceStore((s) => s.view === "dashboard") && projects;
  usePanelShortcut();

  const press = (tab: RailTab) => {
    // From the dashboard, a rail tab goes back to the editor with that tab open.
    if (dashboard) {
      useWorkspaceStore.setState({ view: "editor" });
      if (!rail.open || rail.tab !== tab) pressRailTab(tab);
      return;
    }
    pressRailTab(tab);
  };
  const windowControls = useWindowControlsInset();

  return (
    <div className="flex h-full bg-background text-foreground">
      <IconRail
        state={rail}
        agentWorking={working}
        onPress={press}
        onHome={projects ? showDashboard : undefined}
        homeActive={dashboard}
      />
      {dashboard ? null : <LeftColumn />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3",
            // Without the side panel this row sits right of the rail, under the traffic lights.
            windowControls && [
              WINDOW_DRAG_CLASS,
              (dashboard || !rail.open) && WINDOW_CONTROLS_GUTTER_CLASS,
            ],
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {dashboard ? null : <HistoryButtons />}
            {projects ? (
              <>
                {dashboard ? null : <span aria-hidden className="h-4 w-px shrink-0 bg-border" />}
                <WorkspaceTabs />
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {dashboard ? null : <PropertiesToggle />}
            <ThemeToggle />
            <Button size="sm" variant="secondary">
              Share
            </Button>
          </div>
        </header>
        {dashboard ? (
          <Dashboard />
        ) : (
          <div className="flex min-h-0 flex-1">
            <main className="relative min-w-0 flex-1">
              <ShowRightPanelButton />
              <Canvas />
              <ZoomControl />
            </main>
            <RightColumn />
          </div>
        )}
      </div>
    </div>
  );
};
