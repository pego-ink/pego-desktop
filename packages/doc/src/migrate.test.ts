import { describe, expect, test } from "bun:test";
import { loadDocument, MigrationError, migrateDocument } from "./migrate";
import { DOCUMENT_VERSION } from "./schema";

const v0 = { version: 0, id: "d", name: "Old", children: [{ type: "ellipse", id: "e" }] };

describe("migrateDocument", () => {
  test("upgrades version 0 to the current version", () => {
    expect(migrateDocument(v0)).toMatchObject({ version: DOCUMENT_VERSION, id: "d" });
  });

  test("upgrades version 3 documents and keeps their v4 props", () => {
    const v3 = {
      version: 3,
      id: "d",
      name: "V3",
      children: [
        { type: "page", id: "p", children: [{ type: "ellipse", id: "e", visible: false }] },
      ],
    };
    expect(migrateDocument(v3)).toMatchObject({ version: DOCUMENT_VERSION });
    expect(loadDocument(v3)?.children[0]?.children[0]).toMatchObject({ visible: false });
  });

  test("upgrades version 4 documents to 5 and accepts flipX / flipY", () => {
    const v4 = {
      version: 4,
      id: "d",
      name: "V4",
      children: [
        {
          type: "page",
          id: "p",
          children: [{ type: "ellipse", id: "e", flipX: true, flipY: true }],
        },
      ],
    };
    expect(migrateDocument(v4)).toMatchObject({ version: 5 });
    expect(loadDocument(v4)?.children[0]?.children[0]).toMatchObject({ flipX: true, flipY: true });
  });

  test("leaves current documents unchanged", () => {
    const current = { ...v0, version: DOCUMENT_VERSION };
    expect(migrateDocument(current)).toBe(current);
  });

  test("rejects newer, unknown and non-object input", () => {
    const codes = [{ ...v0, version: DOCUMENT_VERSION + 1 }, { ...v0, version: "0" }, [], null].map(
      (raw) => {
        try {
          migrateDocument(raw);
          return "ok";
        } catch (error) {
          return error instanceof MigrationError ? error.code : "other";
        }
      },
    );
    expect(codes).toEqual(["newer_version", "unknown_version", "not_a_document", "not_a_document"]);
  });
});

describe("loadDocument", () => {
  test("migrates and validates", () => {
    expect(loadDocument(v0)?.version).toBe(DOCUMENT_VERSION);
  });

  test("returns null for invalid documents", () => {
    expect(loadDocument({ ...v0, children: [{ type: "nope" }] })).toBeNull();
    expect(loadDocument({ ...v0, version: 99 })).toBeNull();
  });
});

describe("version 2 (pages)", () => {
  test("old top-level nodes become one page", () => {
    const doc = loadDocument(v0);
    expect(doc?.children).toHaveLength(1);
    expect(doc?.children[0]).toMatchObject({ type: "page", id: "page-1", name: "Page 1" });
    expect(doc?.children[0]?.children[0]).toMatchObject({ type: "ellipse", id: "e" });
  });

  test("the page id never clashes with an existing node id", () => {
    const clash = { ...v0, version: 1, children: [{ type: "ellipse", id: "page-1" }] };
    expect(loadDocument(clash)?.children[0]?.id).toBe("page-1-2");
  });
});

describe("version 3 (image nodes, path markers, font style)", () => {
  test("a version 2 document with pages keeps its content", () => {
    const v2 = {
      version: 2,
      id: "d",
      name: "Pages",
      children: [
        { type: "page", id: "p", name: "Page 1", children: [{ type: "ellipse", id: "e" }] },
      ],
    };
    const doc = loadDocument(v2);
    expect(doc?.version).toBe(DOCUMENT_VERSION);
    expect(doc?.children[0]?.children[0]).toMatchObject({ type: "ellipse", id: "e" });
  });

  test("image nodes, path markers and italic text validate", () => {
    const doc = loadDocument({
      ...v0,
      children: [
        { type: "image", id: "i", src: "https://example.com/a.png", fit: "fit" },
        { type: "path", id: "p", geometry: "M0 0L10 10", endMarker: "arrow", strokeCap: "round" },
        { type: "text", id: "t", content: "Hi", fontStyle: "italic" },
      ],
    });
    expect(doc?.children[0]?.children.map((node) => node.type)).toEqual(["image", "path", "text"]);
  });
});
