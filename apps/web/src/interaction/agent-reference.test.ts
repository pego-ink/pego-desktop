/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { formatAgentReference } from "./agent-reference";

const nodes = [
  { id: "eAKGj", type: "frame" as const, name: "Header" },
  { id: "yL6kT", type: "text" as const },
];

describe("formatAgentReference", () => {
  test("names the project, its file and every node id", () => {
    expect(
      formatAgentReference({
        project: { id: "vwijndor", name: "Hotel Booking" },
        file: "/home/me/Documents/Pego/hotel-booking/project.pego",
        documentName: "Hotel Booking",
        nodes,
      }),
    ).toBe(
      [
        "Pego project: Hotel Booking (id vwijndor)",
        "File: /home/me/Documents/Pego/hotel-booking/project.pego",
        "Node IDs: eAKGj, yL6kT",
        "Nodes:",
        "- eAKGj: Header (frame)",
        "- yL6kT: (unnamed) (text)",
        'With the pego MCP tools: pass project "vwijndor" to every tool call (no need to open it in the window), then edit these nodes by id.',
      ].join("\n"),
    );
  });

  test("outside a project it points at the file, or at the shown document", () => {
    const onDisk = formatAgentReference({
      project: null,
      file: "/tmp/a.pego",
      documentName: "A",
      nodes: [{ id: "x1", type: "rectangle" }],
    });
    expect(onDisk.split("\n")).toEqual([
      "Pego document: A (not in a project)",
      "File: /tmp/a.pego",
      "Node IDs: x1",
      'With the pego MCP tools: open_document "/tmp/a.pego" first, then edit these nodes by id.',
    ]);
    const unsaved = formatAgentReference({
      project: null,
      file: "a.pego",
      documentName: "Untitled",
      nodes: [{ id: "x1", type: "rectangle" }],
    });
    expect(unsaved).toContain("the document shown in the Pego editor");
  });

  test("lists at most 40 nodes by name but every id", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      id: `n${i}`,
      type: "rectangle" as const,
    }));
    const lines = formatAgentReference({
      project: null,
      file: null,
      documentName: "A",
      nodes: many,
    }).split("\n");
    expect(lines[1]?.split(", ")).toHaveLength(45);
    expect(lines).toContain("- ... and 5 more");
    expect(lines.filter((line) => line.startsWith("- n"))).toHaveLength(40);
  });
});
