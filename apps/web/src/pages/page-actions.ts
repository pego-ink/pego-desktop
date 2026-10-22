import { createId, pageOf, type PageNode } from "@pego/doc";
import type { Camera } from "@/canvas/types";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Where the user left each page, so switching back returns to the same view. */
const cameras = new Map<string, Camera>();
/** Keyed per document too: two open documents may both have a "page-1". */
const cameraKey = (docId: string, pageId: string) => `${docId}/${pageId}`;

/** "Page N" with the first N not used by another page. */
export const nextPageName = (pages: readonly Pick<PageNode, "name">[]): string => {
  const taken = new Set(pages.map((page) => page.name));
  let n = pages.length + 1;
  while (taken.has(`Page ${n}`)) n++;
  return `Page ${n}`;
};

/** Show a page on the canvas, restoring its last camera or fitting its content. */
export const showPage = (pageId: string): void => {
  const state = useDocumentStore.getState();
  const current = activePage(state);
  if (current.id === pageId) return;
  if (!state.doc.children.some((page) => page.id === pageId)) return;
  const viewport = useViewportStore.getState();
  cameras.set(cameraKey(state.doc.id, current.id), viewport.camera);
  state.setPage(pageId);
  const saved = cameras.get(cameraKey(state.doc.id, pageId));
  if (saved) viewport.setCamera(saved);
  else viewport.zoomToFit(contentBounds(state.doc, getLayout(state.doc), pageId));
};

/** Show the page that holds `nodeId` (used when the agent focuses nodes on another page). */
export const showPageOf = (nodeId: string): void => {
  const page = pageOf(useDocumentStore.getState().doc, nodeId);
  if (page) showPage(page.id);
};

export const addPage = (): string | null => {
  const { doc, commit } = useDocumentStore.getState();
  const id = createId();
  const page: PageNode = {
    type: "page",
    id,
    name: nextPageName(doc.children),
    x: 0,
    y: 0,
    children: [],
  };
  if (!commit([{ op: "insert", parentId: null, node: page }], { label: "Add page" })) return null;
  showPage(id);
  return id;
};

export const renamePage = (pageId: string, name: string): void => {
  const trimmed = name.trim();
  const { doc, commit } = useDocumentStore.getState();
  const page = doc.children.find((candidate) => candidate.id === pageId);
  if (!page || !trimmed || trimmed === page.name) return;
  commit([{ op: "update", id: pageId, props: { name: trimmed } }], { label: "Rename page" });
};

/** Delete a page (never the last one). Pages with content ask first. */
export const deletePage = (pageId: string): void => {
  const state = useDocumentStore.getState();
  const pages = state.doc.children;
  const index = pages.findIndex((page) => page.id === pageId);
  const page = pages[index];
  if (!page || pages.length <= 1) return;
  if (page.children.length > 0 && !window.confirm(`Delete "${page.name}" and everything on it?`)) {
    return;
  }
  if (activePage(state).id === pageId) showPage((pages[index + 1] ?? pages[index - 1])!.id);
  useDocumentStore.getState().commit([{ op: "delete", id: pageId }], { label: "Delete page" });
  cameras.delete(cameraKey(state.doc.id, pageId));
};
