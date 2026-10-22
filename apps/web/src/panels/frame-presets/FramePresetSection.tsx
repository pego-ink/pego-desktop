import { useMemo, useState } from "react";
import { ChevronDownIcon, LayoutTemplateIcon, RotateCwSquareIcon, SearchIcon } from "lucide-react";
import { resolveNumber, type FrameNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { PropertySection } from "@pego/ui/components/property-section";
import {
  formatPresetSize,
  matchFramePreset,
  searchFramePresets,
  swapOrientation,
  type FramePreset,
} from "@/interaction/frame-presets";
import { PresetThumb } from "@/panels/frame-presets/PresetThumb";
import { useApplyProps } from "@/panels/properties/use-apply-props";
import { useDocumentStore } from "@/store/use-document-store";
import { getLayout } from "@/canvas/layout";

/** Frame size area: searchable preset dropdown plus a portrait/landscape swap. */
export const FramePresetSection = ({ node }: { node: FrameNode }) => {
  const doc = useDocumentStore((s) => s.doc);
  const apply = useApplyProps([node]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const categories = useMemo(() => searchFramePresets(query), [query]);

  // Size as laid out, so fill/fit and variable sizes still show their real numbers.
  const box = getLayout(doc).get(node.id);
  const width = Math.round(box?.width ?? resolveNumber(node.width ?? 0, doc.variables, 0));
  const height = Math.round(box?.height ?? resolveNumber(node.height ?? 0, doc.variables, 0));
  const current = matchFramePreset(width, height);

  const pick = (preset: FramePreset) => {
    apply({ width: preset.width, height: preset.height }, `Resize to ${preset.name}`);
    setOpen(false);
  };

  return (
    <PropertySection title="Preset">
      <div className="flex items-center gap-2">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Frame size preset"
              className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent bg-muted px-2 text-left text-xs text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring data-[state=open]:border-ring"
            >
              <LayoutTemplateIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{current?.name ?? "Custom"}</span>
              <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0">
            <div className="relative border-b border-border p-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                autoFocus
                aria-label="Search frame sizes"
                placeholder="Search sizes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-7"
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {categories.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No sizes match
                </p>
              ) : (
                categories.map((category) => (
                  <div key={category.id} role="group" aria-label={category.name}>
                    <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">
                      {category.name}
                    </div>
                    {category.presets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => pick(preset)}
                        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
                      >
                        <PresetThumb width={preset.width} height={preset.height} />
                        <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {formatPresetSize(preset)}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Swap width and height"
          title="Swap width and height"
          disabled={width === height}
          onClick={() => apply(swapOrientation({ width, height }), "Swap orientation")}
        >
          <RotateCwSquareIcon />
        </Button>
      </div>
    </PropertySection>
  );
};
