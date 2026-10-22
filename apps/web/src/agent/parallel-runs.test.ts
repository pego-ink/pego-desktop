/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { cancelPendingDecisions, RunCancelledError } from "./decisions";
import { createFocusGroupsSelector, focusGroupsOf, focusLabel } from "./focus-groups";
import { pickColorIndex, runColor, RUN_COLORS } from "./run-colors";
import { registerRun, startBlock, unregisterRun } from "./run-registry";
import { emptySession } from "./sessions/session-model";
import { insertRect, resetStores, visible } from "./test-utils";
import { createToolHost } from "./tool-host";
import { runScope, selectRunsActive, useAgentStore } from "./use-agent-store";

const agent = () => useAgentStore.getState();

/** Begin and register a run in a session (backend "api": no bridge involved). */
const startIn = (sessionId: string, runId: string, prompt = runId) => {
  agent().beginRun(sessionId, runId, prompt);
  runScope(runId).appendLog({ kind: "user", text: prompt });
  const host = createToolHost({ runId });
  registerRun({
    id: runId,
    sessionId,
    backend: "api",
    controller: new AbortController(),
    host,
    styleId: undefined,
  });
  return host;
};

/** resetStores' visible session ("run-test" running) plus a second, background one. */
const twoSessions = () => {
  const background = agent().visibleSessionId;
  unregisterRun("run-test");
  const bgHost = startIn(background, "bg", "Landing page");
  agent().showSession(emptySession("front"));
  const fgHost = startIn("front", "fg", "Pricing table");
  return { background, bgHost, fgHost };
};

beforeEach(resetStores);

describe("run colors", () => {
  test("lowest free slot, repeating once all are taken", () => {
    expect(pickColorIndex([])).toBe(0);
    expect(pickColorIndex([0, 2])).toBe(1);
    expect(pickColorIndex([0, 1, 2, 3], 4)).toBe(0);
    expect(runColor(RUN_COLORS.length)).toBe(RUN_COLORS[0]);
  });
});

describe("startBlock", () => {
  test("one run per session, at most the configured number in total", () => {
    expect(startBlock([], "a", 3)).toBeNull();
    expect(startBlock([{ sessionId: "a" }], "a", 3)?.reason).toBe("session_busy");
    expect(startBlock([{ sessionId: "a" }, { sessionId: "b" }], "c", 2)?.reason).toBe(
      "too_many_runs",
    );
    expect(startBlock([{ sessionId: "a" }], "c", 2)).toBeNull();
  });
});

describe("per-session live state", () => {
  test("each run writes into its own session; the hidden one stays in memory", () => {
    const { background } = twoSessions();
    runScope("bg").appendLog({ kind: "assistant", text: "hero done" });
    expect(agent().liveSessions[background]?.log.map((l) => l.text)).toEqual([
      "Landing page",
      "hero done",
    ]);
    expect(visible().log.map((l) => l.text)).toEqual(["Pricing table"]);
    expect(selectRunsActive(agent())).toBe(2);
  });

  test("running sessions get different colors", () => {
    const { background } = twoSessions();
    expect(agent().liveSessions[background]?.colorIndex).not.toBe(visible().colorIndex);
  });

  test("leaving an idle session drops it, leaving a running one keeps it", () => {
    const first = agent().visibleSessionId;
    agent().patchSession(first, { status: "done" });
    agent().showSession(emptySession("second"));
    expect(agent().liveSessions[first]).toBeUndefined();

    agent().beginRun("second", "r2", "p");
    agent().showSession(emptySession("third"));
    expect(agent().liveSessions.second?.status).toBe("planning");
  });

  test("a scope of an unknown run writes nowhere", () => {
    const before = agent().liveSessions;
    runScope("ghost").appendLog({ kind: "info", text: "lost" });
    expect(agent().liveSessions).toBe(before);
  });
});

describe("focus groups", () => {
  test("one tinted, labelled group per running session that touches nodes", () => {
    const { background } = twoSessions();
    runScope("bg").set({ focusIds: ["rect-1"] });
    runScope("fg").set({ focusIds: ["text-1"] });
    const groups = focusGroupsOf(agent().liveSessions);
    expect(groups.map((g) => [g.key, g.ids, g.label])).toEqual([
      ["bg", ["rect-1"], "Landing page"],
      ["fg", ["text-1"], "Pricing table"],
    ]);
    expect(groups[0]?.color).toBe(runColor(agent().liveSessions[background]!.colorIndex));
    expect(groups[0]?.color).not.toBe(groups[1]?.color);
  });

  test("the selector keeps its array while only the log changes", () => {
    twoSessions();
    runScope("bg").set({ focusIds: ["rect-1"] });
    const select = createFocusGroupsSelector();
    const first = select(agent());
    runScope("bg").appendLog({ kind: "assistant", text: "more" });
    expect(select(agent())).toBe(first);
    runScope("bg").set({ focusIds: ["text-1"] });
    expect(select(agent())).not.toBe(first);
  });

  test("labels are cut to one short line", () => {
    expect(focusLabel("A very long session title that goes on", 12)).toBe("A very long…");
  });
});

