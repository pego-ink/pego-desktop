import { describe, expect, test } from "bun:test";
import { documentSchema } from "@pego/doc";
import { nodeJsonSchema, propsJsonSchema } from "./json-schemas";

describe("node json schema", () => {
  test("offers the image type and its props", () => {
    const properties = nodeJsonSchema.properties as Record<string, { enum?: string[] }>;
    const type = properties.type as { enum: string[] };
    expect(type.enum).toContain("image");
    for (const key of [
      "src",
      "fit",
      "alt",
      "strokeCap",
      "strokeJoin",
      "startMarker",
      "endMarker",
    ]) {
      expect(nodeJsonSchema.properties).toHaveProperty(key);
      expect(propsJsonSchema.properties).toHaveProperty(key);
    }
  });
});

describe("doc schema", () => {
  test("accepts an image node", () => {
    const doc = documentSchema.parse({
      version: 0,
      id: "d",
      name: "x",
      variables: {},
      children: [
        {
          type: "image",
          id: "i",
          src: "https://e.com/a.png",
          fit: "tile",
          cornerRadius: 8,
          width: 10,
          height: 10,
        },
      ],
    });
    expect(doc.children[0]?.type).toBe("image");
  });
  test("rejects an unknown fit", () => {
    expect(() =>
      documentSchema.parse({
        version: 0,
        id: "d",
        name: "x",
        variables: {},
        children: [{ type: "image", id: "i", src: "x", fit: "stretch" }],
      }),
    ).toThrow();
  });
});
