import { describe, expect, test } from "bun:test";
import { computeLayout, documentSchema } from "@pego/doc";
import { createFakeHost } from "./test-host";
import { toolByName } from "./tools";

const doc = documentSchema.parse({
  version: 2,
  id: "d",
  name: "Code",
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "hero",
          name: "Hero",
          width: 400,
          layout: "vertical",
          padding: 32,
          fill: { type: "image", src: "data:image/jpeg;base64,AAAA", fit: "cover" },
          children: [
            { type: "text", id: "h1", content: "Hello" },
            { type: "icon", id: "ic", iconName: "check", width: 16, height: 16 },
          ],
        },
      ],
    },
  ],
});

const host = () => {
  const fake = createFakeHost(doc);
  fake.getLayout = () =>
    computeLayout(fake.getDoc(), (node) => ({ width: node.content.length * 8, height: 20 }));
  fake.iconMarkup = (name) => (name === "check" ? '<path d="M20 6 9 17l-5-5"/>' : null);
  return fake;
};

describe("get_code", () => {
  const tool = toolByName("get_code")!;

  test("returns raw HTML with images referenced by file name", async () => {
    const result = await tool.run({ nodeId: "hero" }, host());
    expect(result.isError).toBe(false);
    expect(result.content).toStartWith("<!doctype html>");
    expect(result.content).toContain('url("images/image-1.jpg") center / cover no-repeat');
    expect(result.content).not.toContain("data:image");
    expect(result.content).toContain("images/image-1.jpg: image fill #1");
    expect(result.content).toContain('<path d="M20 6 9 17l-5-5"/>');
  });

  test("reports unknown nodes and missing layout", async () => {
    expect((await tool.run({ nodeId: "nope" }, host())).content).toContain("node_not_found");
    const noLayout = createFakeHost(doc);
    expect((await tool.run({ nodeId: "hero" }, noLayout)).content).toContain("unsupported");
  });
});
