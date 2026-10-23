import type { AppState, AppStateBrowser, AppStateLayer } from "@pego/agent";
import {
  findNode,
  isContainer,
  pageOrFirst,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { useBrowserStore } from "@/browser/use-browser-store";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { documentTitle } from "@/workspace/live-document";

/** What the app state is read from; `collectAppState` fills it from the stores. */
export type AppStateInput = {
  doc: PegoDocument;
  pageId: string | null;
  selection: readonly string[];
  file: { fileName: string | null; bridgePath: string | null };
  layout: Layout;
  camera: Camera;
  viewport: { width: number; height: number };
  browser: AppStateBrowser | null;
};

const layerOf = (node: PegoNode): AppStateLayer => ({
  id: node.id,
  name: node.name?.trim() || node.type,
  type: node.type,
});

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every reusable node of the document, in tree order. */
const componentsOf = (nodes: readonly PegoNode[], out: PegoNode[] = []): PegoNode[] => {
  for (const node of nodes) {
    if (node.reusable === true) out.push(node);
    if (isContainer(node)) componentsOf(node.children, out);
  }
  return out;
};

export const buildAppState = (input: AppStateInput): AppState => {
  const page = pageOrFirst(input.doc, input.pageId);
  const { camera, viewport } = input;
  // The part of the page the canvas shows, in document coordinates (none before it has a size).
  const view =
    viewport.width > 0 && viewport.height > 0
      ? {
          x: -camera.panX / camera.zoom,
          y: -camera.panY / camera.zoom,
          width: viewport.width / camera.zoom,
          height: viewport.height / camera.zoom,
        }
      : null;
  return {
    document: {
      name: documentTitle(input.doc, input.file),
      file: input.file.bridgePath,
      page: page.name,
    },
    selection: input.selection.flatMap((id) => {
      const node = findNode(input.doc, id);
      return node ? [layerOf(node)] : [];
    }),
    topLevel: page.children.map((node) => {
      const box = input.layout.get(node.id);
      return {
        ...layerOf(node),
        inView: view !== null && box !== undefined && overlaps(box, view),
      };
    }),
    components: componentsOf(input.doc.children).map(layerOf),
    browser: input.browser,
  };
};

/** The app state of the shown document and the browser, read from the stores now. */
export const collectAppState = (): AppState => {
  const { doc, pageId, selection } = useDocumentStore.getState();
  const { fileName, bridgePath } = useFileStore.getState();
  const { camera, size } = useViewportStore.getState();
  const browser = useBrowserStore.getState();
  return buildAppState({
    doc,
    pageId,
    selection,
    file: { fileName, bridgePath },
    layout: getLayout(doc),
    camera,
    viewport: size,
    browser: browser.state.visible
      ? {
          url: browser.state.url,
          ...(browser.state.title ? { title: browser.state.title } : {}),
          picked: browser.picked
            ? {
                label: browser.picked.label,
                selector: browser.picked.selector,
                path: browser.picked.path
                  .map((crumb) =>
                    crumb.component ? `${crumb.component} · ${crumb.label}` : crumb.label,
                  )
                  .join(" > "),
              }
            : browser.hasPicked
              ? { label: "an element" }
              : null,
        }
      : null,
  });
};
