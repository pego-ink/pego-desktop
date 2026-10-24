import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@pego/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { ensureFontPreview } from "@/fonts/font-service";
import {
  buildRows,
  CATEGORY_CHIPS,
  DEFAULT_FAMILY,
  firstFontIndex,
  searchFamilies,
  stepActive,
  visibleRange,
  type FontFilter,
} from "@/panels/properties/font/font-utils";
import { useFontCatalog, useRecentFonts } from "@/panels/properties/font/use-font-picker-data";

const ROW_HEIGHT = 28;
const LIST_HEIGHT = 224;

const previewStack = (family: string) => `"${family}", Inter, sans-serif`;

type Props = {
  /** Current family; undefined when the selection mixes families. */
  value: string | undefined;
  mixed: boolean;
  documentFamilies: readonly string[];
  onSelect: (family: string) => void;
};

const Chips = ({
  value,
  onChange,
}: {
  value: FontFilter;
  onChange: (value: FontFilter) => void;
}) => (
  <div role="radiogroup" aria-label="Font category" className="flex flex-wrap gap-1 px-1 pb-1">
    {CATEGORY_CHIPS.map((chip) => (
      <button
        key={chip.value}
        type="button"
        role="radio"
        aria-checked={chip.value === value}
        tabIndex={-1}
        onClick={() => onChange(chip.value)}
        className={cn(
          "h-5 rounded-full px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          chip.value === value ? "bg-secondary text-foreground" : "bg-muted",
        )}
      >
        {chip.label}
      </button>
    ))}
  </div>
);

const PickerBody = ({
  value,
  documentFamilies,
  onPick,
}: {
  value: string | undefined;
  documentFamilies: readonly string[];
  onPick: (family: string) => void;
}) => {
  const listId = useId();
  const catalog = useFontCatalog();
  const recent = useRecentFonts();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontFilter>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const names = catalog.length
      ? searchFamilies(catalog, query, category).map((info) => info.family)
      : [DEFAULT_FAMILY].filter((family) =>
          family.toLowerCase().includes(query.trim().toLowerCase()),
        );
    const showGroups = !query.trim() && category === "all";
    return buildRows({ documentFamilies, recent, catalog: names }, showGroups);
  }, [catalog, query, category, documentFamilies, recent]);

  const active = rows[activeIndex]?.kind === "font" ? activeIndex : firstFontIndex(rows);
  const { start, end } = visibleRange(scrollTop, LIST_HEIGHT, ROW_HEIGHT, rows.length);
  const visible = rows.slice(start, end);
  const visibleFamilies = visible.map((row) => (row.kind === "font" ? row.family : "")).join("\n");

  useEffect(() => {
    for (const family of visibleFamilies.split("\n")) if (family) ensureFontPreview(family);
  }, [visibleFamilies]);

  const reset = (action: () => void) => {
    action();
    setActiveIndex(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const moveTo = (index: number) => {
    setActiveIndex(index);
    const list = listRef.current;
    if (!list) return;
    const top = index * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(stepActive(rows, active, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row?.kind === "font") onPick(row.family);
    }
  };

  const activeRow = rows[active];
  const activeId = activeRow?.kind === "font" ? `${listId}-${activeRow.key}` : undefined;

  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <div className="relative p-1">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label="Search fonts"
          placeholder="Search fonts"
          spellCheck={false}
          autoComplete="off"
          className="pl-7"
          value={query}
          onChange={(event) => reset(() => setQuery(event.target.value))}
        />
      </div>
      <Chips value={category} onChange={(next) => reset(() => setCategory(next))} />
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Fonts"
        style={{ height: LIST_HEIGHT }}
        className="relative min-h-0 shrink overflow-y-auto overscroll-contain"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-muted-foreground">No fonts match.</p>
        ) : null}
        <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
          {visible.map((row, offset) => {
            const index = start + offset;
            const style = { top: index * ROW_HEIGHT, height: ROW_HEIGHT };
            if (row.kind === "header") {
              return (
                <div
                  key={row.key}
                  role="presentation"
                  style={style}
                  className="absolute inset-x-0 flex items-end px-2 pb-1 text-xs font-medium text-muted-foreground"
                >
                  {row.label}
                </div>
              );
            }
            return (
              <div
                key={row.key}
                id={`${listId}-${row.key}`}
                role="option"
                aria-selected={row.family === value}
                style={{ ...style, fontFamily: previewStack(row.family) }}
                onMouseMove={() => index !== active && setActiveIndex(index)}
                onClick={() => onPick(row.family)}
                className={cn(
                  "absolute inset-x-0 flex cursor-default items-center truncate rounded-md px-2 text-sm text-foreground",
                  index === active && "bg-accent",
                  row.family === value && "text-primary",
                )}
              >
                <span className="truncate">{row.family}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const FontFamilyPicker = ({ value, mixed, documentFamilies, onSelect }: Props) => {
  const [open, setOpen] = useState(false);
  const label = mixed ? "Mixed" : (value ?? DEFAULT_FAMILY);

  useEffect(() => {
    if (!mixed) ensureFontPreview(label);
  }, [mixed, label]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Font family"
          className="flex h-7 w-full min-w-0 items-center rounded-md border border-transparent bg-muted px-2 text-left text-[13px] text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring data-[state=open]:border-ring"
        >
          <span
            className={cn("truncate", mixed && "text-muted-foreground")}
            style={mixed ? undefined : { fontFamily: previewStack(label) }}
          >
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-(--radix-popover-content-available-height) min-w-64 flex-col p-0 pt-1"
        collisionPadding={8}
      >
        <PickerBody
          value={mixed ? undefined : value}
          documentFamilies={documentFamilies}
          onPick={(family) => {
            setOpen(false);
            onSelect(family);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
