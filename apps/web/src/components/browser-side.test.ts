import { describe, expect, test } from "bun:test";
import { moveBrowser, openPanel, pressPanel, type PanelsState } from "./rail-state";

const agentOpen: PanelsState = { rail: { tab: "agent", open: true }, browserOpen: false };

describe("browser on the left", () => {
  test("its icon is a side panel tab like the others", () => {
    expect(pressPanel(agentOpen, "left", "browser")).toEqual({
      rail: { tab: "browser", open: true },
      browserOpen: false,
    });
    expect(openPanel(agentOpen, "left", "browser").rail).toEqual({ tab: "browser", open: true });
  });
});

describe("browser on the right", () => {
  test("its icon toggles the right column and keeps the side panel", () => {
    const opened = pressPanel(agentOpen, "right", "browser");
    expect(opened).toEqual({ rail: { tab: "agent", open: true }, browserOpen: true });
    expect(pressPanel(opened, "right", "browser").browserOpen).toBe(false);
    // Other icons still drive the side panel, the column stays.
    expect(pressPanel(opened, "right", "layers")).toEqual({
      rail: { tab: "layers", open: true },
      browserOpen: true,
    });
  });

  test("opening it (the agent's browser tools) never closes it", () => {
    const opened = openPanel(agentOpen, "right", "browser");
    expect(openPanel(opened, "right", "browser")).toEqual(opened);
  });
});

describe("moving the browser", () => {
  test("to the right: a side panel showing it hands it to the column", () => {
    const shown: PanelsState = { rail: { tab: "browser", open: true }, browserOpen: false };
    expect(moveBrowser(shown, "right")).toEqual({
      rail: { tab: "agent", open: true },
      browserOpen: true,
    });
    expect(moveBrowser(agentOpen, "right")).toBe(agentOpen);
  });

  test("to the left: an open column becomes the side panel's tab", () => {
    const column: PanelsState = { rail: { tab: "layers", open: false }, browserOpen: true };
    expect(moveBrowser(column, "left")).toEqual({
      rail: { tab: "browser", open: true },
      browserOpen: false,
    });
    expect(moveBrowser(agentOpen, "left")).toBe(agentOpen);
  });
});
