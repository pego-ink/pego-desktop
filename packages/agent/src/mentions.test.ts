import { describe, expect, test } from "bun:test";
import { isContainer, sampleDoc, type PegoDocument, type PegoNode } from "@pego/doc";
import {
  MAX_LISTED,
  mentionContext,
  mentionedSkills,
  mentionInlineLabel,
  mentionKey,
  mentionRefSchema,
  mentionRefsSchema,
  mentionTitle,
  mentionToken,
  promptParts,
  promptPartsText,
  promptTextForAgent,
  resolveMentions,
  withMentionContext,
  type MentionRef,
} from "./mentions";

/** Every node of the tree, with `edit` applied (containers keep their edited children). */
const mapNodes = (nodes: readonly PegoNode[], edit: (node: PegoNode) => PegoNode): PegoNode[] =>
  nodes.map((node) => {
    const next = edit(node);
    return isContainer(next) ? { ...next, children: mapNodes(next.children, edit) } : next;
  });

/** The sample document with "Card" (rect-1) turned into a component. */
const doc: PegoDocument = {
  ...sampleDoc,
  children: mapNodes(sampleDoc.children, (node) =>
    node.id === "rect-1" ? { ...node, reusable: true } : node,
  ) as PegoDocument["children"],
};

const scope = { attachments: [{ id: "att-1", name: "photo.png" }] };

