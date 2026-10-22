/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  attachmentTitle,
  base64ByteLength,
  downscaleSize,
  MAX_ATTACH_SIDE,
  MAX_INPUT_BYTES,
  pastedImageFiles,
  planAdditions,
  planEncoding,
  sniffImageType,
} from "./attachment-utils";

const file = (type: string, size = 1000) => ({ type, size });

describe("sniffImageType", () => {
  test("recognises PNG, JPEG, GIF and WebP by signature", () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  test("rejects anything else, including SVG and text", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("hello world!!!"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("planAdditions", () => {
  test("accepts supported images and rejects other types with a reason", () => {
    const plan = planAdditions([file("image/png"), file("image/svg+xml"), file("text/plain")], 0);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected.map((r) => r.reason)).toEqual(["type", "type"]);
    expect(plan.overflow).toBe(0);
  });

  test("rejects files over the input cap", () => {
    const plan = planAdditions([file("image/png", MAX_INPUT_BYTES + 1)], 0);
    expect(plan.rejected.map((r) => r.reason)).toEqual(["input_too_large"]);
  });

  test("stops at the count limit, counting stored and in-flight files", () => {
    const eight = Array.from({ length: 8 }, () => file("image/jpeg"));
    expect(planAdditions(eight, 0)).toMatchObject({ overflow: 2 });
    expect(planAdditions(eight, 0).accepted).toHaveLength(6);
    const plan = planAdditions([file("image/png"), file("image/png")], 4, 1);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.overflow).toBe(1);
    expect(planAdditions([file("image/png")], 6).overflow).toBe(1);
  });
});

describe("downscaleSize", () => {
  test("never enlarges and keeps small images as they are", () => {
    expect(downscaleSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(downscaleSize({ width: 2048, height: 100 })).toEqual({ width: 2048, height: 100 });
  });
  test("scales the longest side down to 2048 and keeps the aspect ratio", () => {
    expect(downscaleSize({ width: 4096, height: 2048 })).toEqual({ width: 2048, height: 1024 });
    expect(downscaleSize({ width: 3000, height: 6000 })).toEqual({ width: 1024, height: 2048 });
    const out = downscaleSize({ width: 5000, height: 3333 });
    expect(Math.max(out.width, out.height)).toBe(MAX_ATTACH_SIDE);
  });
  test("whole pixels, at least 1", () => {
    expect(downscaleSize({ width: 100000, height: 1 })).toEqual({ width: 2048, height: 1 });
  });
});

describe("planEncoding", () => {
  const small = { width: 800, height: 600 };
  test("keeps the bytes of a small image within the limit", () => {
    expect(planEncoding("image/png", small, 1000)).toEqual({ reencode: false });
    expect(planEncoding("image/jpeg", small, 1000)).toEqual({ reencode: false });
  });
  test("re-encodes big pixels: jpeg stays jpeg, everything else becomes webp", () => {
    const big = { width: 4000, height: 3000 };
    expect(planEncoding("image/jpeg", big, 1000)).toEqual({ reencode: true, type: "image/jpeg" });
    expect(planEncoding("image/png", big, 1000)).toEqual({ reencode: true, type: "image/webp" });
  });
  test("re-encodes images over the byte limit even when small in pixels", () => {
    expect(planEncoding("image/png", small, 6 * 1024 * 1024)).toEqual({
      reencode: true,
      type: "image/webp",
    });
  });
  test("a GIF always loses its animation: lossless first frame unless it is big", () => {
    expect(planEncoding("image/gif", small, 1000)).toEqual({ reencode: true, type: "image/png" });
    expect(planEncoding("image/gif", { width: 5000, height: 10 }, 1000)).toEqual({
      reencode: true,
      type: "image/webp",
    });
  });
});

describe("misc helpers", () => {
  test("base64ByteLength matches the decoded size", () => {
    for (const text of ["", "a", "ab", "abc", "abcd", "hello world"]) {
      expect(base64ByteLength(btoa(text))).toBe(text.length);
    }
  });
  test("pasted images: text on the clipboard wins", () => {
    const png = file("image/png");
    expect(pastedImageFiles([png], ["Files"])).toEqual([png]);
    expect(pastedImageFiles([png], ["text/html", "Files"])).toEqual([png]);
    expect(pastedImageFiles([png], ["text/plain", "Files"])).toEqual([]);
    expect(pastedImageFiles([file("application/pdf")], ["Files"])).toEqual([]);
  });
  test("GIF thumbnails say only the first frame is sent", () => {
    expect(attachmentTitle("a.png")).toBe("a.png");
    expect(attachmentTitle("loop.GIF")).toContain("first frame");
  });
});
