import { z } from "zod";
import { EDITOR_OPS, type ToolAnnotations } from "@pego/agent";
import type { CallTool, ToolOutcome, ToolSource } from "./editor-hub";
import { FileToolError, readDocumentFile, writeDocumentFile } from "./files";

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
      "Open a .pego file (or import a .pen file) from disk in the connected Pego editor, replacing the open document. " +
      "Use an absolute path inside the user's project, e.g. <repo>/design/app.pego. Fails if the open document has unsaved changes unless discardUnsaved is true; prefer save_document first. " +
      "To start a new design file, save_document with a new path instead.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of a .pego or .pen file." },
        discardUnsaved: {
          type: "boolean",
          description: "Replace the open document even if it has unsaved changes.",
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

/** Run a file tool; path and I/O problems come back as `isError` outcomes, never throws. */
export const runFileTool = async (
  name: string,
  input: unknown,
  callTool: CallTool,
  source: ToolSource,
): Promise<ToolOutcome> => {
  try {
    if (name === "open_document") return await openDocument(input, callTool, source);
    return await saveDocument(input, callTool, source);
  } catch (error) {
    if (error instanceof FileToolError) return fail(error.message);
    return fail(`File tool failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** Appended to the MCP server instructions when the file tools are available. */
export const FILE_TOOLS_INSTRUCTIONS = `## Design files

Designs live in the user's repository as .pego files. When the user names a design file (or you are asked to design something for this project), call open_document with its absolute path; if it does not exist yet, build the design and call save_document with the new path (for example <repo>/design/<name>.pego). Call save_document whenever a step is finished, so the file on disk matches the canvas.`;
