import { useMemo, useRef, useState } from "react";
import { ChevronRightIcon, ComponentIcon, LibraryIcon, PlusIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { cn } from "@pego/ui/lib/utils";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { getLayout } from "@/canvas/layout";
import { focusCamera } from "@/agent/focus-camera";
import { showPage } from "@/pages/page-actions";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { useComponentThumbnail } from "./component-thumbnails";
import {
  COMPONENT_MIME,
  componentSections,
  instanceOp,
  listComponents,
  type ComponentEntry,
  type ComponentSection,
} from "./components";
import { LibrariesSection } from "./LibrariesSection";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Show a component: its page, selected, centered on the canvas. */
const revealComponent = (entry: ComponentEntry) => {
  showPage(entry.pageId);
  const { doc, select } = useDocumentStore.getState();
  select([entry.id]);
  const box = getLayout(doc).get(entry.id);
  const viewport = useViewportStore.getState();
  const camera = box ? focusCamera([box], viewport.size) : null;
  if (camera) viewport.setCamera(camera);
};

/** Place an instance of the component in the middle of the view on the shown page. */
const insertInstance = (entry: ComponentEntry) => {
  const state = useDocumentStore.getState();
  const { camera, size } = useViewportStore.getState();
  const box = getLayout(state.doc).get(entry.id);
  const centerX = (size.width / 2 - camera.panX) / camera.zoom;
  const centerY = (size.height / 2 - camera.panY) / camera.zoom;
  const op = instanceOp(entry, activePage(state).id, {
    x: centerX - (box?.width ?? 0) / 2,
    y: centerY - (box?.height ?? 0) / 2,
  });
  if (state.commit([op], { label: `Insert ${entry.name}` })) state.select([op.node.id]);
};

/** One component: its thumbnail (rendered once on screen) and name; drag it onto the canvas. */
const ComponentCard = ({ entry }: { entry: ComponentEntry }) => {
  const cardRef = useRef<HTMLLIElement>(null);
  const thumbnail = useComponentThumbnail(entry.id, cardRef);
  return (
    <li
      ref={cardRef}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(COMPONENT_MIME, entry.id);
      }}
      onClick={() => revealComponent(entry)}
      title="Click to show it, + or drag to place an instance"
      className="group relative flex cursor-default flex-col gap-1 rounded-md p-1 text-xs text-foreground outline-none hover:bg-accent/60"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm border border-border bg-muted/50">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain p-1.5"
          />
        ) : (
          <ComponentIcon aria-hidden className="size-4 text-violet/60" />
        )}
      </div>
      <span className="truncate px-0.5">{entry.name}</span>
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label={`Insert ${entry.name}`}
        title="Place an instance in the middle of the view"
        className="absolute top-2 right-2 hidden group-hover:inline-flex"
        onClick={(event) => {
          event.stopPropagation();
          insertInstance(entry);
        }}
      >
        <PlusIcon />
      </Button>
    </li>
  );
};

/** One page's (or library's) components, collapsible. */
const Section = ({ section }: { section: ComponentSection }) => {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={section.title} className="px-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-full items-center gap-1 rounded-sm px-1 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 transition-transform duration-(--duration-fast)",
            open && "rotate-90",
          )}
        />
        {section.library ? <LibraryIcon aria-hidden className="size-3" /> : null}
        <span className="min-w-0 flex-1 truncate text-left">{section.title}</span>
        <span>{section.entries.length}</span>
      </button>
      {open ? (
        <ul aria-label={`Components in ${section.title}`} className="grid grid-cols-2 gap-1 pb-2">
          {section.entries.map((entry) => (
            <ComponentCard key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </section>
  );
};

/**
 * The project's assets: its components grouped by page (libraries by name), searchable, as
 * thumbnails to click, insert or drag onto the canvas; then the libraries it uses.
 */
export const AssetsPanel = () => {
  const doc = useDocumentStore((s) => s.doc);
  const [query, setQuery] = useState("");
  const components = useMemo(() => listComponents(doc), [doc]);
  const sections = useMemo(
    () => componentSections(doc, components, query),
    [doc, components, query],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader>
        Components
        <span className="text-[11px] font-normal text-muted-foreground">{components.length}</span>
      </PanelHeader>
      {components.length === 0 ? (
        <p className="px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          No components yet. Select a layer and press {isMac ? "⌘⌥K" : "Ctrl+Alt+K"} (or ask the
          agent) to turn it into a reusable component.
        </p>
      ) : (
        <>
          <div className="px-3 pb-2">
            <Input
              value={query}
              placeholder="Search components…"
              aria-label="Search components"
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sections.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No component matches.</p>
            ) : (
              sections.map((section) => <Section key={section.pageId} section={section} />)
            )}
          </div>
        </>
      )}
      <LibrariesSection />
    </div>
  );
};
