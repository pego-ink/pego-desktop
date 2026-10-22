/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  bytesToBase64,
  computeImageSize,
  DEFAULT_MAX_IMAGE_SIZE,
  HARD_MAX_IMAGE_SIZE,
} from "./render-image";

describe("computeImageSize", () => {
  test("defaults to scale 1", () => {
    expect(computeImageSize({ width: 320, height: 200 })).toEqual({
      width: 320,
      height: 200,
      scale: 1,
    });
  });

  test("applies scale", () => {
    expect(computeImageSize({ width: 100, height: 50 }, { scale: 2 })).toMatchObject({
      width: 200,
      height: 100,
      scale: 2,
    });
  });

  test("clamps the longest side to maxSize, keeping aspect", () => {
    const size = computeImageSize({ width: 2000, height: 1000 }, { maxSize: 500 });
    expect(size).toEqual({ width: 500, height: 250, scale: 0.25 });
    const tall = computeImageSize({ width: 100, height: 4000 }, { scale: 3, maxSize: 1000 });
    expect(tall.height).toBe(1000);
    expect(tall.width).toBe(25);
  });

  test("default and hard caps", () => {
    expect(computeImageSize({ width: 10_000, height: 10 }).width).toBe(DEFAULT_MAX_IMAGE_SIZE);
    expect(computeImageSize({ width: 10_000, height: 10 }, { maxSize: 99_999 }).width).toBe(
      HARD_MAX_IMAGE_SIZE,
    );
  });

  test("never returns a zero side and ignores bad options", () => {
    const size = computeImageSize({ width: 1000, height: 1 }, { maxSize: 100 });
    expect(size.height).toBe(1);
    expect(computeImageSize({ width: 10, height: 10 }, { scale: -1, maxSize: Number.NaN })).toEqual(
      { width: 10, height: 10, scale: 1 },
    );
  });
});

describe("bytesToBase64", () => {
  test("matches Buffer encoding, including large inputs", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
