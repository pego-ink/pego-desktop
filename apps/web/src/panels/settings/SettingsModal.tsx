import { useRef, type ComponentType, type KeyboardEvent, type SVGProps } from "react";
import { InfoIcon, KeyboardIcon, SlidersHorizontalIcon, SparklesIcon, TagIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@pego/ui/components/dialog";
import { cn } from "@pego/ui/lib/utils";
import { useSettingsModal, type SettingsTab } from "@/store/use-settings-store";
import { PegoMark } from "@/components/PegoMark";
import { AboutTab } from "./AboutTab";
import { AgentNamesSettingsTab } from "./AgentNamesSettingsTab";
import { AgentSettingsTab } from "./AgentSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ShortcutsTab } from "./ShortcutsTab";
import { moveTabFocus } from "./tab-nav";

type TabItem = {
  id: SettingsTab;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const TABS: readonly TabItem[] = [
  { id: "general", label: "General & Editor", Icon: SlidersHorizontalIcon },
  { id: "agent", label: "Agent & Models", Icon: SparklesIcon },
  { id: "agent-names", label: "Agent names", Icon: TagIcon },
  { id: "shortcuts", label: "Keyboard shortcuts", Icon: KeyboardIcon },
  { id: "about", label: "About & Updates", Icon: InfoIcon },
];

const tabId = (id: SettingsTab) => `settings-tab-${id}`;
const panelId = (id: SettingsTab) => `settings-panel-${id}`;

const SettingsNav = ({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const next = moveTabFocus(
      buttons.indexOf(document.activeElement as HTMLButtonElement),
      e.key,
      buttons.length,
    );
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
    const item = TABS[next];
    if (item) onSelect(item.id);
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Settings sections"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border p-2 pr-12 sm:w-56 sm:flex-col sm:items-stretch sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-3"
    >
      <div className="mb-2 hidden items-center gap-2 px-2.5 pt-1 text-[15px] font-semibold text-foreground sm:flex">
        <PegoMark />
        Settings
      </div>
      {TABS.map(({ id, label, Icon }) => {
        const selected = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={panelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            className={cn(
              "flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] whitespace-nowrap text-muted-foreground outline-none transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-accent hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
              selected &&
                "bg-violet-soft text-violet-text hover:bg-violet-soft hover:text-violet-text",
            )}
          >
            <Icon aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
};

const TabContent = ({ tab, section }: { tab: SettingsTab; section: string | undefined }) => {
  switch (tab) {
    case "general":
      return <GeneralSettingsTab />;
    case "agent":
      return <AgentSettingsTab section={section} />;
    case "agent-names":
      return <AgentNamesSettingsTab />;
    case "shortcuts":
      return <ShortcutsTab />;
    case "about":
      return <AboutTab />;
  }
};

/** The one settings modal (mounted once at the app root). Opens via `useSettingsModal`. */
export const SettingsModal = () => {
  const open = useSettingsModal((s) => s.open);
  const tab = useSettingsModal((s) => s.tab);
  const section = useSettingsModal((s) => s.section);
  const openSettings = useSettingsModal((s) => s.openSettings);
  const close = useSettingsModal((s) => s.close);
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="h-[600px] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[780px] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Editor, agent, agent name, keyboard shortcut and update settings.
        </DialogDescription>
        <div className="flex h-full min-h-0 flex-col sm:flex-row">
          <SettingsNav tab={tab} onSelect={(next) => openSettings(next)} />
          <div
            key={tab}
            role="tabpanel"
            id={panelId(tab)}
            aria-labelledby={tabId(tab)}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-6"
          >
            <h2 className="mb-5 text-lg font-semibold">{current?.label}</h2>
            <TabContent tab={tab} section={section} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
