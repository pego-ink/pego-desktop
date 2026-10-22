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
    expect(JSON.parse(text)).toMatchObject({ format: "pego", version: 0 });
    expect(parseDocumentFile(text)).toEqual(documentSchema.parse(showcaseDoc));
  });

  test("rejects bad JSON", () => {
    expect(() => parseDocumentFile("{nope")).toThrow(/not valid JSON/);
  });

  test("rejects wrong format and version", () => {
    expect(() => parseDocumentFile(JSON.stringify({ format: "x" }))).toThrow(FileFormatError);
    const wrongVersion = JSON.stringify({ format: "pego", version: 9, document: {} });
    expect(() => parseDocumentFile(wrongVersion)).toThrow(/version 9/);
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
    expect(doc.children[0]).toMatchObject({
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
