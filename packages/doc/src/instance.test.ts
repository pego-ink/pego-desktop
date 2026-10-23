import { describe, expect, test } from "bun:test";
import { resolveInstance } from "./instance";
import { MAX_INSTANCE_DEPTH, walkRendered } from "./layout";
import { documentSchema, type PegoDocument, type PegoNode, type RefNode } from "./schema";

const makeDoc = (children: unknown[]): PegoDocument =>
  documentSchema.parse({
    version: 4,
    id: "doc",
    name: "Test",
    variables: {},
    children: [{ type: "page", id: "page-1", name: "Page 1", children }],
  });

const card = {
  type: "frame",
  id: "card",
  reusable: true,
  children: [
    {
      type: "frame",
      id: "body",
      slot: [],
      children: [{ type: "text", id: "dflt", content: "default" }],
    },
  ],
};

const ids = (node: PegoNode | null): string[] =>
  node && "children" in node ? node.children.flatMap((child) => [child.id, ...ids(child)]) : [];

const resolve = (doc: PegoDocument, ref: unknown) => resolveInstance(doc, ref as RefNode);

describe("resolveInstance slots", () => {
  test("a filled slot replaces the default content and prefixes ids", () => {
    const ref = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: { body: { children: [{ type: "text", id: "t", content: "hi" }] } },
    };
    expect(ids(resolve(makeDoc([card, ref]), ref))).toEqual(["i1/body", "i1/t"]);
  });

  test("nested refs in slot content keep their ref and get a prefixed id", () => {
    const ref = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: { body: { children: [{ type: "ref", id: "inner", ref: "card" }] } },
    };
    const doc = makeDoc([card, ref]);
    const inner = (resolve(doc, ref) as { children: { children: PegoNode[] }[] }).children[0]
      ?.children[0];
    expect(inner).toMatchObject({ type: "ref", id: "i1/inner", ref: "card" });
    expect(ids(resolve(doc, inner))).toEqual(["i1/inner/body", "i1/inner/dflt"]);
  });

  test("invalid slot content falls back to the default content", () => {
    const ref = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: { body: { children: [{ type: "nope" }, { id: "x" }] } },
    };
    expect(ids(resolve(makeDoc([card, ref]), ref))).toEqual(["i1/body", "i1/dflt"]);
  });

  test("only the valid children of a mixed slot are kept", () => {
    const ref = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: {
        body: { children: [{ type: "nope" }, { type: "text", id: "ok", content: "a" }] },
      },
    };
    expect(ids(resolve(makeDoc([card, ref]), ref))).toEqual(["i1/body", "i1/ok"]);
  });

  test("a non-slot frame ignores children overrides", () => {
    const plain = { ...card, id: "plain", children: [{ type: "frame", id: "f", children: [] }] };
    const ref = {
      type: "ref",
      id: "i1",
      ref: "plain",
      descendants: { f: { children: [{ type: "text", id: "t", content: "x" }] } },
    };
    expect(ids(resolve(makeDoc([plain, ref]), ref))).toEqual(["i1/f"]);
  });

  test("a slot filled with its own component stops at the instance depth limit", () => {
    const self = { type: "ref", id: "again", ref: "card" };
    const looping = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: { body: { children: [self] } },
    };
    // A component whose slot default holds an instance of itself: expansion must terminate.
    const recursive = {
      type: "frame",
      id: "rec",
      reusable: true,
      children: [
        { type: "frame", id: "slot", slot: [], children: [{ type: "ref", id: "r", ref: "rec" }] },
      ],
    };
    const doc = makeDoc([card, recursive, looping, { type: "ref", id: "top", ref: "rec" }]);
    let deepest = 0;
    walkRendered(doc, doc.children[0]?.children ?? [], (_node, depth) => {
      deepest = Math.max(deepest, depth);
    });
    expect(deepest).toBeLessThanOrEqual(MAX_INSTANCE_DEPTH * 2 + 2);
    expect(resolve(doc, looping)).not.toBeNull();
  });

  test("the instance depth limit holds for chains of slot-filled instances", () => {
    const chain = Array.from({ length: MAX_INSTANCE_DEPTH + 4 }, (_, n) => ({
      type: "frame",
      id: `c${n}`,
      reusable: true,
      children: [
        {
          type: "frame",
          id: "s",
          slot: [],
          children: [{ type: "ref", id: `r${n}`, ref: `c${n + 1}` }],
        },
      ],
    }));
    const doc = makeDoc([...chain, { type: "ref", id: "top", ref: "c0" }]);
    let visited = 0;
    walkRendered(doc, doc.children[0]?.children.slice(-1) ?? [], () => {
      visited++;
    });
    expect(visited).toBeLessThan(MAX_INSTANCE_DEPTH * 3);
  });

  test("slot content is validated once per children array", () => {
    const ref = {
      type: "ref",
      id: "i1",
      ref: "card",
      descendants: { body: { children: [{ type: "text", id: "t", content: "hi" }] } },
    };
    const doc = makeDoc([card, ref]);
    const first = resolve(doc, ref) as { children: { children: PegoNode[] }[] };
    const second = resolve(doc, ref) as { children: { children: PegoNode[] }[] };
    expect(first.children[0]?.children[0]).toEqual(second.children[0]?.children[0]);
  });
});
