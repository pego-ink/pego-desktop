import { ChevronDownIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { Tooltip } from "@pego/ui/components/tooltip";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { ZOOM_STEP, formatZoomPercent, selectionBounds } from "@/interaction/zoom-utils";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

const zoomIn = () => useViewportStore.getState().zoomCenterBy(ZOOM_STEP);
const zoomOut = () => useViewportStore.getState().zoomCenterBy(1 / ZOOM_STEP);
const zoomTo = (zoom: number) => useViewportStore.getState().zoomCenterTo(zoom);
const zoomToFit = () => {
  const { doc, pageId } = useDocumentStore.getState();
  useViewportStore.getState().zoomToFit(contentBounds(doc, getLayout(doc), pageId));
};
const zoomToSelection = () => {
  const { doc, selection } = useDocumentStore.getState();
  useViewportStore.getState().zoomToFit(selectionBounds(getLayout(doc), selection, doc));
};

type MenuAction = { label: string; shortcut?: string; run: () => void; needsSelection?: boolean };

const MENU: readonly (MenuAction | "separator")[] = [
  { label: "Zoom in", shortcut: "⌘+", run: zoomIn },
  { label: "Zoom out", shortcut: "⌘−", run: zoomOut },
  { label: "Zoom to fit", shortcut: "⇧1", run: zoomToFit },
  { label: "Zoom to selection", shortcut: "⇧2", run: zoomToSelection, needsSelection: true },
  "separator",
  { label: "50%", run: () => zoomTo(0.5) },
  { label: "100%", shortcut: "⇧0", run: () => zoomTo(1) },
  { label: "200%", run: () => zoomTo(2) },
];

/** Floating zoom control: [−] [100% ▾] [+]. Mount inside the (relative) canvas region. */
export const ZoomControl = () => {
  const zoom = useViewportStore((s) => s.camera.zoom);
  const hasSelection = useDocumentStore((s) => s.selection.length > 0);
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-xl border border-border bg-card p-0.5 shadow-lg"
    >
      <Tooltip content="Zoom out" shortcut="−" side="top">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={zoomOut}>
          <MinusIcon />
        </Button>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Zoom level ${formatZoomPercent(zoom)}, open zoom menu`}
            className="min-w-16 gap-1 px-2 font-mono text-xs tabular-nums"
          >
            <span>{formatZoomPercent(zoom)}</span>
            <ChevronDownIcon className="size-3 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" aria-label="Zoom menu" className="min-w-48">
          {MENU.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <DropdownMenuItem
                key={item.label}
                disabled={item.needsSelection && !hasSelection}
                onSelect={item.run}
                className="data-[disabled]:opacity-50"
              >
                <span className="flex-1">{item.label}</span>
                {item.shortcut ? (
                  <kbd className="ml-4 font-sans text-[11px] text-muted-foreground">
                    {item.shortcut}
                  </kbd>
                ) : null}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip content="Zoom in" shortcut="+" side="top">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={zoomIn}>
          <PlusIcon />
        </Button>
      </Tooltip>
    </div>
  );
};