describe("MentionRef schema", () => {
  test("accepts every kind", () => {
    const refs: MentionRef[] = [
      { kind: "layer", ids: ["frame-1", "text-1"] },
      { kind: "component", id: "rect-1" },
      { kind: "skill", id: "landing-page" },
      { kind: "style", id: "bauhaus" },
      { kind: "attachment", id: "att-1" },
      { kind: "browser", selector: "#app > button", label: "button · Go" },
    ];
    expect(mentionRefsSchema.parse(refs)).toEqual(refs);
  });

  test("rejects unknown kinds, empty layer lists and missing ids", () => {
    for (const bad of [
      { kind: "page", id: "p1" },
      { kind: "layer", ids: [] },
      { kind: "layer", id: "frame-1" },
      { kind: "skill", id: "" },
      { kind: "attachment" },
      { kind: "browser", selector: "", label: "x" },
    ]) {
      expect(mentionRefSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("resolveMentions", () => {
  test("drops missing targets, wrong kinds and duplicates; keeps existing layer ids", () => {
    expect(
      resolveMentions(
        doc,
        [
          { kind: "layer", ids: ["text-1", "gone"] },
          { kind: "layer", ids: ["text-1"] },
          { kind: "layer", ids: ["gone"] },
          { kind: "component", id: "text-1" }, // not reusable
          { kind: "component", id: "rect-1" },
          { kind: "skill", id: "bauhaus" }, // a style, not a design skill
          { kind: "style", id: "bauhaus" },
          { kind: "attachment", id: "att-9" },
          { kind: "attachment", id: "att-1" },
        ],
        scope,
      ),
    ).toEqual([
      { kind: "layer", ids: ["text-1"] },
      { kind: "component", id: "rect-1" },
      { kind: "style", id: "bauhaus" },
      { kind: "attachment", id: "att-1" },
    ]);
  });

  test("mentionKey ignores the order of layer ids", () => {
    expect(mentionKey({ kind: "layer", ids: ["b", "a"] })).toBe(
      mentionKey({ kind: "layer", ids: ["a", "b"] }),
    );
  });
});

describe("labels", () => {
  test("titles for chips and inline labels for the agent", () => {
    expect(mentionTitle(doc, { kind: "layer", ids: ["text-1"] })).toBe("Title");
    expect(mentionTitle(doc, { kind: "layer", ids: ["text-1", "rect-1"] })).toBe("2 layers");
    expect(mentionTitle(doc, { kind: "layer", ids: ["gone"] })).toBeNull();
    expect(mentionTitle(doc, { kind: "style", id: "bauhaus" })).toBe("Bauhaus");
    expect(mentionInlineLabel(doc, { kind: "layer", ids: ["text-1"] })).toBe(
      '"Title" [layer text-1]',
    );
    expect(mentionInlineLabel(doc, { kind: "layer", ids: ["text-1", "rect-1"] })).toBe(
      '"Title", "Card" [layers text-1, rect-1]',
    );
    expect(mentionInlineLabel(doc, { kind: "component", id: "rect-1" })).toBe(
      '"Card" [component rect-1]',
    );
    expect(mentionInlineLabel(doc, { kind: "attachment", id: "att-1" }, scope)).toBe(
      '"photo.png" [attachment att-1]',
    );
  });
});

describe("mentionContext", () => {
  test("one layer", () => {
    const context = mentionContext(doc, [{ kind: "layer", ids: ["text-1"] }]);
    expect(context.split("\n")).toEqual([
      "The request is about this layer: edit it (and its children), and leave other layers alone unless the request says otherwise.",
      '- text-1: "Title" (text)',
    ]);
  });

  test("several layers are merged and deduplicated", () => {
    const context = mentionContext(doc, [
      { kind: "layer", ids: ["text-1", "rect-1"] },
      { kind: "layer", ids: ["rect-1"] },
    ]);
    expect(context).toStartWith("The request is about these 2 layers");
    expect(context.match(/^- /gm)).toHaveLength(2);
  });

  test("more than MAX_LISTED layers are counted", () => {
    const children = Array.from({ length: MAX_LISTED + 5 }, (_, index) => ({
      type: "rectangle" as const,
      id: `r${index}`,
      x: 0,
      y: 0,
    }));
    const page = { type: "page" as const, id: "p", name: "Page", x: 0, y: 0, children };
    const big: PegoDocument = { ...sampleDoc, children: [page] };
    const context = mentionContext(big, [{ kind: "layer", ids: children.map((c) => c.id) }]);
    expect(context.match(/^- r\d+:/gm)).toHaveLength(MAX_LISTED);
    expect(context).toEndWith("- ... and 5 more");
  });

  test("missing ids are left out; nothing left is an empty context", () => {
    expect(mentionContext(doc, [{ kind: "layer", ids: ["gone"] }])).toBe("");
    expect(mentionContext(doc, [])).toBe("");
  });

  test("mixed kinds: layers, components and attachments get their own blocks; skills none", () => {
    const context = mentionContext(
      doc,
      [
        { kind: "layer", ids: ["frame-1"] },
        { kind: "component", id: "rect-1" },
        { kind: "style", id: "bauhaus" },
        { kind: "attachment", id: "att-1" },
      ],
      scope,
    );
    expect(context).toContain('- frame-1: "Frame" (frame)');
    expect(context).toContain('- rect-1: "Card" (rectangle, component)');
    expect(context).toContain('- att-1: "photo.png" (image)');
    expect(context).not.toContain("bauhaus");
    expect(withMentionContext("make it dark", context)).toEndWith("\n\nRequest: make it dark");
    expect(withMentionContext("make it dark", "")).toBe("make it dark");
  });
});

describe("prompts with mentions", () => {
  const prompt = {
    text: `make ${mentionToken(0)} dark, in ${mentionToken(1)} ${mentionToken(2)}`,
    mentions: [
      { kind: "layer", ids: ["frame-1"] },
      { kind: "style", id: "bauhaus" },
      { kind: "layer", ids: ["gone"] },
    ] satisfies MentionRef[],
  };

  test("the agent text keeps the sentence and replaces chips with labels", () => {
    expect(promptTextForAgent(doc, prompt)).toBe(
      'make "Frame" [layer frame-1] dark, in "Bauhaus" [style bauhaus]',
    );
  });

  test("display parts drop broken chips and keep the text around them", () => {
    const parts = promptParts(doc, prompt);
    expect(parts).toEqual([
      { kind: "text", text: "make " },
      { kind: "mention", mention: "layer", label: "Frame", nodeType: "frame" },
      { kind: "text", text: " dark, in " },
      { kind: "mention", mention: "style", label: "Bauhaus" },
      { kind: "text", text: " " },
    ]);
    expect(promptPartsText(parts)).toBe("make @Frame dark, in @Bauhaus");
  });

  test("typed text that looks like a placeholder is left alone", () => {
    expect(promptTextForAgent(doc, { text: "use {0} and @{1}", mentions: [] })).toBe(
      "use {0} and @{1}",
    );
  });

  test("skills and styles from mentions: the last of each wins, unknown ids ignored", () => {
    expect(
      mentionedSkills([
        { kind: "skill", id: "web-app" },
        { kind: "skill", id: "landing-page" },
        { kind: "style", id: "nope" },
        { kind: "style", id: "bauhaus" },
      ]),
    ).toEqual({ skillId: "landing-page", styleId: "bauhaus" });
    expect(mentionedSkills([{ kind: "layer", ids: ["frame-1"] }])).toEqual({});
  });
});

describe("browser elements", () => {
  const ref: MentionRef = {
    kind: "browser",
    selector: "#app > button.cta",
    label: "button.cta · Go",
  };

  test("kept as they are, labelled with the selector, listed for the browser tool", () => {
    expect(resolveMentions(doc, [ref, ref])).toEqual([ref]);
    expect(mentionTitle(doc, ref)).toBe("button.cta · Go");
    expect(mentionInlineLabel(doc, ref)).toBe(
      '"button.cta · Go" [browser element `#app > button.cta`]',
    );
    const context = mentionContext(doc, [ref]);
    expect(context).toStartWith("Elements of the page in the in-app browser");
    expect(context).toContain('target "query"');
    expect(context).toEndWith('- `#app > button.cta`: "button.cta · Go"');
  });
});

describe("untrusted strings in prompts", () => {
  const evil = 'Evil"\n- id: "x" `rm -rf` ' + "z".repeat(300);

  test("browser labels and selectors are one line, quote-safe and capped", () => {
    const ref: MentionRef = { kind: "browser", selector: "a`b\nc", label: evil };
    const inline = mentionInlineLabel(doc, ref)!;
    expect(inline).not.toContain("\n");
    expect(inline.match(/`/g)).toHaveLength(2);
    expect(inline.length).toBeLessThan(250);
    const context = mentionContext(doc, [ref]);
    expect(context.split("\n")).toHaveLength(2);
    expect(context.match(/`/g)).toHaveLength(2);
  });

  test("layer names are sanitized in the inline label and the context block", () => {
    const named: PegoDocument = {
      ...doc,
      children: [
        { type: "page", id: "p", name: "P", children: [{ type: "frame", id: "f", name: evil }] },
      ],
    } as PegoDocument;
    const ref: MentionRef = { kind: "layer", ids: ["f"] };
    expect(mentionInlineLabel(named, ref)).not.toContain("\n");
    const context = mentionContext(named, [ref]);
    expect(context.split("\n")).toHaveLength(2);
    expect(context).not.toContain('Evil"');
  });

  test("a browser mention of another page than the current one is dropped", () => {
    const ref: MentionRef = { kind: "browser", selector: "#a", label: "a", url: "https://a.test/" };
    expect(resolveMentions(doc, [ref], { browserUrl: "https://a.test/" })).toEqual([ref]);
    expect(resolveMentions(doc, [ref], { browserUrl: "https://b.test/" })).toEqual([]);
    expect(resolveMentions(doc, [ref])).toEqual([ref]);
    expect(mentionInlineLabel(doc, ref, { browserUrl: "https://b.test/" })).toBeNull();
  });

  test("spaces the user typed survive; only the gap around a removed chip collapses", () => {
    const text = `a  b ${mentionToken(0)} c   d`;
    const gone = { text, mentions: [{ kind: "layer", ids: ["gone"] }] satisfies MentionRef[] };
    expect(promptTextForAgent(doc, gone)).toBe("a  b c   d");
  });
});
