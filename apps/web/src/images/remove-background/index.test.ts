import { expect, test } from "bun:test";
import { dataUrlToBlob } from "./index";

test("data URLs are decoded without fetch (the desktop CSP refuses data: in fetch)", async () => {
  const blob = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
  expect(blob.type).toBe("image/png");
  expect(Array.from(new Uint8Array(await blob.arrayBuffer())).slice(0, 4)).toEqual([
    137, 80, 78, 71,
  ]);
  expect(() => dataUrlToBlob("https://example.com/a.png")).toThrow();
});
