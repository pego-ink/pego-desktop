import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import {
  GlobeIcon,
  PanelLeftIcon,
  PanelRightIcon,
  Redo2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { PanelHeader } from "@pego/ui/components/panel-header";
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
import { useSettingsStore } from "@/store/use-settings-store";
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

/** The browser has its own column on the right (Settings > General > Browser panel). */
const useBrowserOnRight = (): boolean =>
  useSettingsStore((s) => s.browserSide === "right") && hasDesktopBrowser();

/** The right-hand Browser column, a remembered width of its own; resized from its left edge. */
const BROWSER_COLUMN = { ...BROWSER_PANEL, storageKey: "pego:browser-column-width" } as const;

const BrowserColumn = ({ floating = false }: { floating?: boolean }) => {
  const open = useLayoutStore((s) => s.browserOpen);
  const { attachElement, width, min, max, preview, commit, reset } = usePanelWidth(BROWSER_COLUMN);
  if (!open) return null;
  return (
    <aside
      ref={attachElement}
      id={railPanelId("browser")}
      role="tabpanel"
      aria-labelledby={railTabId("browser")}
      aria-label="Browser"
      style={{ width }}
      className={cn(
        "relative flex shrink-0 flex-col",
        floating
          ? cn("max-w-[55vw] overflow-hidden", FLOATING_CARD)
          : "border-l border-border bg-card",
      )}
    >
      <PanelHeader>
        <span className="flex min-w-0 items-center gap-1.5">
          <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          Browser
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Move the browser to the side panel"
            title="Move the browser to the side panel"
            className="text-muted-foreground"
            onClick={() => useLayoutStore.getState().setBrowserSide("left")}
          >
            <PanelLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close the browser"
            title="Close the browser"
            className="text-muted-foreground"
            onClick={() => useLayoutStore.getState().pressRailTab("browser")}
          >
            <XIcon />
          </Button>
        </span>
      </PanelHeader>
      <BrowserPanel />
      <ResizeHandle
        edge="start"
        className={floating ? "left-0" : undefined}
        label="Resize browser panel"
        value={width}
        min={min}
        max={max}
        onResize={preview}
        onResizeEnd={commit}
        onReset={reset}
      />
    </aside>
  );
};

/** Side panel: file header, then the agent, the pages and layers, or the assets. Resizable. */
const LeftColumn = ({ floating = false }: { floating?: boolean }) => {
  const rail = useLayoutStore((s) => s.rail);
  const browserOnRight = useBrowserOnRight();
  const tabs = useMemo(
    () =>
      railTabsFor(hasDesktopBrowser()).filter((tab) => !(browserOnRight && tab.id === "browser")),
    [browserOnRight],
  );
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
  // With the browser on the right the side panel never shows its tab (the column has it).
  const shown = browserOnRight && rail.tab === "browser" ? "agent" : rail.tab;
  const panel = shown === "browser" ? browser : standard;
  return (
    <aside
      ref={attachElement}
      aria-label="Side panel"
      hidden={!rail.open}
      style={{ width: panel.width }}
      className={cn(
        "relative shrink-0 flex-col [&:not([hidden])]:flex",
        floating ? "min-h-0 flex-1" : "border-r border-border bg-card",
      )}
    >
      <FileMenu />
      {tabs.map(({ id }) => (
        <div
          key={id}
          id={railPanelId(id)}
          role="tabpanel"
          aria-labelledby={railTabId(id)}
          hidden={shown !== id}
          className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex"
        >
          {/* Assets are derived from the whole document, and the browser owns a native view:
              mount both only while shown (the view keeps its page while hidden). */}
          {(id !== "assets" && id !== "browser") || shown === id ? <RailPanel tab={id} /> : null}
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

/** The floating interface's header pill, at the end of the tab row (like pen.dev's Share pill). */
const FloatingHeaderPill = () => (
  <div className={cn("flex items-center gap-1 p-1", FLOATING_CARD)}>
    <HistoryButtons />
    <div role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px bg-border" />
    <ShowRightPanelButton className="static z-auto border-0 bg-transparent shadow-none backdrop-blur-none" />
    <HeaderActions />
  </div>
);

/**
 * The floating layout (like pen.dev): the canvas fills the whole area behind the panels; the side
 * card has its panel icons in a row on top, and the properties card sits on the right. The free
 * area between the cards (the stage) is measured into the viewport's insets, so fits, zoom and
 * "the middle of the view" use what the user can actually see.
 */
const FloatingBody = ({ rail }: { rail: ReactNode }) => {
  const railOpen = useLayoutStore((s) => s.rail.open);
  const browserOnRight = useBrowserOnRight();
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
    <div ref={containerRef} className="relative min-h-0 flex-1">
      <main className="absolute inset-0">
        <Canvas />
      </main>
      <div className="pointer-events-none absolute inset-0 flex gap-2 px-2 pb-2">
        {/* With its panel closed the card is just the icon row, floating at the top left; the
            canvas then gets the full width. */}
        <div
          className={cn(
            "pointer-events-auto flex shrink-0 flex-col overflow-hidden",
            FLOATING_CARD,
            !railOpen && "absolute top-0 left-2 z-10",
          )}
        >
          {rail}
          <LeftColumn floating />
        </div>
        {/* With the panel closed its icon pill floats over the top left, so the stage (what fits
            and centers aim at, and where the toolbar sits) starts below it. */}
        <div ref={stageRef} className={cn("relative min-w-0 flex-1", !railOpen && "mt-[52px]")}>
          <div className="pointer-events-auto">
            <ZoomControl />
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 gap-2 empty:hidden">
          {browserOnRight ? <BrowserColumn floating /> : null}
          <RightColumn floating />
        </div>
      </div>
    </div>
  );
};

export const EditorShell = () => {
  const rail = useLayoutStore((s) => s.rail);
  const browserOnRight = useBrowserOnRight();
  const browserColumnOpen = useLayoutStore((s) => s.browserOpen) && browserOnRight;
  const pressRailTab = useLayoutStore((s) => s.pressRailTab);
  const working = useAgentStore((s) => selectRunsActive(s) > 0);
  // Home shows with the Home view, and whenever no document tab is left (always, bridge or not).
  const dashboard = useWorkspaceStore((s) => s.view === "dashboard" || s.liveId === null);
  // The dashboard keeps the docked layout; the floating one is for the editor.
  const floating = useFloatingInterface() && !dashboard;
  const theme = useThemeStore((s) => s.resolved);
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

  if (floating)
    return (
      <div
        className="flex h-full flex-col text-foreground"
        style={{ background: CANVAS_BACKGROUND[theme] }}
      >
        <TabBar floating trailing={<FloatingHeaderPill />} />
        <FloatingBody
          rail={
            <IconRail
              orientation="horizontal"
              state={rail}
              agentWorking={working}
              onPress={press}
              browserColumnOpen={browserColumnOpen}
              className={rail.open ? undefined : "border-b-0"}
            />
          }
        />
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TabBar />
      <div className="flex min-h-0 flex-1">
        <IconRail
          state={rail}
          agentWorking={working}
          onPress={press}
          onHome={showDashboard}
          homeActive={dashboard}
          browserColumnOpen={browserColumnOpen && !dashboard}
        />
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
        {/* Full height on the far right, mirroring the side panel on the left. */}
        {browserOnRight && !dashboard ? <BrowserColumn /> : null}
      </div>
    </div>
  );
};
