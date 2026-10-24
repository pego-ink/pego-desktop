import { Fragment, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@pego/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { useSettingsStore } from "@/store/use-settings-store";
import { useToolStore, type Tool } from "@/store/use-tool-store";
import {
  TOOL_GROUPS,
  groupHasTool,
  shownEntry,
  tooltipFor,
  type ToolGroup,
} from "@/components/toolbar-groups";
import {
  TOOLBAR_POSITION_LABELS,
  TOOLBAR_POSITIONS,
  toolbarLayout,
  type ToolbarPosition,
} from "@/components/toolbar-position";

const FOCUS_RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The navigation tools (Move, Hand) sit apart from the creation tools. */
const DIVIDER_AFTER = "hand";

type GroupButtonProps = {
  group: ToolGroup;
  vertical: boolean;
  menuSide: "top" | "bottom" | "left" | "right";
};

/** One toolbar group: a button for the shown tool, plus a chevron menu when it holds several. */
const GroupButton = ({ group, vertical, menuSide }: GroupButtonProps) => {
  const active = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const [lastUsed, setLastUsed] = useState<Tool>(group.tools[0]?.tool ?? "select");
  const inGroup = groupHasTool(group, active);
  // Remember the group's last-used tool (also when it was picked with a shortcut).
  if (inGroup && active !== lastUsed) setLastUsed(active);

  const shown = shownEntry(group, lastUsed, active);
  const { Icon } = shown;
  const multi = group.tools.length > 1;

  return (
    <div className={cn("flex items-center", vertical && "flex-col")}>
      <button
        type="button"
        title={tooltipFor(shown)}
        aria-label={shown.label}
        aria-keyshortcuts={shown.shortcut || undefined}
        aria-pressed={active === shown.tool}
        onClick={() => setTool(shown.tool)}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg transition-colors",
          FOCUS_RING,
          inGroup
            ? "bg-violet-soft text-violet-text"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
      {multi ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={group.label}
              aria-label={group.label}
              className={cn(
                "flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                vertical ? "h-4 w-8" : "h-8 w-4",
                FOCUS_RING,
              )}
            >
              <ChevronDownIcon className="size-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={menuSide} align="start" aria-label={group.label}>
            {group.tools.map((entry) => (
              <DropdownMenuItem key={entry.tool} onSelect={() => setTool(entry.tool)}>
                <CheckIcon
                  className={cn("size-3.5", active !== entry.tool && "invisible")}
                  aria-hidden
                />
                <entry.Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">{entry.label}</span>
                {entry.shortcut ? (
                  <kbd className="ml-4 font-sans text-[11px] text-muted-foreground">
                    {entry.shortcut}
                  </kbd>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};

/**
 * Placement per position: centered on its edge of the canvas. Each stays clear of the zoom control
 * (bottom right) and the "show properties" button (top right): on a small canvas the toolbar
 * scrolls instead of covering them, and never gets shorter than 12rem (it stays usable).
 */
const POSITION_CLASS: Record<ToolbarPosition, string> = {
  bottom: "bottom-6 left-1/2 -translate-x-1/2 max-w-[max(calc(100%-23rem),12rem)] overflow-x-auto",
  top: "top-4 left-1/2 -translate-x-1/2 max-w-[max(calc(100%-7rem),12rem)] overflow-x-auto",
  left: "left-3 top-1/2 -translate-y-1/2 flex-col max-h-[max(calc(100%-8rem),12rem)] overflow-y-auto",
  right:
    "right-3 top-1/2 -translate-y-1/2 flex-col max-h-[max(calc(100%-8rem),12rem)] overflow-y-auto",
};

/**
 * Floating tool picker on the canvas: a row at the bottom (default) or top, a column on the left
 * or right (Settings › General, or right-click it).
 */
export const Toolbar = () => {
  const position = useSettingsStore((s) => s.toolbarPosition);
  const update = useSettingsStore((s) => s.update);
  const { vertical, menuSide } = toolbarLayout(position);
  // The Connector tool shows only while wireflow connectors are on (Settings).
  const connectors = useSettingsStore((s) => s.connectors);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="toolbar"
          aria-label="Tools"
          aria-orientation={vertical ? "vertical" : "horizontal"}
          className={cn(
            "absolute flex items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            POSITION_CLASS[position],
          )}
        >
          {TOOL_GROUPS.filter((group) => connectors || group.id !== "connector").map((group) => (
            <Fragment key={group.id}>
              <GroupButton group={group} vertical={vertical} menuSide={menuSide} />
              {group.id === DIVIDER_AFTER ? (
                <div
                  role="separator"
                  aria-orientation={vertical ? "horizontal" : "vertical"}
                  className={vertical ? "my-1 h-px w-5 bg-border" : "mx-1 h-5 w-px bg-border"}
                />
              ) : null}
            </Fragment>
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-40" aria-label="Toolbar position">
        <div className="px-2 py-1 text-xs text-muted-foreground">Toolbar position</div>
        {TOOLBAR_POSITIONS.map((value) => (
          <ContextMenuCheckboxItem
            key={value}
            checked={position === value}
            onCheckedChange={() => update({ toolbarPosition: value })}
          >
            {TOOLBAR_POSITION_LABELS[value]}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
};
