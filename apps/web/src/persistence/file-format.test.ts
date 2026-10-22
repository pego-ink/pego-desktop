/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { documentSchema } from "@pego/doc";
import { showcaseDoc } from "../dev/showcase-doc";
import {
  createEmptyDocument,
  FileFormatError,
  isDirty,
  parseDocumentFile,
  serializeDocument,
} from "./file-format";

describe("file format", () => {
  test("round trips the showcase doc", () => {
    const text = serializeDocument(showcaseDoc);
    expect(JSON.parse(text)).toMatchObject({ format: "pego", version: 3 });
    expect(parseDocumentFile(text)).toEqual(documentSchema.parse(showcaseDoc));
  });

  test("rejects bad JSON", () => {
    expect(() => parseDocumentFile("{nope")).toThrow(/not valid JSON/);
  });

  test("rejects wrong format and version", () => {
    expect(() => parseDocumentFile(JSON.stringify({ format: "x" }))).toThrow(FileFormatError);
    const newer = JSON.stringify({ format: "pego", version: 9, document: {} });
    expect(() => parseDocumentFile(newer)).toThrow(/newer Pego \(file version 9/);
    const bogus = JSON.stringify({ format: "pego", version: "1", document: {} });
    expect(() => parseDocumentFile(bogus)).toThrow(/Unsupported Pego file version "1"/);
  });

  test("opens version 0 files by migrating them", () => {
    const text = JSON.stringify({
      format: "pego",
      version: 0,
      document: {
        version: 0,
        id: "d",
        name: "Old",
        children: [{ type: "rectangle", id: "r", width: 10, height: 10, fill: "#fff" }],
      },
    });
    const doc = parseDocumentFile(text);
    expect(doc.version).toBe(3);
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]).toMatchObject({ type: "page", name: "Page 1" });
    expect(doc.children[0]!.children[0]).toMatchObject({
      id: "r",
      type: "rectangle",
      fill: "#fff",
    });
  });

  test("rejects schema errors with the first issues", () => {
    const text = JSON.stringify({
      format: "pego",
      version: 0,
      document: { version: 0, id: "", name: 1, children: "x" },
    });
    expect(() => parseDocumentFile(text)).toThrow(/Invalid Pego document: .*id/);
  });

  test("empty document has one 1440x1024 white frame", () => {
    const doc = createEmptyDocument();
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]).toMatchObject({ type: "page", name: "Page 1" });
    expect(doc.children[0]!.children).toHaveLength(1);
    expect(doc.children[0]!.children[0]).toMatchObject({
      type: "frame",
      name: "Frame",
      width: 1440,
      height: 1024,
      fill: "#FFFFFF",
    });
  });

  test("dirty is object identity against the saved doc", () => {
    const doc = createEmptyDocument();
    expect(isDirty(doc, doc)).toBe(false);
    expect(isDirty({ ...doc }, doc)).toBe(true);
    expect(isDirty(doc, null)).toBe(true);
  });
});
