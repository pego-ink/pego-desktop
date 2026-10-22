import { createId, importPen, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { FILE_EXTENSION, parseDocumentFile, serializeDocument } from "./file-format";
import {
  findTabByPath,
  openTab,
  switchTab,
  tabIsDirty,
  tabState,
  tabTitle,
  useTabsStore,
} from "@/tabs/use-tabs-store";
import { liveProject, openProjectWorkspace, showEditor } from "@/workspace/use-workspace-store";
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
export const openDocumentText = (
  text: string,
  path: string,
  options: { reload?: boolean; discardUnsaved?: boolean } = {},
): OpOutcome => {
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
      if (
        !openTab(
          doc,
          { fileName: `${base}${FILE_EXTENSION}`, bridgePath: target },
          { saved: false },
        )
      ) {
        return {
          content: "The editor is busy with an agent run; try again when it finishes.",
          isError: true,
        };
      }
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
      if (!switchTab(existing.id)) {
        return {
          content: "The editor is busy with an agent run; try again when it finishes.",
          isError: true,
        };
      }
      if (getIsDirty() && !options.discardUnsaved) {
        return {
          content: `${path} is already open with unsaved changes; showing that tab (pass discardUnsaved: true to reload it from disk).`,
          isError: false,
        };
      }
      if (options.reload === false) return { content: `Showing ${path}.`, isError: false };
      useDocumentStore.getState().load(doc);
      useFileStore.getState().markSaved(useDocumentStore.getState().doc, name, null, path);
      zoomToDocument(doc);
      return { content: `Reloaded ${path} from disk (${describe(doc)}).`, isError: false };
    }
    if (!openTab(doc, { fileName: name, bridgePath: path })) {
      return {
        content: "The editor is busy with an agent run; try again when it finishes.",
        isError: true,
      };
    }
    return { content: `Opened ${path} in a tab (${describe(doc)}).`, isError: false };
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
  return openDocumentText(input.text, input.path, {
    discardUnsaved: input.discardUnsaved === true,
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

/** Editor side of open_project / create_project: open (or show) the project's workspace. */
export const openProjectForBridge = (input: unknown): OpOutcome => {
  if (
    !isObject(input) ||
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.dir !== "string"
  ) {
    return { content: "Invalid project.", isError: true };
  }
  if (!openProjectWorkspace({ id: input.id, name: input.name, dir: input.dir })) {
    return {
      content: "The editor is busy with an agent run; try again when it finishes.",
      isError: true,
    };
  }
  return { content: `Project ${input.name} is open.`, isError: false };
};
