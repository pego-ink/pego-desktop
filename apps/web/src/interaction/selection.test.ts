import { describe, expect, test } from "bun:test";
import { drillTarget, escapeSelection, marqueeSelect, pickAt, toggleSelection } from "./selection";
import { fixtureDoc as doc, fixtureLayout as layout } from "./test-doc";

describe("pickAt", () => {
  test("empty canvas -> null", () => expect(pickAt(doc, layout, 500, 500, [], false)).toBeNull());
  test("frame background selects the top-level frame", () =>
    expect(pickAt(doc, layout, 300, 300, [], false)).toBe("f1"));
  test("child click selects one level inside the top-level frame", () =>
    expect(pickAt(doc, layout, 60, 60, [], false)).toBe("r2"));
  test("group is selected as a unit", () =>
    expect(pickAt(doc, layout, 210, 210, [], false)).toBe("g1"));
  test("cmd+click selects the deepest node", () =>
    expect(pickAt(doc, layout, 210, 210, [], true)).toBe("gr"));
  test("hit inside an instance selects the instance root", () =>
    expect(pickAt(doc, layout, 310, 20, [], true)).toBe("inst"));
  test("with a selection inside a group, siblings resolve at the same level", () =>
    expect(pickAt(doc, layout, 210, 210, ["g1"], false)).toBe("g1"));
  test("selected node's parent in chain keeps picking at that level", () =>
    expect(pickAt(doc, layout, 20, 20, ["r2"], false)).toBe("r1"));
});

describe("drillTarget", () => {
  test("selected group drills to the child under cursor", () =>
    expect(drillTarget(doc, layout, 210, 210, ["g1"])).toBe("gr"));
  test("selected frame drills one level", () =>
    expect(drillTarget(doc, layout, 20, 20, ["f1"])).toBe("r1"));
  test("nothing selected on chain -> null", () =>
    expect(drillTarget(doc, layout, 20, 20, [])).toBeNull());
});

describe("selection helpers", () => {
  test("toggle adds and removes", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
  test("marquee selects intersecting top-level nodes", () => {
    expect(marqueeSelect(doc, layout, { x: 390, y: 10, width: 220, height: 10 })).toEqual([
      "f1",
      "f2",
    ]);
    expect(marqueeSelect(doc, layout, { x: 450, y: 450, width: 10, height: 10 })).toEqual([]);
  });
  test("escape selects parent, clears at top level", () => {
    expect(escapeSelection(doc, ["r1", "r2"])).toEqual(["f1"]);
    expect(escapeSelection(doc, ["f1"])).toEqual([]);
    expect(escapeSelection(doc, ["r1", "flexchild"])).toEqual([]);
  });
});
