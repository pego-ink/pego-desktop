import { sampleDoc, type Op } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { cancelPendingDecisions } from "./decisions";
import { setActiveRun, setRunTail } from "./active-run";
import { useAgentStore } from "./use-agent-store";

/** Fresh document + agent state for each test. */
export const resetStores = () => {
  cancelPendingDecisions();
  setActiveRun(null);
  setRunTail(null);
  useDocumentStore.getState().load(sampleDoc);
  useAgentStore.getState().beginRun("run-test", "prompt");
  useAgentStore.getState().set({
    status: "running",
    bridge: { connected: false, claudeCodeAvailable: false, mcpUrl: null },
  });
};

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
