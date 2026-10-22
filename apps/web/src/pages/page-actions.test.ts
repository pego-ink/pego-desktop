/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { addPage, deletePage, nextPageName, renamePage, showPage } from "./page-actions";

beforeEach(() => useDocumentStore.getState().load(sampleDoc));
const state = () => useDocumentStore.getState();

describe("pages", () => {
  test("next page name skips names in use", () => {
    expect(nextPageName([{ name: "Page 1" }])).toBe("Page 2");
    expect(nextPageName([{ name: "Page 1" }, { name: "Page 3" }])).toBe("Page 4");
  });

  test("add shows the new page; drawing there lands on it; undo removes it", () => {
    const id = addPage()!;
    expect(activePage(state()).id).toBe(id);
    state().commit([
      { op: "insert", parentId: null, node: { type: "ellipse", id: "e", x: 0, y: 0 } },
    ]);
    expect(activePage(state()).children.map((n) => n.id)).toEqual(["e"]);
    state().undo();
    state().undo();
    expect(state().doc.children).toHaveLength(1);
    // The stored page id is gone: the first page is shown.
    expect(activePage(state()).id).toBe("page-1");
  });

  test("switching pages clears the selection", () => {
    state().select(["frame-1"]);
    const id = addPage()!;
    expect(state().selection).toEqual([]);
    showPage("page-1");
    expect(activePage(state()).id).toBe("page-1");
    expect(id).not.toBe("page-1");
  });

  test("rename and delete (never the last page)", () => {
    renamePage("page-1", "  Main flow ");
    expect(state().doc.children[0]!.name).toBe("Main flow");
    deletePage("page-1");
    expect(state().doc.children).toHaveLength(1);
    const id = addPage()!;
    deletePage(id);
    expect(state().doc.children.map((p) => p.id)).toEqual(["page-1"]);
    expect(activePage(state()).id).toBe("page-1");
  });
});
