import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { PanelRightIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Canvas } from "@/components/Canvas";
import { ZoomControl } from "@/components/ZoomControl";
import { LayersPanel } from "@/panels/LayersPanel";
import { PagesPanel } from "@/pages/PagesPanel";
import { AssetsPanel } from "@/assets/AssetsPanel";
import { BrowserPanel } from "@/browser/BrowserPanel";
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
import { hasDesktopBrowser, railTabsFor, type RailTab } from "@/components/rail-state";
import { ShowRightPanelButton, usePanelShortcut } from "@/layout/PanelToggles";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { CANVAS_BACKGROUND, useThemeStore } from "@/theme/theme";
import { FLOATING_CARD, insetsWithin } from "@/layout/interface-style";
import { useFloatingInterface } from "@/layout/use-floating-interface";
import { useViewportStore } from "@/store/use-viewport-store";
import { Dashboard } from "@/workspace/Dashboard";
import { TabBar } from "@/workspace/TabBar";
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

/** The browser needs room for a page: wider by default and allowed to grow further. */
const BROWSER_PANEL = {
  storageKey: "pego:browser-panel-width",
  defaultWidth: 520,
  min: 360,
  max: 1200,
  maxViewportRatio: 0.6,
} as const;

const RailPanel = ({ tab }: { tab: RailTab }) => {
  if (tab === "agent") return <AgentPanel />;
  if (tab === "assets") return <AssetsPanel />;
  if (tab === "browser") return <BrowserPanel />;
  return (
    <>
      <PagesPanel />
      <LayersPanel />
    </>
  );
};

/** Side panel: file header, then the agent, the pages and layers, or the assets. Resizable. */
const LeftColumn = ({ floating = false }: { floating?: boolean }) => {
  const rail = useLayoutStore((s) => s.rail);
  const tabs = useMemo(() => railTabsFor(hasDesktopBrowser()), []);
  const standard = usePanelWidth(LEFT_PANEL);
  const browser = usePanelWidth(BROWSER_PANEL);
  const { attachElement: attachStandard } = standard;
  const { attachElement: attachBrowser } = browser;
  // One element, two remembered widths: the browser tab has its own.
  const attachElement = useCallback(
    (element: HTMLElement | null) => {
      attachStandard(element);
      attachBrowser(element);
    },
    [attachStandard, attachBrowser],
  );
  const panel = rail.tab === "browser" ? browser : standard;
  return (
    <aside
      ref={attachElement}
      aria-label="Side panel"
      hidden={!rail.open}
      style={{ width: panel.width }}
      className={cn(
        "relative shrink-0 flex-col [&:not([hidden])]:flex",
        !floating && "border-r border-border bg-card",
      )}
    >
      <FileMenu />
      {tabs.map(({ id }) => (
        <div
          key={id}
          id={railPanelId(id)}
          role="tabpanel"
          aria-labelledby={railTabId(id)}
          hidden={rail.tab !== id}
          className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex"
        >
          {/* Assets are derived from the whole document, and the browser owns a native view:
              mount both only while shown (the view keeps its page while hidden). */}
          {(id !== "assets" && id !== "browser") || rail.tab === id ? <RailPanel tab={id} /> : null}
        </div>
      ))}
      <ResizeHandle
        // Inside a floating card (which clips its content) the handle sits on the inner edge.
        className={floating ? "right-0" : undefined}
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
const RightColumn = ({ floating = false }: { floating?: boolean }) => {
  const hasSelection = useDocumentStore((s) => s.selection.length > 0);
  const pinned = useLayoutStore((s) => s.propertiesPinned);
  const hidden = useLayoutStore((s) => s.rightHidden);
  const frameTool = useToolStore((s) => s.tool === "frame");
  if (!showProperties(hasSelection ? 1 : 0, pinned, frameTool, hidden)) return null;
  return (
    <aside
      className={cn(
        "flex w-72 shrink-0 flex-col",
        // Capped so a narrow window still leaves canvas between the floating cards.
        floating
          ? cn("max-w-[30vw] overflow-hidden", FLOATING_CARD)
          : "border-l border-border bg-card",
      )}
    >
      {frameTool ? <FramePresetsPanel /> : <PropertiesPanel />}
    </aside>
  );
};

/** The header's right-hand controls (a bar in the docked layout, a pill in the floating one). */
const HeaderActions = () => (
  <>
    <PropertiesToggle />
    <ThemeToggle />
    <Button size="sm" variant="secondary">
      Share
    </Button>
  </>
);

/**
 * The floating layout (like pen.dev): the canvas fills the whole area behind the panels, the rail
 * and side panel are one card, the properties panel another, and the header controls are pills.
 * The free area between the cards (the stage) is measured into the viewport's insets, so fits,
 * zoom and "the middle of the view" use what the user can actually see.
 */
const FloatingBody = ({ rail }: { rail: ReactNode }) => {
  const theme = useThemeStore((s) => s.resolved);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;
    const { setInsets } = useViewportStore.getState();
    const measure = () =>
      setInsets(insetsWithin(container.getBoundingClientRect(), stage.getBoundingClientRect()));
    // One update per frame while a panel is dragged wider or narrower.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      setInsets(null);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1"
      style={{ background: CANVAS_BACKGROUND[theme] }}
    >
      <main className="absolute inset-0">
        <Canvas />
      </main>
      <div className="pointer-events-none absolute inset-0 flex gap-2 p-2">
        <div className={cn("pointer-events-auto flex shrink-0 overflow-hidden", FLOATING_CARD)}>
          {rail}
          <LeftColumn floating />
        </div>
        {/* The pills get their own row, so the stage (what fits and centers aim at) starts
            below them. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div className={cn("pointer-events-auto flex items-center p-1", FLOATING_CARD)}>
              <HistoryButtons />
            </div>
            <div className={cn("pointer-events-auto flex items-center gap-1.5 p-1", FLOATING_CARD)}>
              <ShowRightPanelButton className="static z-auto border-0 bg-transparent shadow-none backdrop-blur-none" />
              <HeaderActions />
            </div>
          </div>
          <div ref={stageRef} className="relative min-h-0 flex-1">
            <div className="pointer-events-auto">
              <ZoomControl />
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 empty:hidden">
          <RightColumn floating />
        </div>
      </div>
    </div>
  );
};

export const EditorShell = () => {
  const rail = useLayoutStore((s) => s.rail);
  const pressRailTab = useLayoutStore((s) => s.pressRailTab);
  const working = useAgentStore((s) => selectRunsActive(s) > 0);
  // Home shows with the Home view, and whenever no document tab is left (always, bridge or not).
  const dashboard = useWorkspaceStore((s) => s.view === "dashboard" || s.liveId === null);
  // The dashboard keeps the docked layout; the floating one is for the editor.
  const floating = useFloatingInterface() && !dashboard;
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

  const iconRail = (
    <IconRail
      state={rail}
      agentWorking={working}
      onPress={press}
      onHome={showDashboard}
      homeActive={dashboard}
      className={floating && !rail.open ? "border-r-0" : undefined}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TabBar />
      {floating ? (
        <FloatingBody rail={iconRail} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {iconRail}
          {dashboard ? null : <LeftColumn />}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
              <div className="flex min-w-0 items-center gap-2">
                {dashboard ? null : <HistoryButtons />}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {dashboard ? (
                  <>
                    <ThemeToggle />
                    <Button size="sm" variant="secondary">
                      Share
                    </Button>
                  </>
                ) : (
                  <HeaderActions />
                )}
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
      )}
    </div>
  );
};
