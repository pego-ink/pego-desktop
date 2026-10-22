import { useEffect, useRef, type ComponentType, type KeyboardEvent, type SVGProps } from "react";
import { ComponentIcon, LayersIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { Tooltip } from "@pego/ui/components/tooltip";
import {
  RAIL_TABS,
  moveRailFocus,
  railTabForShortcut,
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
};

/** Narrow vertical tab rail: Agent, Layers and Assets. The active tab toggles the side panel. */
export const IconRail = ({ state, agentWorking, onPress, onHome, homeActive = false }: Props) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const tab = railTabForShortcut(e);
      if (!tab) return;
      e.preventDefault();
      onPress(tab);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPress]);

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const next = moveRailFocus(
      buttons.indexOf(document.activeElement as HTMLButtonElement),
      e.key,
      buttons.length,
    );
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <nav
      aria-label="Editor sidebar"
      className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-border bg-card py-2.5"
    >
      {onHome ? (
        <Tooltip content="Projects">
          <button
            type="button"
            aria-label="Projects dashboard"
            aria-current={homeActive ? "page" : undefined}
            onClick={onHome}
            className={cn(
              "flex size-8 items-center justify-center rounded-md outline-none transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]",
              homeActive && "bg-secondary",
            )}
          >
            <PegoMark />
          </button>
        </Tooltip>
      ) : (
        <div className="flex h-7 items-center justify-center text-foreground" title="Pego">
          <PegoMark />
        </div>
      )}
      <div
        ref={listRef}
        role="tablist"
        aria-label="Side panel"
        aria-orientation="vertical"
        onKeyDown={onListKeyDown}
        className="flex flex-col items-center gap-1"
      >
        {RAIL_TABS.map((item, index) => {
          const Icon = TAB_ICONS[item.id];
          const selected = !homeActive && state.open && state.tab === item.id;
          const focusable = state.tab === item.id;
          const shortcut = `${ALT}${index + 1}`;
          return (
            <Tooltip key={item.id} content={item.label} shortcut={shortcut}>
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
                  "relative flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97] [&_svg]:size-4",
                  selected && "bg-secondary text-foreground",
                )}
              >
                <Icon />
                {item.id === "agent" && agentWorking && !selected ? (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 size-1.5 rounded-full bg-[#B79CFF] motion-safe:animate-pulse"
                  />
                ) : null}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip content="Settings" shortcut={`${isMac ? "⌘" : "Ctrl+"},`}>
        <button
          type="button"
          aria-label="Settings"
          aria-keyshortcuts="Control+, Meta+,"
          aria-haspopup="dialog"
          onClick={() => {
            const { tab, openSettings } = useSettingsModal.getState();
            openSettings(tab);
          }}
          className="mt-auto flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97] [&_svg]:size-4"
        >
          <SettingsIcon />
        </button>
      </Tooltip>
    </nav>
  );
};
