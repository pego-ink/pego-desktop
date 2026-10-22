import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { FileIcon, FolderIcon, HomeIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { desktopApi } from "@/desktop/desktop-api";
import { clampPercent } from "@/desktop/update-notice-model";
import { useUpdateStatus } from "@/desktop/use-update-status";
import {
  WINDOW_CONTROLS_INSET_CLASS,
  WINDOW_NO_DRAG_CLASS,
  useTrafficLightsInset,
} from "@/desktop/window-controls";
import { CloseConfirmDialog } from "./CloseConfirmDialog";
import { HOME_TAB_ID, activateTab, runTabAction } from "./tab-actions";
import { dragShift, dropIndex, moveItem, type TabRect } from "./tab-bar-model";
import { requestCloseTab } from "./use-close-confirm";
import {
  reorderWorkspaces,
  useWorkspaceStatus,
  useWorkspaceStore,
  useWorkspaceTitle,
  type Workspace,
} from "./use-workspace-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** Pointer travel before a press turns into a drag, so plain clicks never move a tab. */
const DRAG_THRESHOLD = 4;
const FADE = 20;

/**
 * Shape shared by every tab. The active tab is a filled block in the colour of the toolbar below
 * it, with Chrome-style concave feet; inactive tabs are bare until hovered.
 */
const tabClass = (active: boolean, dragging: boolean) =>
  cn(
    "tab group/tab relative flex h-9 cursor-default items-center select-none rounded-t-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
    WINDOW_NO_DRAG_CLASS,
    "hover:text-foreground",
    active &&
      "z-10 bg-card text-foreground before:pointer-events-none before:absolute before:bottom-0 before:-left-2 before:size-2 before:[background:radial-gradient(circle_at_0_0,transparent_8px,var(--card)_8.5px)] after:pointer-events-none after:absolute after:right-[-8px] after:bottom-0 after:size-2 after:[background:radial-gradient(circle_at_100%_0,transparent_8px,var(--card)_8.5px)]",
    dragging && "z-20 text-foreground",
  );

/** Hover / drag fill of an inactive tab: a rounded rect inset from the tab's edges. */
const TabFill = ({ active, dragging }: { active: boolean; dragging: boolean }) =>
  active ? null : (
    <span
      aria-hidden
      className={cn(
        "absolute inset-x-0.5 inset-y-1 rounded-md transition-colors duration-(--duration-fast) group-hover/tab:bg-accent",
        dragging && "bg-accent",
      )}
    />
  );

/** Thin divider on a tab's left edge; hidden beside the active tab, while hovering, or dragging. */
const Separator = ({ hidden }: { hidden: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "absolute top-2.5 bottom-2.5 left-0 w-px bg-border transition-opacity duration-(--duration-fast) [.tab:hover+.tab_&]:opacity-0 [.tab:hover_&]:opacity-0",
      hidden && "opacity-0",
    )}
  />
);

type DragState = { id: string; from: number; to: number; dx: number; width: number };

type DocumentTabProps = {
  workspace: Workspace;
  index: number;
  active: boolean;
  /** The previous tab is active, so no divider between them. */
  afterActive: boolean;
  drag: DragState | null;
  focusable: boolean;
  register: (id: string, element: HTMLDivElement | null) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
};

