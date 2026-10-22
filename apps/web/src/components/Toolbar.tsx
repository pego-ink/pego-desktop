import { Fragment, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { useToolStore, type Tool } from "@/store/use-tool-store";
import {
  TOOL_GROUPS,
  groupHasTool,
  shownEntry,
  tooltipFor,
  type ToolGroup,
} from "@/components/toolbar-groups";

const FOCUS_RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The navigation tools (Move, Hand) sit apart from the creation tools. */
const DIVIDER_AFTER = "hand";

type GroupButtonProps = { group: ToolGroup };

/** One toolbar group: a button for the shown tool, plus a chevron menu when it holds several. */
const GroupButton = ({ group }: GroupButtonProps) => {
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
    <div className="flex items-center">
      <button
        type="button"
        title={tooltipFor(shown)}
        aria-label={shown.label}
        aria-keyshortcuts={shown.shortcut || undefined}
        aria-pressed={active === shown.tool}
        onClick={() => setTool(shown.tool)}
        className={cn(
          "flex size-9 items-center justify-center rounded-lg transition-colors",
          FOCUS_RING,
          inGroup
            ? "bg-primary text-primary-foreground"
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
                "flex h-9 w-4 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
                FOCUS_RING,
              )}
            >
              <ChevronDownIcon className="size-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" aria-label={group.label}>
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

/** Floating tool picker, bottom center of the canvas. */
export const Toolbar = () => (
  <div
    role="toolbar"
    aria-label="Tools"
    className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-[0_8px_24px_#00000055]"
  >
    {TOOL_GROUPS.map((group) => (
      <Fragment key={group.id}>
        <GroupButton group={group} />
        {group.id === DIVIDER_AFTER ? (
          <div role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px bg-border" />
        ) : null}
      </Fragment>
    ))}
  </div>
);
