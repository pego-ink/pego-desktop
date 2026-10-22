import { memo, useRef, type DragEvent, type MouseEvent } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { PegoNode } from "@pego/doc";
import { cn } from "@pego/ui/lib/utils";
import { LayerIcon } from "@/panels/LayerIcon";
import type { DropZone } from "@/panels/drop-position";

const INDENT_PX = 16;
const BASE_PAD_PX = 8;

export type LayerRowProps = {
  node: PegoNode;
  /** Display name from `layerLabel`. */
  label: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  hovered: boolean;
  renaming: boolean;
  /** Where the active drag would land relative to this row. */
  drop: DropZone | null;
  dragging: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  onStartRename: (id: string) => void;
  /** `name === null` means the rename was cancelled. */
  onEndRename: (id: string, name: string | null) => void;
  onDragStartRow: (id: string, event: DragEvent<HTMLElement>) => void;
  onDragOverRow: (id: string, ratio: number, event: DragEvent<HTMLElement>) => void;
  onDropRow: (event: DragEvent<HTMLElement>) => void;
  onDragEndRow: () => void;
};

const LayerRowImpl = ({
  node,
  label,
  depth,
  hasChildren,
  expanded,
  selected,
  hovered,
  renaming,
  drop,
  dragging,
  onToggle,
  onSelect,
  onHover,
  onStartRename,
  onEndRename,
  onDragStartRow,
  onDragOverRow,
  onDropRow,
  onDragEndRow,
}: LayerRowProps) => {
  const cancelled = useRef(false);
  const indent = BASE_PAD_PX + depth * INDENT_PX;

  const handleClick = (event: MouseEvent) =>
    onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey);

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      data-layer-id={node.id}
      draggable={!renaming}
      onClick={handleClick}
      onDoubleClick={() => onStartRename(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onKeyDown={(event) => {
        if (renaming) return;
        if (event.key === "Enter") onSelect(node.id, event.shiftKey);
        if (event.key === "F2") onStartRename(node.id);
      }}
      onDragStart={(event) => onDragStartRow(node.id, event)}
      onDragOver={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onDragOverRow(node.id, (event.clientY - rect.top) / rect.height, event);
      }}
      onDrop={onDropRow}
      onDragEnd={onDragEndRow}
      style={{ paddingLeft: indent }}
      className={cn(
        "relative flex h-7 cursor-default items-center gap-1.5 pr-3 text-[13px] text-foreground outline-none select-none focus-visible:bg-accent/60",
        hovered && !selected && "bg-accent/50",
        selected && "bg-accent",
        dragging && "opacity-40",
        drop === "inside" && "bg-accent ring-1 ring-inset ring-ring",
      )}
    >
      {drop === "before" || drop === "after" ? (
        <span
          aria-hidden
          style={{ left: indent }}
          className={cn(
            "pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-primary",
            drop === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={expanded ? "Collapse" : "Expand"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(node.id);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground",
          !hasChildren && "invisible",
        )}
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", expanded && "rotate-90")} />
      </button>
      <LayerIcon node={node} />
      {renaming ? (
        <input
          autoFocus
          defaultValue={label}
          spellCheck={false}
          aria-label="Layer name"
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const cancel = cancelled.current;
            cancelled.current = false;
            onEndRename(node.id, cancel ? null : event.currentTarget.value);
          }}
          className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-[13px] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
    </div>
  );
};

export const LayerRow = memo(LayerRowImpl);
