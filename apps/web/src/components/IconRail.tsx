import { useEffect, useRef, type ComponentType, type KeyboardEvent, type SVGProps } from "react";
import { LayersIcon, SparklesIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { Tooltip } from "@pego/ui/components/tooltip";
import {
  RAIL_TABS,
  moveRailFocus,
  railTabForShortcut,
  type RailState,
  type RailTab,
} from "@/components/rail-state";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const ALT = isMac ? "⌥" : "Alt+";

const TAB_ICONS: Record<RailTab, ComponentType<SVGProps<SVGSVGElement>>> = {
  agent: SparklesIcon,
  layers: LayersIcon,
};

export const railPanelId = (tab: RailTab) => `left-panel-${tab}`;
export const railTabId = (tab: RailTab) => `rail-tab-${tab}`;

/** Pego mark (design/logo/pego-mark.svg) without its background tile. */
const PegoMark = () => (
  <svg aria-hidden viewBox="0 0 222.35 245.8" className="h-5 w-auto fill-current">
    <path
      fillRule="nonzero"
      d="M150.04999 0l-109.4 0c-22.19999 0-40.64999 18.35-40.64999 41.8l0 164.55001c0 22.79998 18.6 39.45001 39.39999 39.45001l118.60001 0c10.5 0 20.85001-3.60001 26.45001-10.05002 4.04999-4.54999 3-9.5-1.54999-12.39999l-16.30001-10.95002c-3.65001-2.29998-8.65001-1.85-11.2 0.85001l-23.90001 24.30002c-3.40001 3.59997-8.45 0.94998-8.45-4.15003l0-76.6c0-4.04999 3.5-6.15 6.84999-4.75l47.65 21.39999c0.85 0.35004 1.35 0.10001 2.04999-0.19998 21.15002-9.89999 42.75003-40.20001 42.75003-82.55001 0-54.39999-34.25-90.69999-72.30002-90.69999z m-29.94998 131.85001l-37.5 0c-9.35001 0-16.40001-7.15002-16.40001-16.50001l0-40.3c0-11.85001 8.65001-20.09999 20.25001-20.09999l40.04999-0.00001c17.8 0 32.39999 16.64999 32.39999 36.4 0 23.70001-20 40.50001-38.79998 40.50001z"
    />
  </svg>
);

type Props = {
  state: RailState;
  /** Shows the pulsing dot on the Agent icon (a run is active). */
  agentWorking: boolean;
  onPress: (tab: RailTab) => void;
};

/** Narrow vertical tab rail: Agent and Layers. The active tab toggles the side panel. */
export const IconRail = ({ state, agentWorking, onPress }: Props) => {
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
      <div className="flex h-7 items-center justify-center text-foreground" title="Pego">
        <PegoMark />
      </div>
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
          const selected = state.open && state.tab === item.id;
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
    </nav>
  );
};
