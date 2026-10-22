import { sampleDoc, type Op } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { cancelPendingDecisions } from "./decisions";
import { runClaims } from "./run-claims";
import { clearRuns } from "./run-registry";
import { emptySession } from "./sessions/session-model";
import { emptyBridge, useAgentStore, visibleSession, type SessionLive } from "./use-agent-store";

/** Fresh document + agent state for each test: one visible session with a running "run-test". */
export const resetStores = () => {
  cancelPendingDecisions();
  clearRuns();
  runClaims.clear();
  useDocumentStore.getState().load(sampleDoc);
  const session = emptySession();
  const agent = useAgentStore.getState();
  agent.resetSessions(session);
  agent.beginRun(session.id, "run-test", "prompt");
  agent.patchSession(session.id, { status: "running" });
  agent.set({ bridge: emptyBridge() });
};

/** The session shown in the panel (the single-run fields tests read). */
export const visible = (): SessionLive => visibleSession(useAgentStore.getState());

let nodeSeq = 0;
/** An insert op for a small rectangle under frame-1. */
export const insertRect = (): Op => ({
  op: "insert",
  parentId: "frame-1",
  node: {
    type: "rectangle",
    id: `rect-test-${++nodeSeq}`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  } as Extract<Op, { op: "insert" }>["node"],
});
