import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDITOR_OPS } from "@pego/agent";
import type { CallTool } from "./editor-hub";
import { runFileTool } from "./file-tools";
import { checkDocumentPath, FileToolError, writeDocumentFile } from "./files";

const dir = await mkdtemp(join(tmpdir(), "pego-files-"));
afterAll(() => rm(dir, { recursive: true, force: true }));
const source = { kind: "mcp" as const };

describe("checkDocumentPath", () => {
  test("accepts absolute .pego (and .pen for reading) only", () => {
    expect(checkDocumentPath("/a/b/../app.pego", "write")).toBe("/a/app.pego");
    expect(checkDocumentPath("/a/old.PEN", "read")).toBe("/a/old.PEN");
    for (const [path, mode] of [
      ["design/app.pego", "read"],
      ["/etc/passwd", "read"],
      ["/a/old.pen", "write"],
      ["/a/notes.json", "write"],
    ] as const) {
      expect(() => checkDocumentPath(path, mode)).toThrow(FileToolError);
    }
  });
});

describe("writeDocumentFile", () => {
  test("writes atomically and leaves no temp files", async () => {
    const path = join(dir, "atomic.pego");
    await writeDocumentFile(path, "one");
    await writeDocumentFile(path, "two");
    expect(await Bun.file(path).text()).toBe("two");
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("refuses missing folders", async () => {
    expect(writeDocumentFile(join(dir, "nope", "x.pego"), "{}")).rejects.toThrow(
      /Folder does not exist/,
    );
  });
});

describe("file tools", () => {
  const editor = (snapshotPath: string | null) => {
    const calls: [string, unknown][] = [];
    const callTool: CallTool = async (tool, input) => {
      calls.push([tool, input]);
      if (tool === EDITOR_OPS.snapshotDocument) {
        return {
          content: JSON.stringify({
            text: '{"format":"pego"}',
            path: snapshotPath,
            name: "app.pego",
            snapshotId: "s1",
          }),
          isError: false,
        };
      }
      return { content: tool === EDITOR_OPS.loadDocument ? "Opened" : "ok", isError: false };
    };
    return { calls, callTool };
  };

  test("open_document reads the file and hands its text to the editor", async () => {
    const path = join(dir, "open.pego");
    await writeFile(path, '{"format":"pego","version":1}');
    const { calls, callTool } = editor(null);
    const outcome = await runFileTool("open_document", { path }, callTool, source);
    expect(outcome).toEqual({ content: "Opened", isError: false });
    expect(calls[0]).toEqual([
      EDITOR_OPS.loadDocument,
      { text: '{"format":"pego","version":1}', path, discardUnsaved: undefined },
    ]);
  });

  test("open_document reports missing files and bad paths without calling the editor", async () => {
    const { calls, callTool } = editor(null);
    const missing = await runFileTool(
      "open_document",
      { path: join(dir, "none.pego") },
      callTool,
      source,
    );
    expect(missing).toMatchObject({
      isError: true,
      content: expect.stringContaining("File not found"),
    });
    const relative = await runFileTool("open_document", { path: "app.pego" }, callTool, source);
    expect(relative).toMatchObject({
      isError: true,
      content: expect.stringContaining("absolute path"),
    });
    expect(calls).toEqual([]);
  });

  test("save_document writes the snapshot in place, or to a new path, then marks it saved", async () => {
    const inPlace = join(dir, "in-place.pego");
    const first = editor(inPlace);
    expect((await runFileTool("save_document", {}, first.callTool, source)).content).toStartWith(
      `Saved ${inPlace}`,
    );
    expect(await Bun.file(inPlace).text()).toBe('{"format":"pego"}');
    expect(first.calls.at(-1)).toEqual([EDITOR_OPS.markSaved, { snapshotId: "s1", path: inPlace }]);

    const fresh = editor(null);
    const noPath = await runFileTool("save_document", {}, fresh.callTool, source);
    expect(noPath).toMatchObject({
      isError: true,
      content: expect.stringContaining("no file on disk yet"),
    });
    const target = join(dir, "new.pego");
    expect(
      (await runFileTool("save_document", { path: target }, fresh.callTool, source)).isError,
    ).toBe(false);
    expect(await Bun.file(target).exists()).toBe(true);
  });
});

describe("list_documents and switch_document", () => {
  test("lists open tabs and the design folder", async () => {
    const callTool: CallTool = async (tool) =>
      tool === EDITOR_OPS.listTabs
        ? {
            content: JSON.stringify({
              tabs: [
                { title: "a.pego", path: join(dir, "a.pego"), dirty: false, active: true },
                { title: "Untitled", path: null, dirty: true, active: false },
              ],
            }),
            isError: false,
          }
        : { content: "?", isError: true };
    const outcome = await runFileTool("list_documents", {}, callTool, source, dir);
    expect(outcome.content).toContain(`- a.pego (${join(dir, "a.pego")}) [active]`);
    expect(outcome.content).toContain("- Untitled (not saved to disk) [unsaved]");
    expect(outcome.content).toContain("Active project: none");
    expect(outcome.content).toContain(`Files in ${dir}:`);
    expect(outcome.content).toContain(join(dir, "atomic.pego"));
  });

  test("switch_document shows an open tab, else opens the file", async () => {
    const path = join(dir, "switch.pego");
    await writeFile(path, '{"format":"pego"}');
    const calls: string[] = [];
    const open = new Set<string>();
    const callTool: CallTool = async (tool, input) => {
      calls.push(tool);
      const target = (input as { path: string }).path;
      if (tool === EDITOR_OPS.switchTab) {
        return open.has(target)
          ? { content: `Showing ${target}.`, isError: false }
          : { content: `not_open: ${target} is not open in a tab.`, isError: true };
      }
      open.add(target);
      return { content: "Opened", isError: false };
    };
    expect((await runFileTool("switch_document", { path }, callTool, source)).content).toBe(
      "Opened",
    );
    expect((await runFileTool("switch_document", { path }, callTool, source)).content).toBe(
      `Showing ${path}.`,
    );
    expect(calls).toEqual([EDITOR_OPS.switchTab, EDITOR_OPS.loadDocument, EDITOR_OPS.switchTab]);
  });
});
