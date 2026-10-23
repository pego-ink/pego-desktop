/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isContainer, sampleDoc, type PegoDocument, type PegoNode } from "@pego/doc";
import { skills } from "@pego/agent";
import { foldForSearch, mentionSuggestions, type MentionSources } from "./mention-sources";

/** Every node of the tree, with `edit` applied (containers keep their edited children). */
const mapNodes = (nodes: readonly PegoNode[], edit: (node: PegoNode) => PegoNode): PegoNode[] =>
  nodes.map((node) => {
    const next = edit(node);
    return isContainer(next) ? { ...next, children: mapNodes(next.children, edit) } : next;
  });

/** The sample page with "Card" as a component, and a second page with a "Button" component. */
const doc: PegoDocument = {
  ...sampleDoc,
  children: [
    ...(mapNodes(sampleDoc.children, (node) =>
      node.id === "rect-1" ? { ...node, reusable: true } : node,
    ) as PegoDocument["children"]),
    {
      type: "page",
      id: "page-2",
      name: "Page 2",
      x: 0,
      y: 0,
      children: [{ type: "rectangle", id: "btn", name: "Card button", x: 0, y: 0, reusable: true }],
    },
  ],
};

const sources = (patch: Partial<MentionSources> = {}): MentionSources => ({
  doc,
  pageId: "page-1",
  selection: [],
  skills,
  attachments: [{ id: "att-1", name: "Café photo.png" }],
  ...patch,
});

describe("mention suggestions", () => {
  test("search is case- and diacritic-insensitive", () => {
    expect(foldForSearch("  Café ")).toBe("cafe");
    const items = mentionSuggestions("CAFE", sources());
    expect(items.map((item) => [item.section, item.title])).toEqual([
      ["Attachments", "Café photo.png"],
    ]);
  });

  test("layers match by name or type; components are listed too", () => {
    const items = mentionSuggestions("card", sources());
    expect(items.filter((item) => item.section === "Layers").map((item) => item.ref)).toEqual([
      { kind: "layer", ids: ["rect-1"] },
    ]);
    expect(items.find((item) => item.section === "Components")?.ref).toEqual({
      kind: "component",
      id: "rect-1",
    });
    expect(mentionSuggestions("text", sources()).some((item) => item.title === "Title")).toBe(true);
  });

  test("layers come from the shown page, components from every page", () => {
    const items = mentionSuggestions("card", sources());
    expect(items.filter((item) => item.section === "Components").map((item) => item.title)).toEqual(
      ["Card", "Card button"],
    );
    const other = mentionSuggestions("card", sources({ pageId: "page-2" }));
    expect(other.filter((item) => item.section === "Layers").map((item) => item.title)).toEqual([
      "Card button",
    ]);
  });

  test("the selection is offered first as one chip", () => {
    const [first] = mentionSuggestions("", sources({ selection: ["rect-1", "text-1"] }));
    expect(first).toMatchObject({
      section: "Selection",
      title: "Selection (2 layers)",
      ref: { kind: "layer", ids: ["rect-1", "text-1"] },
    });
  });

  test("skills and styles come from the skill registry, split by kind", () => {
    const items = mentionSuggestions("bauhaus", sources());
    expect(items.map((item) => [item.section, item.ref])).toEqual([
      ["Styles", { kind: "style", id: "bauhaus" }],
    ]);
    const landing = mentionSuggestions("landing", sources());
    expect(landing.find((item) => item.section === "Skills")?.ref).toEqual({
      kind: "skill",
      id: "landing-page",
    });
  });

  test("an empty query lists every section with a cap per section", () => {
    const items = mentionSuggestions("", sources({ selection: ["text-1"] }));
    const sections = [...new Set(items.map((item) => item.section))];
    expect(sections).toEqual([
      "Selection",
      "Layers",
      "Components",
      "Skills",
      "Styles",
      "Attachments",
    ]);
    expect(items.filter((item) => item.section === "Styles").length).toBeLessThanOrEqual(6);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});
