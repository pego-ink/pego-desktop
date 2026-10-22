/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc } from "@pego/doc";
import { selectionContext, withSelectionContext } from "./selection-context";

describe("selection context", () => {
  test("names the selected layers and scopes the request to them", () => {
    const context = selectionContext(sampleDoc, ["frame-1", "missing"]);
    expect(context).toStartWith("The user selected this layer on the canvas.");
    expect(context).toContain("- frame-1:");
    expect(context).not.toContain("missing");
    expect(withSelectionContext("make it green", context)).toEndWith("\n\nRequest: make it green");
  });

  test("no selection leaves the prompt as it is", () => {
    expect(selectionContext(sampleDoc, [])).toBe("");
    expect(withSelectionContext("make a landing page", "")).toBe("make a landing page");
  });
});
