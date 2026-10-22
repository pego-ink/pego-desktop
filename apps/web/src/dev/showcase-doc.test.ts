/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { collectDocIds, documentSchema } from "@pego/doc";
import { showcaseDoc } from "./showcase-doc";

describe("showcaseDoc", () => {
  test("is a valid document", () => {
    expect(() => documentSchema.parse(showcaseDoc)).not.toThrow();
  });

  test("keeps the ids other tooling relies on", () => {
    const ids = collectDocIds(showcaseDoc);
    ["frame-1", "rect-1", "text-1"].forEach((id) => expect(ids.has(id)).toBe(true));
  });
});
