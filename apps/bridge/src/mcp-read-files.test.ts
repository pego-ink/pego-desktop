import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { agentTools } from "@pego/agent";
import { FILE_TOOLS, READ_FILE_TOOLS, runReadFileTool } from "./file-tools";
import { handleMcpRequest, createPegoMcpServer } from "./mcp";

const SVG = "<svg><circle r='2'/></svg>";
let base = "";
let design = "";

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "pego-read-files-")));
  design = join(base, "design");
  await mkdir(join(design, "logo"), { recursive: true });
  await writeFile(join(design, "logo", "bird.svg"), SVG);
  await writeFile(join(base, "secret.svg"), "SECRET");
  await symlink(join(base, "secret.svg"), join(design, "logo", "leak.svg"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

const callTool = async () => ({ content: "editor", isError: false });

const connect = async (options: Parameters<typeof createPegoMcpServer>[0]) => {
  const server = createPegoMcpServer(options);
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};

const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);

describe("read-only design tools on MCP servers", () => {
  test("a run server lists exactly the agent tools plus list_files and read_svg", async () => {
    const client = await connect({
      callTool,
      source: () => ({ kind: "run", runId: "r" }),
      designDir: design,
    });
    expect(await names(client)).toEqual([
      ...agentTools.map((tool) => tool.name),
      "list_files",
      "read_svg",
    ]);
    const tools = (await client.listTools()).tools.filter((tool) =>
      ["list_files", "read_svg"].includes(tool.name),
    );
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test("a run server cannot call the write/switch file tools", async () => {
    const client = await connect({ callTool, source: () => ({ kind: "run", runId: "r" }) });
    for (const name of FILE_TOOLS.map((tool) => tool.name)) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Unknown Pego tool");
    }
  });

  test("the terminal server lists everything", async () => {
    const client = await connect({
      callTool,
      source: () => ({ kind: "mcp" }),
      fileTools: true,
      designDir: design,
    });
    expect(await names(client)).toEqual([
      ...agentTools.map((tool) => tool.name),
      ...FILE_TOOLS.map((tool) => tool.name),
      ...READ_FILE_TOOLS.map((tool) => tool.name),
    ]);
  });

  test("calls work through the run server and stay confined", async () => {
    const client = await connect({
      callTool,
      source: () => ({ kind: "run", runId: "r" }),
      designDir: design,
    });
    const listed = await client.callTool({
      name: "list_files",
      arguments: { path: "design/logo" },
    });
    expect(JSON.parse((listed.content as { text: string }[])[0]!.text).files).toEqual([
      { path: "logo/bird.svg", bytes: SVG.length },
    ]);
    const read = await client.callTool({ name: "read_svg", arguments: { path: "logo/bird.svg" } });
    expect(JSON.parse((read.content as { text: string }[])[0]!.text).svg).toBe(SVG);
    for (const path of ["../secret.svg", join(base, "secret.svg"), "logo/leak.svg"]) {
      const bad = await client.callTool({ name: "read_svg", arguments: { path } });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).not.toContain("SECRET");
    }
  });

  test("the run HTTP endpoint (fixedSource) lists the read tools only", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const response = await handleMcpRequest(
      new Request("http://127.0.0.1/mcp/run/x", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body,
      }),
      callTool,
      { fixedSource: { kind: "run", runId: "r" }, designDir: design },
    );
    const json = (await response.json()) as { result: { tools: { name: string }[] } };
    const listed = json.result.tools.map((tool) => tool.name);
    expect(listed).toContain("list_files");
    expect(listed).toContain("read_svg");
    expect(listed).not.toContain("open_document");
    expect(listed).not.toContain("save_document");
    expect(listed).not.toContain("create_project");
  });
});

describe("runReadFileTool", () => {
  test("validates input and reports a missing design folder", async () => {
    expect((await runReadFileTool("read_svg", {}, design)).isError).toBe(true);
    expect((await runReadFileTool("list_files", { extra: 1 }, design)).isError).toBe(true);
    const none = await runReadFileTool("list_files", {}, null);
    expect(none.isError).toBe(true);
    expect(none.content).toMatch(/no design folder/i);
  });

  test("flags a truncated listing", async () => {
    const big = join(design, "big");
    await mkdir(big);
    await Promise.all(Array.from({ length: 505 }, (_, i) => writeFile(join(big, `${i}.svg`), SVG)));
    const result = await runReadFileTool("list_files", { path: "big" }, design);
    const parsed = JSON.parse(result.content);
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toMatch(/Truncated/);
    expect(parsed.files.length).toBe(500);
  });
});
