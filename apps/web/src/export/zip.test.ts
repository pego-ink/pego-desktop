/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { crc32, createZip } from "./zip";

const text = (value: string) => new TextEncoder().encode(value);

/** Read a stored ZIP back through its central directory (what unzip tools do). */
const readZip = (zip: Uint8Array) => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: { path: string; data: string; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    const data = new TextDecoder().decode(zip.subarray(dataStart, dataStart + size));
    files.push({ path, data, crc });
    at += 46 + nameLength;
  }
  return files;
};

describe("zip", () => {
  test("crc32 matches the standard checksum", () => {
    expect(crc32(text("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test("files, folders and UTF-8 names come back out as written", () => {
    const zip = createZip([
      { path: "Landing/hero@2x.png", data: text("png bytes") },
      { path: "Menu/kategori-ayam.html", data: text("<main>Ayam pop</main>") },
      { path: "Ayam den lapeh — é.txt", data: text("") },
    ]);
    expect(readZip(zip)).toEqual([
      { path: "Landing/hero@2x.png", data: "png bytes", crc: crc32(text("png bytes")) },
      {
        path: "Menu/kategori-ayam.html",
        data: "<main>Ayam pop</main>",
        crc: crc32(text("<main>Ayam pop</main>")),
      },
      { path: "Ayam den lapeh — é.txt", data: "", crc: 0 },
    ]);
  });

  test("an empty archive is just the end record", () => {
    expect(createZip([])).toHaveLength(22);
  });
});
