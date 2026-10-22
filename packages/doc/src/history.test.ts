import { describe, expect, test } from "bun:test";
import {
  commit,
  emptyHistory,
  extendLast,
  HISTORY_LIMIT,
  redo,
  undo,
  type History,
} from "./history";
import { OpError, type Op } from "./ops";
import { documentSchema, nodeSchema, type PegoDocument, type PegoNode } from "./schema";
import { findNode, isContainer } from "./tree";

const node = (input: Record<string, unknown>): PegoNode => nodeSchema.parse(input);

const makeDoc = (): PegoDocument =>
  documentSchema.parse({
    version: 2,
    id: "doc",
    name: "Test",
    variables: {},
    children: [
      {
        type: "page",
        id: "page-1",
        name: "Page 1",
        x: 0,
        y: 0,
        children: [
          {
            type: "frame",
            id: "f1",
            children: [
              { type: "rectangle", id: "r1", x: 10, y: 20 },
              { type: "ellipse", id: "e1" },
            ],
          },
          { type: "frame", id: "f2", children: [] },
        ],
      },
    ],
  });

const user = { source: "user" } as const;
const setX = (id: string, x: number): Op => ({ op: "update", id, props: { x } });
const xOf = (doc: PegoDocument, id: string) => (findNode(doc, id) as { x: number }).x;

describe("commit", () => {
  test("records one transaction with ops, inverse and meta", () => {
    const doc = makeDoc();
    const ops = [setX("r1", 1), setX("r1", 2)];
    const result = commit(doc, emptyHistory(), ops, { source: "agent", label: "nudge" });
    expect(xOf(result.doc, "r1")).toBe(2);
    expect(result.history.past).toHaveLength(1);
    expect(result.history.future).toEqual([]);
    expect(result.transaction).toBe(result.history.past[0]!);
    expect(result.transaction).toMatchObject({ ops, source: "agent", label: "nudge" });
    expect(result.transaction.inverse).toHaveLength(2);
  });

  test("clears the redo stack", () => {
    const doc = makeDoc();
    const a = commit(doc, emptyHistory(), [setX("r1", 1)], user);
    const undone = undo(a.doc, a.history)!;
    expect(undone.history.future).toHaveLength(1);
    const b = commit(undone.doc, undone.history, [setX("r1", 2)], user);
    expect(b.history.future).toEqual([]);
    expect(redo(b.doc, b.history)).toBeNull();
  });

  test("does not mutate the previous history or doc", () => {
    const doc = makeDoc();
    const snapshot = structuredClone(doc);
    const history = emptyHistory();
    commit(doc, history, [setX("r1", 1)], user);
    expect(doc).toStrictEqual(snapshot);
    expect(history).toEqual({ past: [], future: [] });
  });

  test("a failing op throws and records nothing", () => {
    const doc = makeDoc();
    const history = commit(doc, emptyHistory(), [setX("r1", 1)], user).history;
    expect(() => commit(doc, history, [setX("r1", 2), { op: "delete", id: "nope" }], user)).toThrow(
      OpError,
    );
    expect(history.past).toHaveLength(1);
  });

  test("caps past at HISTORY_LIMIT, keeping the most recent", () => {
    let doc = makeDoc();
    let history = emptyHistory();
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      const r = commit(doc, history, [setX("r1", i)], { source: "user", label: `t${i}` });
      doc = r.doc;
      history = r.history;
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]!.label).toBe("t6");
    expect(history.past.at(-1)!.label).toBe(`t${HISTORY_LIMIT + 5}`);
    // undo everything that is still tracked: lands on the state before t6
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      const u = undo(doc, history)!;
      doc = u.doc;
      history = u.history;
    }
    expect(xOf(doc, "r1")).toBe(5);
    expect(undo(doc, history)).toBeNull();
  });
});

