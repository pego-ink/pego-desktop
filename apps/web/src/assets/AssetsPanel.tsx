import { memo, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, ComponentIcon, LibraryIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { cn } from "@pego/ui/lib/utils";
import { getLayout } from "@/canvas/layout";
import { focusCamera } from "@/agent/focus-camera";
import { showPage } from "@/pages/page-actions";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore, viewportCenter, visibleRect } from "@/store/use-viewport-store";
import { useComponentThumbnail } from "./component-thumbnails";
import {
  COMPONENT_MIME,
  componentSections,
  instanceOp,
  stableComponents,
  type ComponentEntry,
  type ComponentSection,
} from "./components";
import { LibrariesSection } from "./LibrariesSection";
import { ImagesTab } from "@/images/ImagesTab";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Show a component: its page, selected, centered on the canvas. */
const revealComponent = (entry: ComponentEntry) => {
  showPage(entry.pageId);
  const { doc, select } = useDocumentStore.getState();
  select([entry.id]);
  const box = getLayout(doc).get(entry.id);
  const viewport = useViewportStore.getState();
  const camera = box ? focusCamera([box], visibleRect(viewport)) : null;
  if (camera) viewport.setCamera(camera);
};

/** Place an instance of the component in the middle of the view on the shown page. */
const insertInstance = (entry: ComponentEntry) => {
  const state = useDocumentStore.getState();
  const { camera } = useViewportStore.getState();
  const box = getLayout(state.doc).get(entry.id);
  // The middle of what the user sees (floating panels cover the rest of the canvas).
  const middle = viewportCenter();
  const centerX = (middle.x - camera.panX) / camera.zoom;
  const centerY = (middle.y - camera.panY) / camera.zoom;
  const op = instanceOp(entry, activePage(state).id, {
    x: centerX - (box?.width ?? 0) / 2,
    y: centerY - (box?.height ?? 0) / 2,
  });
  if (state.commit([op], { label: `Insert ${entry.name}` })) state.select([op.node.id]);
};

/** One component: its thumbnail (rendered once on screen) and name; drag it onto the canvas. */
const ComponentCard = memo(({ entry }: { entry: ComponentEntry }) => {
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
      className="group relative rounded-xl text-[13px] text-foreground"
    >
      <button
        type="button"
        onClick={() => revealComponent(entry)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !event.shiftKey) return;
          event.preventDefault();
          insertInstance(entry);
        }}
        aria-label={`${entry.name}, component. Enter shows it, Shift+Enter places an instance.`}
        title="Click to show it, + or drag to place an instance"
        className="flex w-full cursor-default flex-col gap-1.5 rounded-xl p-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted transition-colors group-hover:border-ring/50">
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
        </span>
        <span className="flex w-full items-center gap-1.5 px-0.5">
          <ComponentIcon aria-hidden className="size-3.5 shrink-0 text-violet" />
          <span className="min-w-0 truncate">{entry.name}</span>
        </span>
      </button>
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label={`Insert ${entry.name}`}
        title="Place an instance in the middle of the view"
        className="absolute top-2 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => insertInstance(entry)}
      >
        <PlusIcon />
      </Button>
    </li>
  );
});
ComponentCard.displayName = "ComponentCard";

/** One page's (or library's) components, collapsible. */
const Section = ({ section }: { section: ComponentSection }) => {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={section.title} className="px-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-[13px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
        <span className="font-mono text-xs font-normal text-subtle-foreground">
          {section.entries.length}
        </span>
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
type AssetsTab = "components" | "images";

const TABS: readonly { id: AssetsTab; label: string }[] = [
  { id: "components", label: "Components" },
  { id: "images", label: "Images" },
];

/** The document's components (with libraries), as before. */
const ComponentsTab = () => {
  const doc = useDocumentStore((s) => s.doc);
  const [query, setQuery] = useState("");
  // New entry objects only for components that changed, so cards skip unrelated edits.
  const components = useMemo(() => stableComponents(doc), [doc]);
  const sections = useMemo(
    () => componentSections(doc, components, query),
    [doc, components, query],
  );

  return (
    <>
      {components.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-4 text-muted-foreground">
          No components yet. Select a layer and press {isMac ? "⌘⌥K" : "Ctrl+Alt+K"} (or ask the
          agent) to turn it into a reusable component.
        </p>
      ) : (
        <>
          <div className="relative px-3 pb-2">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-2 left-5.5 size-3.5 text-subtle-foreground"
            />
            <Input
              value={query}
              placeholder="Search components…"
              aria-label="Search components"
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sections.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No component matches.</p>
            ) : (
              sections.map((section) => <Section key={section.pageId} section={section} />)
            )}
          </div>
        </>
      )}
      <LibrariesSection />
    </>
  );
};

/** Assets: the document's components, and a search for free photos. */
export const AssetsPanel = () => {
  const [tab, setTab] = useState<AssetsTab>("components");
  const count = useDocumentStore((s) => stableComponents(s.doc).length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-3">
        <div
          role="tablist"
          aria-label="Assets"
          className="flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-full flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === id
                  ? "bg-violet-soft font-medium text-violet-text"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {id === "components" ? (
                <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] leading-4 font-normal text-primary-foreground">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {tab === "components" ? <ComponentsTab /> : <ImagesTab />}
    </div>
  );
};
