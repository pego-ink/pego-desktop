/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { documentSchema } from "@pego/doc";
import { fontFileUrl, fontsourceId, nearestWeight, usedFonts } from "./fonts";

describe("fonts", () => {
  test("maps family names to Fontsource ids and files", () => {
    expect(fontsourceId("Geist Mono")).toBe("geist-mono");
    expect(fontsourceId(" Playfair Display ")).toBe("playfair-display");
    expect(fontFileUrl("Manrope", 700)).toBe(
      "https://cdn.jsdelivr.net/fontsource/fonts/manrope@latest/latin-700-normal.ttf",
    );
  });

  test("picks the nearest available weight, heavier on ties", () => {
    expect(nearestWeight(600, [400, 700])).toBe(700);
    expect(nearestWeight(550, [500, 600])).toBe(600);
    expect(nearestWeight(450, [400])).toBe(400);
  });

  test("collects families and weights from text, variables and instances", () => {
    const doc = documentSchema.parse({
      version: 2,
      id: "d",
      name: "Fonts",
      variables: { heading: { type: "string", value: "Manrope" } },
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
              id: "btn",
              reusable: true,
              children: [
                { type: "text", id: "t", content: "Go", fontFamily: "Geist Mono", fontWeight: 500 },
              ],
            },
            { type: "ref", id: "r", ref: "btn" },
            { type: "text", id: "h", content: "Hi", fontFamily: "$heading", fontWeight: 700 },
            { type: "text", id: "b", content: "Body" },
          ],
        },
      ],
    });
    const used = usedFonts(doc, "Inter");
    expect([...used.keys()].sort()).toEqual(["Geist Mono", "Inter", "Manrope"]);
    expect([...used.get("Manrope")!]).toEqual([700]);
    expect([...used.get("Geist Mono")!]).toEqual([500]);
  });
});
