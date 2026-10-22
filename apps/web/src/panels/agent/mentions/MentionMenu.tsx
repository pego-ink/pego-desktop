import { Fragment } from "react";
import { cn } from "@pego/ui/lib/utils";
import { MentionPill } from "./MentionPill";
import type { MentionItem } from "./mention-sources";

type MentionMenuProps = {
  items: readonly MentionItem[];
  /** Highlighted row (keyboard). */
  active: number;
  onChoose: (item: MentionItem) => void;
  onHover: (index: number) => void;
};

/**
 * The @ menu above the composer: rows grouped by section (Selection, Layers, Components,
 * Skills, Styles, Attachments). Keys are handled by the editor; mouse clicks never take the
 * focus away from it.
 */
export const MentionMenu = ({ items, active, onChoose, onHover }: MentionMenuProps) => (
  <div
    role="listbox"
    aria-label="Mention"
    onMouseDown={(event) => event.preventDefault()}
    className="absolute right-0 bottom-full left-0 z-50 mb-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg animate-[pego-pop-in_var(--duration-fast)_var(--ease-out)]"
  >
    {items.length === 0 ? (
      <div className="px-2 py-1.5 text-[13px] text-muted-foreground">No matches</div>
    ) : (
      items.map((item, index) => (
        <Fragment key={item.key}>
          {index === 0 || items[index - 1]!.section !== item.section ? (
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
              {item.section}
            </div>
          ) : null}
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            ref={
              index === active
                ? (element) => element?.scrollIntoView({ block: "nearest" })
                : undefined
            }
            onMouseEnter={() => onHover(index)}
            onClick={() => onChoose(item)}
            className={cn(
              "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none",
              index === active && "bg-accent",
            )}
          >
            <MentionPill
              kind={item.ref.kind}
              label={item.title}
              className="max-w-[60%] bg-transparent px-0"
            />
            {item.detail ? (
              <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
                {item.detail}
              </span>
            ) : null}
          </button>
        </Fragment>
      ))
    )}
  </div>
);
