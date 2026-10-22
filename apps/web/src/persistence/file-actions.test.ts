/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { asProjectDocument } from "./file-actions";

describe("asProjectDocument", () => {
  test("keeps the content and takes the project's name", () => {
    const doc = asProjectDocument(sampleDoc, "Hotel");
    expect(doc.name).toBe("Hotel");
    expect(doc.children).toBe(sampleDoc.children);
    expect(doc.id).toBe(sampleDoc.id);
  });
});
