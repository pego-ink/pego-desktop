import { createId, importPen, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { FILE_EXTENSION, parseDocumentFile, serializeDocument } from "./file-format";
import {
  documentTitle,
  findTabByPath,
  openTab,
  switchTab,
  type UnsavedPolicy,
  tabIsDirty,
  tabState,
  tabTitle,
  useTabsStore,
} from "@/tabs/use-tabs-store";
import { liveProject, showEditor } from "@/workspace/use-workspace-store";
import { getIsDirty, useFileStore } from "./use-file-store";

/**
 * Editor side of the bridge's file tools (open_document / save_document): the bridge reads and
 * writes the bytes on disk, the editor parses, shows and serializes the document.
 */

export type OpOutcome = { content: string; isError: boolean };

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A freshly loaded document shows its first page. */
const zoomToDocument = (doc: PegoDocument) =>
  useViewportStore.getState().zoomToFit(contentBounds(doc, getLayout(doc), null));

const describe = (doc: PegoDocument) => {
  const pages = doc.children.map((page) => {
    const names = page.children.map((node) => node.name ?? node.type);
    const shown = names.slice(0, 6).join(", ");
    return `page "${page.name}": ${names.length} top-level node(s)${shown ? ` (${shown}${names.length > 6 ? ", ..." : ""})` : ""}`;
  });
  return pages.join("; ");
};

/**
 * Open a design file's text (read from disk by the bridge) in a tab. A file that is already open
 * is shown again; its tab is reloaded from disk unless it has unsaved changes (or `reload` is
 * false). `.pen` files import as an unsaved document that saves next to them as `.pego`.
 */
const BUSY: OpOutcome = {
  content: "The editor is busy with an agent run; try again when it finishes.",
  isError: true,
};

/** When the shown document's unsaved changes stopped the open (refused or declined by the user). */
const unsavedOutcome = (policy: UnsavedPolicy): OpOutcome =>
  policy === "refuse"
    ? {
        content: `The open document "${documentTitle(useDocumentStore.getState().doc, useFileStore.getState())}" has unsaved changes. Call save_document first, or pass discardUnsaved: true to drop them.`,
        isError: true,
      }
    : { content: "Kept the current document (it has unsaved changes).", isError: false };

/**
 * Show a design file's text (read from disk by the bridge) as the workspace's document. The file
 * already shown is reloaded from disk unless it has unsaved changes (or `reload` is false).
 * `.pen` files import as an unsaved document that saves next to them as `.pego`. `unsaved` says
 * what happens to unsaved changes of another document shown now.
 */
export const openDocumentText = (
  text: string,
  path: string,
  options: { reload?: boolean; discardUnsaved?: boolean; unsaved?: UnsavedPolicy } = {},
): OpOutcome => {
  const policy: UnsavedPolicy = options.discardUnsaved ? "discard" : (options.unsaved ?? "ask");
  const name = fileNameOf(path);
  try {
    if (path.toLowerCase().endsWith(".pen")) {
      const base = name.replace(/\.pen$/i, "");
      // The .pen file is never written; saving goes to a .pego next to it.
      const target = path.replace(/\.pen$/i, FILE_EXTENSION);
      const existing = findTabByPath(target);
      if (existing) {
        switchTab(existing.id);
        return {
          content: `${fileNameOf(target)} is already open (from ${name}); showing it.`,
          isError: false,
        };
      }
      const { doc, warnings } = importPen(JSON.parse(text), base);
      const result = openTab(
        doc,
        { fileName: `${base}${FILE_EXTENSION}`, bridgePath: target },
        { saved: false, unsaved: policy },
      );
      if (result === "busy") return BUSY;
      if (result === "unsaved") return unsavedOutcome(policy);
      const notes = warnings.map((w) => `- ${w.message}${w.count > 1 ? ` (${w.count}x)` : ""}`);
      return {
        content: [
          `Imported ${name} (${describe(doc)}). It is unsaved; save_document writes ${target}.`,
          ...(notes.length > 0 ? ["Not converted:", ...notes] : []),
        ].join("\n"),
        isError: false,
      };
    }
    const doc = parseDocumentFile(text);
    const existing = findTabByPath(path);
    if (existing) {
      if (!switchTab(existing.id)) return BUSY;
      if (getIsDirty() && !options.discardUnsaved) {
        return {
          content: `${path} is already open with unsaved changes; keeping them (pass discardUnsaved: true to reload it from disk).`,
          isError: false,
        };
      }
      if (options.reload === false) return { content: `Showing ${path}.`, isError: false };
      useDocumentStore.getState().load(doc);
      useFileStore.getState().markSaved(useDocumentStore.getState().doc, name, null, path);
      zoomToDocument(doc);
      return { content: `Reloaded ${path} from disk (${describe(doc)}).`, isError: false };
    }
    const result = openTab(doc, { fileName: name, bridgePath: path }, { unsaved: policy });
    if (result === "busy") return BUSY;
    if (result === "unsaved") return unsavedOutcome(policy);
    return { content: `Opened ${path} (${describe(doc)}).`, isError: false };
  } catch (error) {
    return {
      content: `Could not open ${name}: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/** Editor side of the MCP open_document tool. */
export const loadDocumentFromBridge = (input: unknown): OpOutcome => {
  if (!isObject(input) || typeof input.text !== "string" || typeof input.path !== "string") {
    return { content: "Invalid load request.", isError: true };
  }
  // Show what Claude Code opened, even when the user is on the dashboard.
  showEditor();
  // Claude Code cannot answer a dialog: unsaved work is refused unless it says to drop it.
  return openDocumentText(input.text, input.path, {
    discardUnsaved: input.discardUnsaved === true,
    unsaved: "refuse",
  });
};

/** The last snapshot handed to the bridge, so mark_saved records exactly what was written. */
let pendingSnapshot: { id: string; doc: PegoDocument } | null = null;

export const snapshotDocumentForBridge = (): OpOutcome => {
  const doc = useDocumentStore.getState().doc;
  const { fileName, bridgePath } = useFileStore.getState();
  pendingSnapshot = { id: createId(), doc };
  return {
    content: JSON.stringify({
      text: serializeDocument(doc),
      path: bridgePath,
      name: fileName,
      snapshotId: pendingSnapshot.id,
    }),
    isError: false,
  };
};

export const markSavedFromBridge = (input: unknown): OpOutcome => {
  if (
    !isObject(input) ||
    typeof input.path !== "string" ||
    !pendingSnapshot ||
    pendingSnapshot.id !== input.snapshotId
  ) {
    return { content: "No matching snapshot to mark as saved.", isError: true };
  }
  const { doc } = pendingSnapshot;
  pendingSnapshot = null;
  useFileStore.getState().markSaved(doc, fileNameOf(input.path), null, input.path);
  return { content: "ok", isError: false };
};

/** Editor side of list_documents: the open tabs. */
export const listTabsForBridge = (): OpOutcome => {
  const { tabs, activeId } = useTabsStore.getState();
  const project = liveProject();
  return {
    content: JSON.stringify({
      project: project ? { id: project.id, name: project.name, dir: project.dir } : null,
      tabs: tabs.map((tab) => ({
        title: tabTitle(tab),
        path: tabState(tab).file.bridgePath,
        dirty: tabIsDirty(tab),
        active: tab.id === activeId,
      })),
    }),
    isError: false,
  };
};

/** Editor side of switch_document: show the tab of an open file. */
export const switchTabForBridge = (input: unknown): OpOutcome => {
  if (!isObject(input) || typeof input.path !== "string") {
    return { content: "Invalid switch request.", isError: true };
  }
  const tab = findTabByPath(input.path);
  if (!tab) return { content: `not_open: ${input.path} is not open in a tab.`, isError: true };
  if (!switchTab(tab.id)) {
    return {
      content: "The editor is busy with an agent run; try again when it finishes.",
      isError: true,
    };
  }
  return { content: `Showing ${input.path}.`, isError: false };
};

/** Editor side of open_project / create_project: show the project and its design (project.pego). */
export const openProjectForBridge = async (input: unknown): Promise<OpOutcome> => {
  if (
    !isObject(input) ||
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.dir !== "string"
  ) {
    return { content: "Invalid project.", isError: true };
  }
  const { openProject } = await import("@/project/use-project-store");
  const opened = await openProject(
    {
      id: input.id,
      name: input.name,
      dir: input.dir,
      ...(typeof input.mainFile === "string" ? { mainFile: input.mainFile } : {}),
    },
    "refuse",
  );
  if (!opened) {
    return {
      content: "The editor is busy with an agent run; try again when it finishes.",
      isError: true,
    };
  }
  return { content: `Project ${input.name} is open.`, isError: false };
};
