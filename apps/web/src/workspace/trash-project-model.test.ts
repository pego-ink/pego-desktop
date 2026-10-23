import { describe, expect, test } from "bun:test";
import {
  tabToClose,
  trashConfirmText,
  trashedMessage,
  trashFailedMessage,
} from "./trash-project-model";

describe("trash project model", () => {
  test("closes only the project's own tab", () => {
    const tabs = [
      { id: "a1", kind: "local" as const },
      { id: "p1", kind: "project" as const },
    ];
    expect(tabToClose(tabs, "p1")).toBe("p1");
    expect(tabToClose(tabs, "a1")).toBeNull();
    expect(tabToClose(tabs, "zzz")).toBeNull();
    expect(tabToClose([], "p1")).toBeNull();
  });

  test("texts", () => {
    expect(trashConfirmText({ name: "Checkout", relativeDir: "checkout-2" })).toEqual({
      title: "Move “Checkout” to the Trash?",
      folder: "design/checkout-2",
      hint: "You can restore it from the Trash.",
      cancel: "Cancel",
      confirm: "Move to Trash",
    });
    expect(trashedMessage("Checkout")).toBe("Moved “Checkout” to the Trash");
    expect(trashFailedMessage("Checkout", "bridge offline")).toBe(
      "Could not move “Checkout” to the Trash: bridge offline",
    );
  });
});
