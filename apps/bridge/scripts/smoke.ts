/**
 * Tiny end-to-end check of one local agent against a fake editor:
 *   bun run scripts/smoke.ts <agentId> [model]
 * Starts the real bridge on a free port, answers tool calls with a canned empty document, and
 * passes when a tool call arrives with source `run` and the run ends with `done`.
 */
import {
  BRIDGE_PROTOCOL_VERSION,
  LOCAL_AGENT_IDS,
  type BridgeToEditor,
  type EditorToBridge,
  type LocalAgentId,
} from "@pego/agent";
import { startBridge } from "../src/server";

const agentId = process.argv[2] as LocalAgentId | undefined;
const model = process.argv[3];
if (!agentId || !LOCAL_AGENT_IDS.includes(agentId)) {
  console.error(`usage: smoke.ts <${LOCAL_AGENT_IDS.join("|")}> [model]`);
  process.exit(2);
}

const bridge = startBridge({
  port: 0,
  allowedOrigins: null,
  toolTimeoutMs: 60_000,
  log: console.log,
});
const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/editor`, {
  headers: { Origin: "http://localhost:5173" },
} as never);
const send = (message: EditorToBridge) => ws.send(JSON.stringify(message));

const toolCalls: Array<{ tool: string; source: unknown }> = [];
let outcome: "done" | "error" | "timeout" = "timeout";
let errorMessage = "";

const finish = async (code: number) => {
  console.log(JSON.stringify({ agentId, model, toolCalls, outcome, errorMessage }, null, 2));
  bridge.stop();
  // Let the run clean up (child process tree, temp workdir) before exiting.
  await bridge.runs.whenIdle();
  process.exit(code);
};
setTimeout(() => void finish(1), 180_000);

ws.addEventListener("open", () =>
  send({ type: "hello", protocol: BRIDGE_PROTOCOL_VERSION, documentName: "smoke" }),
);
ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as BridgeToEditor;
  if (message.type === "welcome") {
    const info = message.agents.find((a) => a.id === agentId);
    console.log("detected:", JSON.stringify(info));
    if (!info?.installed) void finish(1);
    send({
      type: "run_start",
      runId: "smoke-1",
      prompt: "Call get_document once, then reply DONE.",
      agentId,
      ...(model ? { model } : {}),
    });
  } else if (message.type === "tool_call") {
    toolCalls.push({ tool: message.tool, source: message.source });
    send({
      type: "tool_result",
      callId: message.callId,
      content: JSON.stringify({ name: "smoke", children: [] }),
      isError: false,
    });
  } else if (message.type === "run_event") {
    console.log("event:", JSON.stringify(message.event));
    if (message.event.kind === "done" || message.event.kind === "error") {
      outcome = message.event.kind;
      if (message.event.kind === "error") errorMessage = message.event.message;
      const ok =
        outcome === "done" && toolCalls.some((c) => (c.source as { kind?: string }).kind === "run");
      void finish(ok ? 0 : 1);
    }
  }
});