describe("tool host across runs", () => {
  test("a run's edits carry its id and claim nodes against other runs", async () => {
    const { bgHost, fgHost } = twoSessions();
    bgHost.applyOps([{ op: "update", id: "rect-1", props: { x: 10 } }]);
    expect(useDocumentStore.getState().history.past.at(-1)?.runId).toBe("bg");

    const before = useDocumentStore.getState().doc;
    expect(() => fgHost.applyOps([{ op: "update", id: "rect-1", props: { x: 20 } }])).toThrow(
      /Landing page/,
    );
    expect(useDocumentStore.getState().doc).toBe(before);
    // Other layers stay open, and the claim ends with the run.
    fgHost.applyOps([insertRect()]);
    unregisterRun("bg");
    fgHost.applyOps([{ op: "update", id: "rect-1", props: { x: 30 } }]);
    expect(useDocumentStore.getState().history.past.at(-1)?.runId).toBe("fg");
  });

  test("the claim surfaces as a coded node_claimed tool error", async () => {
    const { bgHost, fgHost } = twoSessions();
    bgHost.applyOps([{ op: "update", id: "rect-1", props: { x: 10 } }]);
    const { toolByName } = await import("@pego/agent");
    const result = await toolByName("update_node")!.run({ id: "rect-1", props: { x: 5 } }, fgHost);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error.code).toBe("node_claimed");
  });

  test("only the visible session's run moves the selection and camera", () => {
    useViewportStore.setState({ size: { width: 1000, height: 800 } });
    const { bgHost, fgHost } = twoSessions();
    const camera = useViewportStore.getState().camera;
    bgHost.setSelection?.(["rect-1"]);
    bgHost.focusViewport?.(["rect-1"]);
    expect(useDocumentStore.getState().selection).toEqual([]);
    expect(useViewportStore.getState().camera).toBe(camera);

    fgHost.setSelection?.(["rect-1"]);
    expect(useDocumentStore.getState().selection).toEqual(["rect-1"]);
  });
});

describe("decisions per run", () => {
  test("each session shows its own card; cancelling one run keeps the other's", async () => {
    const { background, bgHost, fgHost } = twoSessions();
    const bgAnswer = bgHost.askUser({ question: "Dark?", options: ["yes"] });
    const fgAnswer = fgHost.askUser({ question: "Wide?", options: ["yes"] });
    expect(agent().liveSessions[background]?.decision?.question).toBe("Dark?");
    expect(visible().decision?.question).toBe("Wide?");

    cancelPendingDecisions("bg");
    await expect(bgAnswer).rejects.toBeInstanceOf(RunCancelledError);
    expect(agent().liveSessions[background]?.decision).toBeNull();
    expect(visible().decision?.question).toBe("Wide?");
    cancelPendingDecisions();
    await expect(fgAnswer).rejects.toBeInstanceOf(RunCancelledError);
  });
});

describe("pages and background runs", () => {
  const addPage = (id: string) =>
    useDocumentStore.getState().commit([
      {
        op: "insert",
        parentId: null,
        node: { type: "page", id, name: id, x: 0, y: 0, children: [] },
      },
    ]);

  test("a background run switches its own page, not the one the user sees", () => {
    const { bgHost, fgHost } = twoSessions();
    addPage("page-2");
    bgHost.setActivePage?.("page-2");
    expect(useDocumentStore.getState().pageId).not.toBe("page-2");
    expect(bgHost.getActivePageId?.()).toBe("page-2");
    expect(fgHost.getActivePageId?.()).toBe("page-1");
  });

  test("the run in the panel shows the page it switches to", () => {
    const { fgHost } = twoSessions();
    addPage("page-2");
    fgHost.setActivePage?.("page-2");
    expect(useDocumentStore.getState().pageId).toBe("page-2");
    expect(fgHost.getActivePageId?.()).toBe("page-2");
  });
});
