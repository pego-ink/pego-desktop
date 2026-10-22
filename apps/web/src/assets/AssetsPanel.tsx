import { useMemo } from "react";
import { ComponentIcon, PlusIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { getLayout } from "@/canvas/layout";
import { focusCamera } from "@/agent/focus-camera";
import { showPage } from "@/pages/page-actions";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { instanceOp, listComponents, type ComponentEntry } from "./components";

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

/** The project's assets: its components (reusable nodes), on any page. */
export const AssetsPanel = () => {
  const doc = useDocumentStore((s) => s.doc);
  const components = useMemo(() => listComponents(doc), [doc]);
  const multiPage = doc.children.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader>
        Components
        <span className="text-[11px] font-normal text-muted-foreground">{components.length}</span>
      </PanelHeader>
      {components.length === 0 ? (
        <p className="px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          No components yet. Components are reusable layers (for example a button or a card); ask
          the agent to turn a layer into one.
        </p>
      ) : (
        <ul aria-label="Components" className="min-h-0 flex-1 overflow-y-auto py-1">
          {components.map((entry) => (
            <li
              key={entry.id}
              className="group mx-1.5 flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-xs text-foreground hover:bg-accent/60"
              title="Click to show it, + to place an instance"
              onClick={() => revealComponent(entry)}
            >
              <ComponentIcon className="size-3.5 shrink-0 text-violet" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {multiPage ? (
                <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground">
                  {entry.pageName}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Insert ${entry.name}`}
                title="Place an instance on this page"
                className="hidden group-hover:inline-flex"
                onClick={(event) => {
                  event.stopPropagation();
                  insertInstance(entry);
                }}
              >
                <PlusIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