describe("undo / redo", () => {
  test("return null when empty", () => {
    const doc = makeDoc();
    expect(undo(doc, emptyHistory())).toBeNull();
    expect(redo(doc, emptyHistory())).toBeNull();
  });

  test("restore exact docs", () => {
    const d0 = makeDoc();
    const a = commit(d0, emptyHistory(), [setX("r1", 1)], user);
    const b = commit(
      a.doc,
      a.history,
      [
        { op: "delete", id: "e1" },
        { op: "move", id: "r1", parentId: "f2" },
      ],
      user,
    );

    const u1 = undo(b.doc, b.history)!;
    expect(u1.doc).toStrictEqual(a.doc);
    expect(u1.history.past).toHaveLength(1);
    expect(u1.history.future).toHaveLength(1);

    const u2 = undo(u1.doc, u1.history)!;
    expect(u2.doc).toStrictEqual(d0);
    expect(undo(u2.doc, u2.history)).toBeNull();

    const r1 = redo(u2.doc, u2.history)!;
    expect(r1.doc).toStrictEqual(a.doc);
    const r2 = redo(r1.doc, r1.history)!;
    expect(r2.doc).toStrictEqual(b.doc);
    expect(r2.history.future).toEqual([]);
    expect(redo(r2.doc, r2.history)).toBeNull();
  });

  test("undo of a multi-op transaction reverts all ops at once", () => {
    const d0 = makeDoc();
    const t = commit(
      d0,
      emptyHistory(),
      [
        { op: "insert", parentId: "f2", node: node({ type: "rectangle", id: "n" }) },
        { op: "move", id: "n", parentId: "f1", index: 0 },
        { op: "update", id: "n", props: { x: 3 } },
        { op: "delete", id: "r1" },
      ],
      user,
    );
    expect(undo(t.doc, t.history)!.doc).toStrictEqual(d0);
  });
});

describe("extendLast", () => {
  test("throws when there is nothing to extend", () => {
    expect(() => extendLast(makeDoc(), emptyHistory(), [setX("r1", 1)])).toThrow();
  });

  test("folds a 10-step drag into one undo step", () => {
    const d0 = makeDoc();
    let { doc, history } = commit(d0, emptyHistory(), [setX("r1", 100)], user);
    for (let x = 101; x <= 109; x++) {
      const r = extendLast(doc, history, [setX("r1", x)]);
      doc = r.doc;
      history = r.history;
    }
    expect(xOf(doc, "r1")).toBe(109);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.ops).toHaveLength(10);

    const u = undo(doc, history)!;
    expect(u.doc).toStrictEqual(d0);
    expect(u.history.past).toHaveLength(0);

    const r = redo(u.doc, u.history)!;
    expect(xOf(r.doc, "r1")).toBe(109);
  });

  test("keeps earlier transactions separate and preserves meta", () => {
    const d0 = makeDoc();
    const a = commit(d0, emptyHistory(), [setX("e1", 5)], user);
    const b = commit(a.doc, a.history, [setX("r1", 1)], { source: "agent", label: "drag" });
    const c = extendLast(b.doc, b.history, [setX("r1", 2)]);
    expect(c.history.past).toHaveLength(2);
    expect(c.history.past[1]).toMatchObject({ source: "agent", label: "drag" });
    expect(undo(c.doc, c.history)!.doc).toStrictEqual(a.doc);
  });

  test("clears the redo stack", () => {
    const a = commit(makeDoc(), emptyHistory(), [setX("r1", 1)], user);
    const b = commit(a.doc, a.history, [setX("r1", 2)], user);
    const u = undo(b.doc, b.history)!;
    const e = extendLast(u.doc, u.history, [setX("r1", 3)]);
    expect(e.history.future).toEqual([]);
  });

  test("a failing extension leaves history untouched", () => {
    const a = commit(makeDoc(), emptyHistory(), [setX("r1", 1)], user);
    expect(() =>
      extendLast(a.doc, a.history, [setX("r1", 2), { op: "delete", id: "nope" }]),
    ).toThrow(OpError);
    expect(a.history.past[0]!.ops).toHaveLength(1);
  });

  test("works with structural ops mixed in", () => {
    const d0 = makeDoc();
    const a = commit(d0, emptyHistory(), [{ op: "move", id: "r1", parentId: "f2" }], user);
    const b = extendLast(a.doc, a.history, [
      { op: "move", id: "r1", parentId: "f1", index: 1 },
      { op: "delete", id: "e1" },
    ]);
    expect(undo(b.doc, b.history)!.doc).toStrictEqual(d0);
  });
});

// --- randomized property test ------------------------------------------------

/** mulberry32: small deterministic PRNG. */
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const flatten = (nodes: PegoNode[], out: PegoNode[] = []): PegoNode[] => {
  for (const n of nodes) {
    out.push(n);
    if (isContainer(n)) flatten(n.children, out);
  }
  return out;
};

