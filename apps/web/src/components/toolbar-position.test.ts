/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isToolbarPosition, TOOLBAR_POSITIONS, toolbarLayout } from "./toolbar-position";

describe("toolbar position", () => {
  test("rows at the bottom and top, columns on the sides; menus open toward the canvas", () => {
    expect(toolbarLayout("bottom")).toEqual({ vertical: false, menuSide: "top" });
    expect(toolbarLayout("top")).toEqual({ vertical: false, menuSide: "bottom" });
    expect(toolbarLayout("left")).toEqual({ vertical: true, menuSide: "right" });
    expect(toolbarLayout("right")).toEqual({ vertical: true, menuSide: "left" });
  });

  test("only known positions are accepted", () => {
    for (const position of TOOLBAR_POSITIONS) expect(isToolbarPosition(position)).toBe(true);
    expect(isToolbarPosition("middle")).toBe(false);
    expect(isToolbarPosition(undefined)).toBe(false);
  });
});
