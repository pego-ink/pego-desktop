import { describe, expect, test } from "bun:test";
import { TOOL_GROUPS, groupHasTool, shownEntry, tooltipFor } from "./toolbar-groups";

const group = (id: string) => TOOL_GROUPS.find((g) => g.id === id)!;

describe("toolbar groups", () => {
  test("every tool except none appears in exactly one group", () => {
    const tools = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.tool));
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools).toHaveLength(13);
  });

  test("shows the active tool of the group, else the last used", () => {
    expect(shownEntry(group("shapes"), "rectangle", "star").tool).toBe("star");
    expect(shownEntry(group("shapes"), "star", "select").tool).toBe("star");
    expect(shownEntry(group("pen"), "pencil", "text").tool).toBe("pencil");
  });

  test("groupHasTool and tooltip", () => {
    expect(groupHasTool(group("shapes"), "polygon")).toBe(true);
    expect(groupHasTool(group("pen"), "polygon")).toBe(false);
    expect(tooltipFor(group("shapes").tools[0]!)).toBe("Rectangle (R)");
    expect(tooltipFor(group("shapes").tools[4]!)).toBe("Polygon");
  });
});
