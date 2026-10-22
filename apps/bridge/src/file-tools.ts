import { z } from "zod";
import { EDITOR_OPS, type ToolAnnotations } from "@pego/agent";
import type { CallTool, ToolOutcome, ToolSource } from "./editor-hub";
import { FileToolError, readDocumentFile, writeDocumentFile } from "./files";
import { listDesignFiles } from "./project";

type FileTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  annotations: ToolAnnotations;
};

/**
 * Tools that only exist on the bridge's HTTP MCP server (Claude Code in a terminal): they read
 * and write design files on disk, which the editor tab cannot do by path.
 */
export const FILE_TOOLS: FileTool[] = [
  {
    name: "open_document",
    title: "Open design file",
    description:
      "Open a .pego file (or import a .pen file) from disk in the connected Pego editor, in its own tab (an already open file is shown again and reloaded from disk unless it has unsaved changes). " +
      "Use an absolute path inside the user's project, e.g. <repo>/design/app.pego. discardUnsaved: true reloads an open file even with unsaved changes. " +
      "To start a new design file, save_document with a new path instead.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of a .pego or .pen file." },
        discardUnsaved: {
          type: "boolean",
          description: "Reload an already open file from disk even if its tab has unsaved changes.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      title: "Open design file",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "save_document",
    title: "Save design file",
    description:
      "Save the open Pego document to disk as .pego JSON. Without path it saves to the file it was opened from; " +
      "with an absolute .pego path it saves there (a new file, or overwriting that file) and keeps using that path. " +
      "Call it when a design step is finished so the file in the repo is up to date.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute .pego path. Omit to save in place." },
      },
      additionalProperties: false,
    },
    annotations: {
      title: "Save design file",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

FILE_TOOLS.push(
  {
    name: "list_documents",
    title: "List design files",
    description:
      "List the documents open as tabs in the Pego editor (which one is active, which have unsaved changes) and the design files of the project (the repository's design/ folder). " +
      "Edit tools always work on the active tab; use switch_document to change it.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      title: "List design files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "switch_document",
    title: "Switch design file",
    description:
      "Make a design file the active tab: shows its tab when it is open, otherwise opens it (like open_document). " +
      "Pass the absolute path from list_documents.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of a .pego or .pen file." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      title: "Switch design file",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
);

export const isFileTool = (name: string) => FILE_TOOLS.some((tool) => tool.name === name);

const openInput = z.strictObject({
  path: z.string().min(1),
  discardUnsaved: z.boolean().optional(),
});
const saveInput = z.strictObject({ path: z.string().min(1).optional() });
const snapshotSchema = z.object({
  text: z.string(),
  path: z.string().nullable(),
  name: z.string().nullable(),
  snapshotId: z.string(),
});

const fail = (content: string): ToolOutcome => ({ content, isError: true });

const openDocument = async (input: unknown, callTool: CallTool, source: ToolSource) => {
  const parsed = openInput.safeParse(input);
  if (!parsed.success)
    return fail("Pass {path: string (absolute .pego/.pen), discardUnsaved?: boolean}.");
  const { path, discardUnsaved } = parsed.data;
  const text = await readDocumentFile(path);
  return callTool(EDITOR_OPS.loadDocument, { text, path, discardUnsaved }, source);
};

const saveDocument = async (input: unknown, callTool: CallTool, source: ToolSource) => {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return fail("Pass {path?: string (absolute .pego)}.");
  const snapshot = await callTool(EDITOR_OPS.snapshotDocument, {}, source);
  if (snapshot.isError) return snapshot;
  const data = snapshotSchema.parse(JSON.parse(snapshot.content));
  const target = parsed.data.path ?? data.path;
  if (!target) {
    const which = data.name ? `"${data.name}"` : "The open document";
    return fail(
      `${which} has no file on disk yet. Pass path: an absolute .pego path in the user's project.`,
    );
  }
  const written = await writeDocumentFile(target, data.text);
  const marked = await callTool(
    EDITOR_OPS.markSaved,
    { snapshotId: data.snapshotId, path: written },
    source,
  );
  const size = `${Math.max(1, Math.round(Buffer.byteLength(data.text) / 1024))} KB`;
  return {
    content: marked.isError
      ? `Saved ${written} (${size}), but the editor could not mark it saved: ${marked.content}`
      : `Saved ${written} (${size}).`,
    isError: false,
  };
};

const tabsSchema = z.object({
  tabs: z.array(
    z.object({
      title: z.string(),
      path: z.string().nullable(),
      dirty: z.boolean(),
      active: z.boolean(),
    }),
  ),
});

const listDocuments = async (callTool: CallTool, source: ToolSource, designDir: string | null) => {
  const lines: string[] = [];
  const tabs = await callTool(EDITOR_OPS.listTabs, {}, source);
  if (tabs.isError) lines.push(`Open tabs: unavailable (${tabs.content})`);
  else {
    lines.push("Open tabs:");
    for (const tab of tabsSchema.parse(JSON.parse(tabs.content)).tabs) {
      const flags = [tab.active ? "active" : "", tab.dirty ? "unsaved" : ""]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- ${tab.title}${tab.path ? ` (${tab.path})` : " (not saved to disk)"}${flags ? ` [${flags}]` : ""}`,
      );
    }
  }
  if (!designDir) lines.push("Project: no design/ folder (set PEGO_DESIGN_DIR for the bridge).");
  else {
    const files = await listDesignFiles(designDir);
    lines.push(`Project design folder ${designDir}:`);
    lines.push(
      ...(files.length ? files.map((file) => `- ${file.path}`) : ["- (no .pego files yet)"]),
    );
  }
  return { content: lines.join("\n"), isError: false };
};

const switchDocument = async (input: unknown, callTool: CallTool, source: ToolSource) => {
  const parsed = z.strictObject({ path: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return fail("Pass {path: string (absolute .pego/.pen)}.");
  const switched = await callTool(EDITOR_OPS.switchTab, { path: parsed.data.path }, source);
  if (!switched.isError || !switched.content.startsWith("not_open")) return switched;
  return openDocument({ path: parsed.data.path }, callTool, source);
};

/** Run a file tool; path and I/O problems come back as `isError` outcomes, never throws. */
export const runFileTool = async (
  name: string,
  input: unknown,
  callTool: CallTool,
  source: ToolSource,
  designDir: string | null = null,
): Promise<ToolOutcome> => {
  try {
    if (name === "open_document") return await openDocument(input, callTool, source);
    if (name === "list_documents") return await listDocuments(callTool, source, designDir);
    if (name === "switch_document") return await switchDocument(input, callTool, source);
    return await saveDocument(input, callTool, source);
  } catch (error) {
    if (error instanceof FileToolError) return fail(error.message);
    return fail(`File tool failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** Appended to the MCP server instructions when the file tools are available. */
export const FILE_TOOLS_INSTRUCTIONS = `## Design files

Designs live in the user's repository as .pego files in design/. list_documents shows the open tabs and the project's design files. Edits always go to the active tab: use switch_document (or open_document) to work on a named file; to start a new one, build it in a new document and call save_document with a new path (for example <repo>/design/<name>.pego). Call save_document whenever a step is finished, so the file on disk matches the canvas.`;
