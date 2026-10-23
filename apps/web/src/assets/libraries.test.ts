/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  computeLayout,
  findNode,
  sampleDoc,
  type FrameNode,
  type PegoDocument,
  type PegoNode,
  type RefNode,
} from "@pego/doc";
import { libraryId, libraryPages, removeLibraryOps, syncLibraryOps } from "./libraries";

const frame = (id: string, props: Record<string, unknown>, children: PegoNode[] = []) =>
  ({ type: "frame", id, x: 0, y: 0, layout: "none", children, ...props }) as PegoNode;

/** A "kit" project: a Badge, and a Card holding a Badge instance and a slot recommending Badge. */
const kit = (withBadge = true): PegoDocument => ({
  version: 3,
  id: "kit-project",
  name: "Kit",
  variables: { brand: { type: "color", value: "#ff0000" } },
  children: [
    {
      type: "page",
      id: "kp",
      name: "Components",
      x: 0,
      y: 0,
      children: [
        ...(withBadge
          ? [
              frame("badge", {
                name: "Badge",
                reusable: true,
                width: 60,
                height: 24,
                fill: "$brand",
              }),
            ]
          : []),
        frame("card", { name: "Card", reusable: true, width: 300, height: 200 }, [
          ...(withBadge
            ? [{ type: "ref", id: "card-badge", ref: "badge", x: 10, y: 10 } as PegoNode]
            : []),
          frame("body", { slot: withBadge ? ["badge"] : [], width: 200, height: 80 }),
        ]),
      ],
    },
  ],
});

const source = { projectId: "kit-project", name: "Kit", path: "/design/kit/project.pego" };
const add = (doc: PegoDocument, from: PegoDocument = kit()) =>
  applyOps(doc, syncLibraryOps(doc, from, source, 1000).ops).doc;

describe("libraries", () => {
  test("adding copies the components onto a library page, ids and links mapped", () => {
    const doc = add(sampleDoc);
    const [page] = libraryPages(doc);
    expect(page).toMatchObject({ name: "Library · Kit", library: { ...source, syncedAt: 1000 } });
    expect(page!.children.map((node) => node.id)).toEqual([
      libraryId("kit-project", "badge"),
      libraryId("kit-project", "card"),
    ]);
    const card = findNode(doc, libraryId("kit-project", "card")) as FrameNode;
    expect(card.children[0]).toMatchObject({ type: "ref", ref: libraryId("kit-project", "badge") });
    expect((card.children[1] as FrameNode).slot).toEqual([libraryId("kit-project", "badge")]);
    expect(doc.variables.brand).toEqual({ type: "color", value: "#ff0000" });
  });

  test("an instance placed from a library survives an update", () => {
    const doc = add(sampleDoc);
    const placed = applyOps(doc, [
      {
        op: "insert",
        parentId: sampleDoc.children[0]!.id,
        node: { type: "ref", id: "my-card", ref: libraryId("kit-project", "card"), x: 0, y: 0 },
      },
    ]).doc;
    const updated = add(placed);
    expect(libraryPages(updated)).toHaveLength(1);
    expect((findNode(updated, "my-card") as RefNode).ref).toBe(libraryId("kit-project", "card"));
    const layout = computeLayout(updated, () => ({ width: 10, height: 10 }));
    expect(layout.get("my-card")).toMatchObject({ width: 300, height: 200 });
  });

  test("instances of a component the library dropped become plain layers on update", () => {
    const doc = add(sampleDoc);
    const placed = applyOps(doc, [
      {
        op: "insert",
        parentId: sampleDoc.children[0]!.id,
        node: { type: "ref", id: "my-badge", ref: libraryId("kit-project", "badge"), x: 0, y: 0 },
      },
    ]).doc;
    const updated = add(placed, kit(false));
    expect(findNode(updated, "my-badge")).toBeNull();
    expect(findNode(updated, libraryId("kit-project", "badge"))).toBeNull();
    const pageChildren = updated.children[0]!.children;
    expect(pageChildren.at(-1)).toMatchObject({ type: "frame", name: "Badge" });
  });

  test("removing a library keeps the layers made from it, as plain layers", () => {
    const doc = add(sampleDoc);
    const placed = applyOps(doc, [
      {
        op: "insert",
        parentId: sampleDoc.children[0]!.id,
        node: { type: "ref", id: "my-card", ref: libraryId("kit-project", "card"), x: 0, y: 0 },
      },
    ]).doc;
    const pageId = libraryPages(placed)[0]!.id;
    const removed = applyOps(placed, removeLibraryOps(placed, pageId)).doc;
    expect(libraryPages(removed)).toEqual([]);
    expect(findNode(removed, "my-card")).toBeNull();
    expect(removed.children[0]!.children.at(-1)).toMatchObject({ type: "frame", name: "Card" });
  });
});
