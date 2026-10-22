/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { dropKindOf, droppedImageSize } from "./drop-files";

describe("dropped files", () => {
  test("classifies documents and images", () => {
    expect(dropKindOf({ name: "App.PEGO", type: "" })).toBe("document");
    expect(dropKindOf({ name: "old.pen", type: "application/json" })).toBe("document");
    expect(dropKindOf({ name: "shot.png", type: "image/png" })).toBe("image");
    expect(dropKindOf({ name: "icon.svg", type: "image/svg+xml" })).toBeNull();
    expect(dropKindOf({ name: "notes.txt", type: "text/plain" })).toBeNull();
  });

  test("scales large images down to 800 on the long side", () => {
    expect(droppedImageSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(droppedImageSize(3200, 1600)).toEqual({ width: 800, height: 400 });
  });
});
