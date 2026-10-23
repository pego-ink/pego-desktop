import { beforeEach, describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { currentMotionTime, useMotionStore } from "./use-motion-store";

const doc = (delay: number): PegoDocument =>
  ({
    version: 6,
    id: "d",
    name: "D",
    variables: {},
    children: [
      {
        type: "page",
        id: "p1",
        x: 0,
        y: 0,
        children: [
          {
            type: "rectangle",
            id: "a",
            x: 0,
            y: 0,
            animation: { preset: "fade", delay, duration: 100 },
          },
        ],
      },
      { type: "page", id: "p2", x: 0, y: 0, children: [] },
    ],
  }) as unknown as PegoDocument;

describe("motion preview", () => {
  beforeEach(() => {
    useMotionStore.getState().stop();
    useDocumentStore.setState({ doc: doc(0), pageId: "p1" });
  });

  test("plays until the last entrance ends, then stops", () => {
    expect(useMotionStore.getState().play()).toBe(true);
    const start = useMotionStore.getState().startedAt!;
    expect(currentMotionTime(start + 50)).toBeCloseTo(50, 5);
    expect(currentMotionTime(start + 1000)).toBeUndefined();
    expect(useMotionStore.getState().startedAt).toBeNull();
  });

  test("an entrance added while it plays is not cut short", () => {
    useMotionStore.getState().play();
    const start = useMotionStore.getState().startedAt!;
    useDocumentStore.setState({ doc: doc(800) });
    expect(currentMotionTime(start + 500)).toBeCloseTo(500, 5);
  });

  test("showing another page stops it, and an empty page does not play", () => {
    useMotionStore.getState().play();
    const start = useMotionStore.getState().startedAt!;
    useDocumentStore.setState({ pageId: "p2" });
    expect(currentMotionTime(start + 10)).toBeUndefined();
    expect(useMotionStore.getState().play()).toBe(false);
  });
});
