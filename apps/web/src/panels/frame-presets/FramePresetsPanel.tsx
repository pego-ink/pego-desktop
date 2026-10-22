import { useMemo, useState } from "react";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { Input } from "@pego/ui/components/input";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { cn } from "@pego/ui/lib/utils";
import { HidePanelButton } from "@/layout/PanelToggles";
import {
  formatPresetSize,
  searchFramePresets,
  type FramePreset,
} from "@/interaction/frame-presets";
import { insertPresetFrame } from "@/panels/frame-presets/create-preset-frame";
import { PresetThumb } from "@/panels/frame-presets/PresetThumb";
import { useOpenCategories } from "@/panels/frame-presets/use-open-categories";

const PresetRow = ({ preset }: { preset: FramePreset }) => (
  <li>
    <button
      type="button"
      onClick={() => insertPresetFrame(preset)}
      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
    >
      <PresetThumb width={preset.width} height={preset.height} />
      <span className="min-w-0 flex-1 truncate">{preset.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {formatPresetSize(preset)}
      </span>
    </button>
  </li>
);

/** Right column while the Frame tool is active: pick a size to create a ready-made frame. */
export const FramePresetsPanel = () => {
  const [query, setQuery] = useState("");
  const open = useOpenCategories((s) => s.open);
  const toggle = useOpenCategories((s) => s.toggle);
  const categories = useMemo(() => searchFramePresets(query), [query]);
  const searching = query.trim() !== "";

  return (
    <>
      <PanelHeader>
        <span>Frame</span>
        <HidePanelButton side="right" />
      </PanelHeader>
      <div className="border-b border-border p-2">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search frame sizes"
            placeholder="Search sizes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-7"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {categories.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No sizes match &ldquo;{query.trim()}&rdquo;
          </p>
        ) : (
          categories.map((category) => {
            const expanded = searching || open.includes(category.id);
            return (
              <section key={category.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(category.id)}
                  className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={cn(
                      "size-3 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  {category.name}
                </button>
                {expanded ? (
                  <ul className="pb-1">
                    {category.presets.map((preset) => (
                      <PresetRow key={preset.id} preset={preset} />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </>
  );
};
