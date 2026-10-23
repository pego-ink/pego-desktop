/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc, type PageNode } from "@pego/doc";
import { focusOnPage, idsOnPage, type AgentFocusGroup } from "./focus-groups";

const page1 = sampleDoc.children[0]!;
const page2: PageNode = { type: "page", id: "page-2", name: "Page 2", x: 0, y: 0, children: [] };

const group = (key: string, ids: string[]): AgentFocusGroup => ({
  key,
  ids,
  color: "#fff",
});

describe("idsOnPage", () => {
  test("keeps the same array when every id is on the page", () => {
    const ids = ["frame-1", "rect-1"];
    expect(idsOnPage(page1, ids)).toBe(ids);
  });

  test("drops ids from other pages", () => {
    expect(idsOnPage(page1, ["rect-1", "elsewhere"])).toEqual(["rect-1"]);
    expect(idsOnPage(page2, ["rect-1"])).toEqual([]);
  });
});

describe("focusOnPage", () => {
  test("drops groups with nothing on the shown page and trims the others", () => {
    const a = group("a", ["rect-1"]);
    const b = group("b", ["elsewhere"]);
    const c = group("c", ["text-1", "elsewhere"]);
    const shown = focusOnPage([a, b, c], page1);
    expect(shown.map((g) => g.key)).toEqual(["a", "c"]);
    expect(shown[0]).toBe(a);
    expect(shown[1]!.ids).toEqual(["text-1"]);
  });
});
