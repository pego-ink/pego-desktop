/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { dropKindOf } from "./drop-files";

describe("dropped files", () => {
  test("classifies documents and images", () => {
    expect(dropKindOf({ name: "App.PEGO", type: "" })).toBe("document");
    expect(dropKindOf({ name: "old.pen", type: "application/json" })).toBe("document");
    expect(dropKindOf({ name: "shot.png", type: "image/png" })).toBe("image");
    expect(dropKindOf({ name: "icon.svg", type: "image/svg+xml" })).toBe("image");
    expect(dropKindOf({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });
});
