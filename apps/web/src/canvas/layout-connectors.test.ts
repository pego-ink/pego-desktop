import { describe, expect, test } from "bun:test";
import type { PegoDocument } from "@pego/doc";
import { getLayout, setConnectorsShown } from "./layout";

const doc: PegoDocument = {
  version: 9,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "p",
      name: "P",
      x: 0,
      y: 0,
      children: [
        { type: "rectangle", id: "a", x: 0, y: 0, width: 10, height: 10 },
        { type: "rectangle", id: "b", x: 100, y: 0, width: 10, height: 10 },
        { type: "connector", id: "c", x: 0, y: 0, from: { id: "a" }, to: { id: "b" } },
      ],
    },
  ],
};

describe("hidden connectors", () => {
  test("turned off, connectors get no box (not drawn or hit); on again, they are back", () => {
    expect(getLayout(doc).has("c")).toBe(true);
    setConnectorsShown(false);
    expect(getLayout(doc).has("c")).toBe(false);
    expect(getLayout(doc).has("a")).toBe(true);
    setConnectorsShown(true);
    expect(getLayout(doc).has("c")).toBe(true);
  });
});
