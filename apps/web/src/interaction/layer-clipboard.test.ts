/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { layerClipboard, readLayerClipboard } from "./layer-clipboard";

describe("layer clipboard", () => {
  test("copied layers carry their ids as text and, for the composer, the document", () => {
    const copied = layerClipboard(sampleDoc, ["text-1", "gone", "rect-1"]);
    expect(copied?.text).toBe("Node IDs: text-1, rect-1");
    expect(readLayerClipboard(copied!.payload, sampleDoc)).toEqual(["text-1", "rect-1"]);
    expect(layerClipboard(sampleDoc, ["text-1"])?.text).toBe("Node ID: text-1");
    expect(layerClipboard(sampleDoc, [])).toBeNull();
  });

  test("layers from another document, or garbage, are not read", () => {
    const copied = layerClipboard(sampleDoc, ["text-1"])!;
    expect(readLayerClipboard(copied.payload, { ...sampleDoc, id: "other" })).toBeNull();
    expect(readLayerClipboard("not json", sampleDoc)).toBeNull();
    expect(readLayerClipboard("", sampleDoc)).toBeNull();
  });
});
