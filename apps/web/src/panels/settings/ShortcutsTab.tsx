import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@pego/ui/components/input";
import { filterShortcuts, formatKeyToken, type Chord } from "@/hooks/shortcut-catalog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const Kbd = ({ chord }: { chord: Chord }) => (
  <span className="inline-flex items-center gap-1">
    {chord.map((token, i) => (
      <kbd
        key={i}
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-1.5 font-sans text-[11px] text-foreground"
      >
        {formatKeyToken(token, isMac)}
      </kbd>
    ))}
  </span>
);

export const ShortcutsTab = () => {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => filterShortcuts(query), [query]);
  return (
    <div>
      <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 bg-card px-5 pt-5 pb-2">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search shortcuts"
            placeholder="Search shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7"
          />
        </div>
      </div>
      <div role="status" className="sr-only">
        {groups.length === 0 ? "No shortcuts found" : ""}
      </div>
      {groups.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No shortcuts match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="mb-6 last:mb-0" aria-labelledby={`sc-${group.id}`}>
            <h3 id={`sc-${group.id}`} className="mb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 py-1.5">
                  <span className="min-w-0 text-sm text-foreground">{entry.label}</span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                    {entry.chords.map((chord, i) => (
                      <Kbd key={i} chord={chord} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};
