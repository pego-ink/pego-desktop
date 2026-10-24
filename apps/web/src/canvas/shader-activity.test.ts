import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import { selectionHasMovingShader } from "./shader-activity";

const aurora = { type: "shader", preset: "aurora" } as const;
const still = { type: "shader", preset: "custom", code: "vec4 main(vec2 p) { return vec4(1.0); }" };

const doc = {
  version: 8,
  id: "d",
  name: "D",
  variables: {},
  children: [
    {
      type: "page",
      id: "p",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "hero",
          x: 0,
          y: 0,
          layout: "none",
          fill: aurora,
          children: [{ type: "text", id: "title", x: 0, y: 0, content: "Hi" }],
        },
        {
          type: "frame",
          id: "card",
          x: 0,
          y: 0,
          layout: "none",
          children: [{ type: "rectangle", id: "bg", x: 0, y: 0, fill: aurora }],
        },
        { type: "rectangle", id: "static", x: 0, y: 0, fill: still },
        { type: "rectangle", id: "plain", x: 0, y: 0, fill: "#fff" },
      ],
    },
  ],
} as unknown as PegoDocument;

describe("selectionHasMovingShader", () => {
  test("the selected layer, a parent or a child with a moving shader", () => {
    expect(selectionHasMovingShader(doc, ["hero"])).toBe(true);
    expect(selectionHasMovingShader(doc, ["title"])).toBe(true);
    expect(selectionHasMovingShader(doc, ["card"])).toBe(true);
  });

  test("not for plain layers or shaders that ignore iTime", () => {
    expect(selectionHasMovingShader(doc, [])).toBe(false);
    expect(selectionHasMovingShader(doc, ["plain"])).toBe(false);
    expect(selectionHasMovingShader(doc, ["static"])).toBe(false);
    expect(selectionHasMovingShader(doc, ["missing"])).toBe(false);
  });
});