const DocumentTab = ({
  workspace,
  index,
  active,
  afterActive,
  drag,
  focusable,
  register,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: DocumentTabProps) => {
  const { dirty, running } = useWorkspaceStatus(workspace.id);
  const title = useWorkspaceTitle(workspace.id);
  const dragging = drag !== null && drag.id === workspace.id;
  const shift = !drag
    ? 0
    : drag.id === workspace.id
      ? drag.dx
      : dragShift(index, drag.from, drag.to, drag.width);
  const Icon = workspace.kind === "project" ? FolderIcon : FileIcon;
  const style: CSSProperties | undefined = drag
    ? { transform: `translateX(${shift}px)` }
    : undefined;

  return (
    <div
      ref={(element) => register(workspace.id, element)}
      role="tab"
      aria-selected={active}
      tabIndex={focusable ? 0 : -1}
      title={workspace.dir ?? title}
      data-tab-id={workspace.id}
      style={style}
      className={cn(
        tabClass(active, dragging),
        "w-[220px] min-w-[100px] shrink",
        drag && !dragging && "transition-transform duration-(--duration-base) ease-out",
        dragging && "touch-none",
      )}
      onPointerDown={(event) => onPointerDown(event, index)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        requestCloseTab(workspace.id);
      }}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      <TabFill active={active} dragging={dragging} />
      {index > 0 ? <Separator hidden={active || afterActive || drag !== null} /> : null}
      <span className="relative flex min-w-0 flex-1 items-center gap-2 pr-1.5 pl-3">
        <span className="relative flex shrink-0">
          <Icon className="size-3.5" aria-hidden />
          {running ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-violet motion-safe:animate-pulse"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden text-xs font-medium whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-14px),transparent)]">
          {title}
          {dirty ? <span className="sr-only">, unsaved changes</span> : null}
          {running ? <span className="sr-only">, agent working</span> : null}
        </span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${title}`}
          title={`Close tab (${MOD}W)`}
          className="relative flex size-5 shrink-0 items-center justify-center rounded-sm outline-none transition-colors duration-(--duration-fast) hover:bg-accent"
          onClick={() => requestCloseTab(workspace.id)}
        >
          {dirty ? (
            <span
              aria-hidden
              className="absolute size-1.5 rounded-full bg-foreground transition-opacity duration-(--duration-fast) group-focus-within/tab:opacity-0 group-hover/tab:opacity-0"
            />
          ) : null}
          <XIcon
            aria-hidden
            className={cn(
              "size-3 transition-opacity duration-(--duration-fast) group-focus-within/tab:opacity-100 group-hover/tab:opacity-100",
              active && !dirty ? "opacity-100" : "opacity-0",
            )}
          />
        </button>
      </span>
    </div>
  );
};

/** "Update now" once an update is downloaded; a muted progress pill while it downloads. */
const UpdatePill = () => {
  const status = useUpdateStatus((s) => s.status);
  if (status.state === "ready") {
    return (
      <Button
        size="xs"
        className={cn("mb-1.5 rounded-full px-2.5", WINDOW_NO_DRAG_CLASS)}
        onClick={() => desktopApi()?.installUpdate()}
      >
        Update now
      </Button>
    );
  }
  if (status.state === "downloading") {
    return (
      <span
        role="status"
        className={cn(
          "mb-1.5 flex h-6 shrink-0 items-center rounded-full bg-muted px-2.5 text-xs text-muted-foreground tabular-nums",
          WINDOW_NO_DRAG_CLASS,
        )}
      >
        Downloading {clampPercent(status.percent)}%
      </span>
    );
  }
  return null;
};

type Edges = { start: boolean; end: boolean };

/**
 * Window-wide tab bar (Chrome-shaped, Figma-flat): update pill, Home, one tab per workspace and a
 * "+" button. On macOS desktop it sits right of the traffic lights and drags the window.
 */
export const TabBar = () => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const liveId = useWorkspaceStore((s) => s.liveId);
  const view = useWorkspaceStore((s) => s.view);
  const windowControls = useTrafficLightsInset();
  const desktop = desktopApi() !== undefined;

  const dashboard = view === "dashboard" || liveId === null;
  const activeId = dashboard ? null : liveId;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });
  const [drag, setDrag] = useState<DragState | null>(null);
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    from: number;
    rects: TabRect[];
    started: boolean;
  } | null>(null);
  const refocusId = useRef<string | null>(null);

  const register = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) tabRefs.current.set(id, element);
    else tabRefs.current.delete(id);
  }, []);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useLayoutEffect(() => {
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateEdges, workspaces.length]);

  // Keep the active tab visible (also after switching with the keyboard or opening a tab).
  useEffect(() => {
    if (activeId)
      tabRefs.current.get(activeId)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId, workspaces.length]);

  // Restore focus to a tab moved with the keyboard.
  useEffect(() => {
    if (!refocusId.current) return;
    tabRefs.current.get(refocusId.current)?.focus();
    refocusId.current = null;
  }, [workspaces]);

  const ids = workspaces.map((workspace) => workspace.id);

  const measure = (): TabRect[] =>
    ids.map((id) => {
      const el = tabRefs.current.get(id);
      return { left: el?.offsetLeft ?? 0, width: el?.offsetWidth ?? 0 };
    });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const id = ids[index];
    if (!id) return;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      from: index,
      rects: measure(),
      started: false,
    };
    activateTab(id);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const rawDx = event.clientX - g.startX;
    if (!g.started) {
      if (Math.abs(rawDx) < DRAG_THRESHOLD) return;
      g.started = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const dragged = g.rects[g.from];
    const first = g.rects[0];
    const last = g.rects[g.rects.length - 1];
    if (!dragged || !first || !last) return;
    const dx = Math.min(Math.max(rawDx, first.left - dragged.left), last.left - dragged.left);
    setDrag({
      id: ids[g.from] ?? "",
      from: g.from,
      to: dropIndex(g.rects, g.from, dx),
      dx,
      width: dragged.width,
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (!g.started) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const to = drag?.to ?? g.from;
    setDrag(null);
    if (event.type !== "pointercancel" && to !== g.from) {
      reorderWorkspaces(moveItem(ids, g.from, to));
    }
  };

  const focusTab = (element: Element | undefined) => (element as HTMLElement | undefined)?.focus();

  const onTabKeyDown = (event: KeyboardEvent<HTMLElement>, index: number | "home") => {
    const id = index === "home" ? HOME_TAB_ID : ids[index];
    if (!id) return;
    const tabs = Array.from(
      event.currentTarget.closest("[role=tablist]")?.querySelectorAll("[role=tab]") ?? [],
    );
    const position = tabs.indexOf(event.currentTarget);
    if (event.altKey && event.shiftKey && typeof index === "number") {
      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const to = index + step;
      if (!step || to < 0 || to >= ids.length) return;
      event.preventDefault();
      refocusId.current = id;
      reorderWorkspaces(moveItem(ids, index, to));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTab(id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(tabs[(position + 1) % tabs.length]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(tabs[(position - 1 + tabs.length) % tabs.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(tabs[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs[tabs.length - 1]);
    }
  };

  const fade = edges.start || edges.end;
  const maskStyle: CSSProperties | undefined = fade
    ? {
        maskImage: `linear-gradient(to right, transparent 0, #000 ${edges.start ? FADE : 0}px, #000 calc(100% - ${edges.end ? FADE : 0}px), transparent 100%)`,
      }
    : undefined;

  // Exactly one tab stays in the tab order (roving focus): the active one, else the first.
  const focusId = activeId ?? HOME_TAB_ID;

  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-end gap-1 bg-background pr-2",
        windowControls ? WINDOW_CONTROLS_INSET_CLASS : "pl-2",
        desktop && "[-webkit-app-region:drag]",
      )}
    >
      <UpdatePill />
      <div
        role="tablist"
        aria-label="Documents"
        className="flex h-full min-w-0 items-end"
        onWheel={(event) => {
          const el = scrollerRef.current;
          if (el && event.deltaX === 0 && event.deltaY !== 0) el.scrollLeft += event.deltaY;
        }}
      >
        <div
          role="tab"
          aria-selected={dashboard}
          aria-label="Home"
          tabIndex={focusId === HOME_TAB_ID ? 0 : -1}
          title="Home"
          className={cn(tabClass(dashboard, false), "mr-1 w-10 shrink-0 justify-center")}
          onPointerDown={(event) => {
            if (event.button === 0) activateTab(HOME_TAB_ID);
          }}
          onKeyDown={(event) => onTabKeyDown(event, "home")}
        >
          <TabFill active={dashboard} dragging={false} />
          <HomeIcon className="relative size-4" aria-hidden />
        </div>
        <div
          ref={scrollerRef}
          onScroll={updateEdges}
          style={maskStyle}
          className="relative flex h-full min-w-0 items-end overflow-x-auto overflow-y-hidden pr-2 pl-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {workspaces.map((workspace, index) => (
            <DocumentTab
              key={workspace.id}
              workspace={workspace}
              index={index}
              active={workspace.id === activeId}
              afterActive={workspaces[index - 1]?.id === activeId}
              drag={drag}
              focusable={workspace.id === focusId}
              register={register}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={onTabKeyDown}
            />
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="New tab"
        title={`New tab (${MOD}T)`}
        className={cn("mb-1.5 size-7 shrink-0 text-muted-foreground", WINDOW_NO_DRAG_CLASS)}
        onClick={() => runTabAction({ kind: "new" })}
      >
        <PlusIcon className="size-4" />
      </Button>
      <CloseConfirmDialog />
    </div>
  );
};