const descendantIds = (n: PegoNode): Set<string> => new Set(flatten([n]).map((x) => x.id));

describe("property: random ops", () => {
  test.each([1, 2, 3])(
    "undo-all restores the original, redo-all reaches the final doc (seed %d)",
    (seed) => {
      const rand = makeRng(seed);
      const int = (n: number) => Math.floor(rand() * n);
      const pick = <T>(items: T[]): T => items[int(items.length)]!;
      let counter = 0;
      const freshId = () => `n${++counter}`;

      const freshNode = (depth = 0): PegoNode => {
        const kind = pick(["rectangle", "ellipse", "frame", "group", "text"]);
        const id = freshId();
        if (kind === "text") return node({ type: "text", id, content: "t" });
        if (kind === "frame" || kind === "group") {
          const children =
            depth < 2 ? Array.from({ length: int(3) }, () => freshNode(depth + 1)) : [];
          return node({ type: kind, id, children });
        }
        return node({ type: kind, id });
      };

      const genOp = (doc: PegoDocument): Op => {
        const everything = flatten(doc.children);
        const all = everything.filter((n) => n.type !== "page");
        const pages = everything.filter((n) => n.type === "page");
        const containers = everything.filter(isContainer);
        const kind = pick([
          "insert",
          "insert",
          "update",
          "update",
          "replace",
          "move",
          "move",
          "delete",
          "setVariables",
          "page",
        ]);
        const target = all.length > 0 ? pick(all) : null;
        const parents = containers.map((c) => c.id);

        // Pages: add one at the root, or delete one while more than one exists.
        if (kind === "page") {
          if (pages.length > 1 && rand() < 0.5) return { op: "delete", id: pick(pages).id };
          return {
            op: "insert",
            parentId: null,
            index: int(3),
            node: node({ type: "page", id: freshId(), name: "P", children: [] }),
          };
        }
        if (kind === "update" && target) {
          return pick<Op>([
            { op: "update", id: target.id, props: { x: int(500) } },
            { op: "update", id: target.id, props: { opacity: rand() } },
            { op: "update", id: target.id, props: { opacity: null, name: `n${int(9)}` } },
            { op: "update", id: target.id, props: { name: null, y: int(500), rotation: int(90) } },
          ]);
        }
        if (kind === "replace" && target)
          return { op: "replace", id: target.id, node: freshNode() };
        if (kind === "move" && target) {
          const banned = descendantIds(target);
          const options = parents.filter((p) => !banned.has(p));
          return { op: "move", id: target.id, parentId: pick(options), index: int(6) };
        }
        if (kind === "delete" && target) return { op: "delete", id: target.id };
        if (kind === "setVariables") {
          const name = `v${int(4)}`;
          return {
            op: "setVariables",
            variables: { [name]: rand() < 0.4 ? null : { type: "number", value: int(100) } },
          };
        }
        return {
          op: "insert",
          parentId: pick(parents),
          index: rand() < 0.2 ? undefined : int(6),
          node: freshNode(),
        };
      };

      const original = makeDoc();
      let doc = original;
      let history: History = emptyHistory();
      const snapshots: PegoDocument[] = [structuredClone(doc)];
      const total = HISTORY_LIMIT;

      for (let i = 0; i < total; i++) {
        const op = genOp(doc);
        const result = commit(doc, history, [op], user);
        doc = result.doc;
        history = result.history;
        snapshots.push(structuredClone(doc));
      }
      expect(history.past).toHaveLength(total);
      const finalDoc = structuredClone(doc);

      for (let i = total - 1; i >= 0; i--) {
        const r = undo(doc, history)!;
        expect(r).not.toBeNull();
        doc = r.doc;
        history = r.history;
        expect(doc).toStrictEqual(snapshots[i]!);
      }
      expect(doc).toStrictEqual(original);
      expect(undo(doc, history)).toBeNull();

      for (let i = 1; i <= total; i++) {
        const r = redo(doc, history)!;
        expect(r).not.toBeNull();
        doc = r.doc;
        history = r.history;
        expect(doc).toStrictEqual(snapshots[i]!);
      }
      expect(doc).toStrictEqual(finalDoc);
      expect(redo(doc, history)).toBeNull();
    },
  );
});
