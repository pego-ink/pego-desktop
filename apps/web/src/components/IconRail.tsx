import {
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
} from "react";
import { ComponentIcon, GlobeIcon, LayersIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { Tooltip } from "@pego/ui/components/tooltip";
import {
  hasDesktopBrowser,
  moveRailFocus,
  railTabForShortcut,
  railTabsFor,
  type RailState,
  type RailTab,
} from "@/components/rail-state";
import { useSettingsModal } from "@/store/use-settings-store";
import { PegoMark } from "@/components/PegoMark";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const ALT = isMac ? "⌥" : "Alt+";

const TAB_ICONS: Record<RailTab, ComponentType<SVGProps<SVGSVGElement>>> = {
  agent: SparklesIcon,
  layers: LayersIcon,
  assets: ComponentIcon,
  browser: GlobeIcon,
};

export const railPanelId = (tab: RailTab) => `left-panel-${tab}`;
export const railTabId = (tab: RailTab) => `rail-tab-${tab}`;

type Props = {
  state: RailState;
  /** Shows the pulsing dot on the Agent icon (a run is active). */
  agentWorking: boolean;
  onPress: (tab: RailTab) => void;
  /** When set (bridge projects are available), the logo opens the projects dashboard. */
  onHome?: () => void;
  /** The dashboard is shown: the logo is the current page and no tab is selected. */
  homeActive?: boolean;
  /** Extra classes for the rail (the floating layout drops its edge when it stands alone). */
  className?: string;
  /** "horizontal": a row of icons on top of the floating side card (no logo; Home is a tab). */
  orientation?: "vertical" | "horizontal";
  /** The Browser opens in its own right-hand column, which is open now: its icon shows active. */
  browserColumnOpen?: boolean;
};

/**
 * Tab rail: Agent, Layers, Assets and (desktop) Browser, then Settings. The active tab toggles the
 * side panel. A narrow column by default; a row on top of the floating side card.
 */
export const IconRail = ({
  state,
  agentWorking,
  onPress,
  onHome,
  homeActive = false,
  className,
  orientation = "vertical",
  browserColumnOpen = false,
}: Props) => {
  const horizontal = orientation === "horizontal";
  const tipSide = horizontal ? "bottom" : "right";
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = useMemo(() => railTabsFor(hasDesktopBrowser()), []);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const tab = railTabForShortcut(e, tabs);
      if (!tab) return;
      e.preventDefault();
      onPress(tab);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPress, tabs]);

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    // A row moves with Left/Right (Up/Down do nothing there), a column with Up/Down; Home and
    // End work in both.
    const ROW_KEYS: Record<string, string> = {
      ArrowRight: "ArrowDown",
      ArrowLeft: "ArrowUp",
      ArrowDown: "",
      ArrowUp: "",
    };
    const key = horizontal ? (ROW_KEYS[e.key] ?? e.key) : e.key;
    const next = moveRailFocus(
      buttons.indexOf(document.activeElement as HTMLButtonElement),
      key ?? "",
      buttons.length,
    );
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <nav
      aria-label="Editor sidebar"
      className={cn(
        horizontal
          ? "flex h-11 shrink-0 items-center gap-1 border-b border-border bg-chrome px-2"
          : "flex w-12 shrink-0 flex-col items-center gap-3 border-r border-border bg-chrome py-2.5",
        className,
      )}
    >
      {horizontal ? null : onHome ? (
        <Tooltip content="Projects">
          <button
            type="button"
            aria-label="Projects dashboard"
            aria-current={homeActive ? "page" : undefined}
            onClick={onHome}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg bg-violet-soft outline-none transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-violet-soft/70 focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]",
              homeActive && "ring-1 ring-violet",
            )}
          >
            <PegoMark />
          </button>
        </Tooltip>
      ) : (
        <div
          className="flex size-8 items-center justify-center rounded-lg bg-violet-soft text-foreground"
          title="Pego"
        >
          <PegoMark />
        </div>
      )}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Side panel"
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        onKeyDown={onListKeyDown}
        className={cn("flex items-center gap-1", !horizontal && "flex-col")}
      >
        {tabs.map((item, index) => {
          const Icon = TAB_ICONS[item.id];
          const selected =
            !homeActive &&
            ((state.open && state.tab === item.id) || (item.id === "browser" && browserColumnOpen));
          const focusable = state.tab === item.id;
          const shortcut = `${ALT}${index + 1}`;
          return (
            <Tooltip key={item.id} content={item.label} shortcut={shortcut} side={tipSide}>
              <button
                type="button"
                role="tab"
                id={railTabId(item.id)}
                aria-label={item.label}
                aria-selected={selected}
                aria-controls={railPanelId(item.id)}
                aria-keyshortcuts={`Alt+${index + 1}`}
                tabIndex={focusable ? 0 : -1}
                onClick={() => onPress(item.id)}
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97] [&_svg]:size-4",
                  selected &&
                    "bg-violet-soft text-violet-text hover:bg-violet-soft hover:text-violet-text",
                )}
              >
                <Icon />
                {item.id === "agent" && agentWorking && !selected ? (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 size-1.5 rounded-full bg-violet motion-safe:animate-pulse"
                  />
                ) : null}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip content="Settings" shortcut={`${isMac ? "⌘" : "Ctrl+"},`} side={tipSide}>
        <button
          type="button"
          aria-label="Settings"
          aria-keyshortcuts="Control+, Meta+,"
          aria-haspopup="dialog"
          onClick={() => {
            const { tab, openSettings } = useSettingsModal.getState();
            openSettings(tab);
          }}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97] [&_svg]:size-4",
            horizontal ? "ml-auto" : "mt-auto",
          )}
        >
          <SettingsIcon />
        </button>
      </Tooltip>
    </nav>
  );
};
