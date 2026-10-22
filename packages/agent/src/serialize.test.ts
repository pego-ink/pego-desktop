import { describe, expect, test } from "bun:test";
import { documentSchema, sampleDoc, type PegoDocument } from "@pego/doc";
import { serializeDocument } from "./serialize";

const doc: PegoDocument = documentSchema.parse({
  version: 0,
  id: "d",
  name: "App",
  variables: { gap: { type: "number", value: 8 }, accent: { type: "color", value: "#0E7C5A" } },
  children: [
    {
      type: "frame",
      id: "page",
      name: "Page",
      x: 10,
      y: 0,
      width: 400,
      layout: "vertical",
      gap: "$gap",
      padding: [8, 16, 8, 16],
      children: [
        {
          type: "frame",
          id: "btn",
          name: "Button",
          reusable: true,
          width: "fit_content",
          layout: "horizontal",
          fill: "$accent",
          x: 99,
          children: [
            { type: "text", id: "label", content: "Buy now", fontSize: 14 },
            { type: "icon", id: "ic", iconSet: "lucide", iconName: "arrow-right" },
          ],
        },
        { type: "ref", id: "b2", ref: "btn", descendants: { label: { content: "Go" } } },
        { type: "path", id: "p", geometry: "M0 0 L10 10 ".repeat(20) },
      ],
    },
    { type: "group", id: "g", x: 5, children: [{ type: "ellipse", id: "e", x: 3, width: 4 }] },
  ],
});

describe("serializeDocument", () => {
  const text = serializeDocument(doc);

  test("lists variables (sorted) and components once", () => {
    expect(text).toContain("variables: $accent=#0E7C5A (color), $gap=8 (number)");
    expect(text).toContain('components: btn "Button"');
  });

  test("omits defaults and hides x/y under flex parents", () => {
    expect(text).toContain(
      'frame#page "Page" x=10 width=400 layout=vertical gap=$gap padding=[8,16,8,16]',
    );
    expect(text).toContain(
      '  frame#btn "Button" [component] width=fit_content fill=$accent layout=horizontal',
    );
    expect(text).not.toContain("x=99");
    expect(text).not.toContain("iconSet");
  });

  test("shows x/y under group and none-layout parents", () => {
    expect(text).toContain("group#g x=5");
    expect(text).toContain("ellipse#e x=3 width=4");
  });

  test("text, icon, ref and truncated path", () => {
    expect(text).toContain('text#label content="Buy now" fontSize=14');
    expect(text).toContain("icon#ic iconName=arrow-right");
    expect(text).toContain('ref=btn descendants={"label":{"content":"Go"}}');
    expect(text).toMatch(/geometry=".{48}\.\.\."\(\d+ chars\)/);
  });

  test("is deterministic regardless of object key order", () => {
    const shuffled = JSON.parse(JSON.stringify(doc), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ) as PegoDocument;
    expect(serializeDocument(shuffled)).toBe(text);
    expect(serializeDocument(doc)).toBe(text);
  });

  test("rootId scopes, maxDepth summarizes", () => {
    const sub = serializeDocument(doc, { rootId: "btn" });
    expect(sub).toContain("scope: btn (parent page, index 0)");
    expect(sub).not.toContain("group#g");
    expect(sub).not.toContain("x=99");
    const shallow = serializeDocument(doc, { maxDepth: 0 });
    expect(shallow).toContain("frame#page");
    expect(shallow).toContain("(3 children not shown)");
    expect(shallow).not.toContain("frame#btn");
  });

  test("unknown rootId throws OpError", () => {
    expect(() => serializeDocument(doc, { rootId: "x" })).toThrow('node "x" not found');
  });

  test("is much smaller than raw JSON on the sample doc", () => {
    const compact = serializeDocument(sampleDoc);
    expect(compact).toBe(serializeDocument(sampleDoc));
    expect(compact.length).toBeLessThan(JSON.stringify(sampleDoc).length * 0.7);
    expect(compact).toContain('text#text-1 "Title" x=80 y=56 width=640');
  });
});
