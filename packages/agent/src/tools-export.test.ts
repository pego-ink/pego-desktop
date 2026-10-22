import { describe, expect, test } from "bun:test";
import { toolByName } from "./tools";
import { createFakeHost } from "./test-host";
import { exportDoc } from "./export/test-docs";
import { stripDataUrls, truncateFiles } from "./tools-export";
import type { ToolHost } from "./types";

const run = async (name: string, input: unknown, host: ToolHost) => {
  const tool = toolByName(name);
  if (!tool) throw new Error(`no ${name}`);
  return tool.run(input, host);
};

describe("export_code", () => {
  test("returns the generated files", async () => {
    const result = await run(
      "export_code",
      { nodeId: "page", format: "react-tailwind" },
      createFakeHost(exportDoc),
    );
    expect(result.isError).toBe(false);
    const data = JSON.parse(result.content) as { files: { path: string }[] };
    expect(data.files.map((f) => f.path)).toContain("components/Page.tsx");
  });

  test("unknown node and bad format are errors", async () => {
    const host = createFakeHost(exportDoc);
    expect((await run("export_code", { nodeId: "zzz", format: "html-css" }, host)).isError).toBe(
      true,
    );
    expect((await run("export_code", { nodeId: "page", format: "vue" }, host)).isError).toBe(true);
  });

  test("truncates long output with a note", () => {
    const { files, truncated } = truncateFiles(
      [
        { path: "a", contents: "x".repeat(60) },
        { path: "b", contents: "y".repeat(60) },
      ],
      80,
    );
    expect(truncated).toBe(true);
    expect(files[0]?.contents).toBe("x".repeat(60));
    expect(files[1]?.contents).toContain("truncated");
    expect(files[1]?.contents.startsWith("y".repeat(20))).toBe(true);
  });

  test("strips embedded data urls", () => {
    const url = `data:image/png;base64,${"A".repeat(500)}`;
    expect(stripDataUrls(`<img src="${url}">`)).toContain("chars omitted");
    expect(stripDataUrls('<img src="data:image/png;base64,AAAA">')).toContain("AAAA");
  });
});

describe("export_image", () => {
  test("png goes through host.renderImage with the requested scale", async () => {
    const calls: unknown[] = [];
    const host: ToolHost = {
      ...createFakeHost(exportDoc),
      renderImage: async (nodeId, options) => {
        calls.push([nodeId, options]);
        return { mediaType: "image/png", data: "AAAA", width: 800, height: 600 };
      },
    };
    const result = await run("export_image", { nodeId: "page", format: "png", scale: 2 }, host);
    expect(result.isError).toBe(false);
    expect(result.images).toHaveLength(1);
    expect(calls).toEqual([["page", { scale: 2, maxSize: 2048 }]]);
  });

  test("png without renderImage is unsupported", async () => {
    const result = await run(
      "export_image",
      { nodeId: "page", format: "png" },
      createFakeHost(exportDoc),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("unsupported");
  });

  test("svg returns markup text from the host layout", async () => {
    const host: ToolHost = {
      ...createFakeHost(exportDoc),
      getLayout: () => new Map([["page", { x: 0, y: 0, width: 400, height: 300 }]]),
    };
    const result = await run("export_image", { nodeId: "page", format: "svg" }, host);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content).svg).toContain("<svg ");
  });

  test("scale above the cap is rejected", async () => {
    const result = await run(
      "export_image",
      { nodeId: "page", format: "png", scale: 9 },
      createFakeHost(exportDoc),
    );
    expect(result.isError).toBe(true);
  });
});
