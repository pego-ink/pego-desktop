import { describe, expect, test } from "bun:test";
import { imageSize } from "./image-size";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

describe("imageSize", () => {
  test("PNG reads the IHDR chunk", () => {
    const png = bytes(
      [0x89],
      "PNG",
      [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13],
      "IHDR",
      [0, 0, 4, 0, 0, 0, 3, 0],
    );
    expect(imageSize(png)).toEqual({ width: 1024, height: 768 });
  });

  test("JPEG skips segments to the start-of-frame", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0, 4, 0, 0], // APP0, 2 bytes of payload
      [0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  test("WebP: extended, lossless and lossy headers", () => {
    const vp8x = bytes(
      "RIFF",
      [0, 0, 0, 0],
      "WEBP",
      "VP8X",
      [10, 0, 0, 0, 0, 0, 0, 0],
      [0xff, 0x04, 0x00],
      [0x37, 0x03, 0x00],
    );
    expect(imageSize(vp8x)).toEqual({ width: 1280, height: 824 });
    // VP8L: 14-bit width-1 and height-1 after the 0x2f signature.
    const w = 399;
    const h = 299;
    const bits = w | (h << 14);
    const vp8l = bytes(
      "RIFF",
      [0, 0, 0, 0],
      "WEBP",
      "VP8L",
      [0, 0, 0, 0, 0x2f],
      [bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff],
    );
    expect(imageSize(vp8l)).toEqual({ width: 400, height: 300 });
    const vp8 = bytes(
      "RIFF",
      [0, 0, 0, 0],
      "WEBP",
      "VP8 ",
      [0, 0, 0, 0],
      [0, 0, 0, 0x9d, 0x01, 0x2a],
      [0x80, 0x02, 0xe0, 0x01],
    );
    expect(imageSize(vp8)).toEqual({ width: 640, height: 480 });
  });

  test("anything else is unknown", () => {
    expect(imageSize(bytes("GIF89a", [1, 0, 1, 0]))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });
});
