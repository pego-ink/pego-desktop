import type { AgentAdapter } from "./types";

/** Claude Code via the Claude Agent SDK (to be moved here from ../runs.ts). */
export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  name: "Claude Code",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "Claude Code adapter is not implemented yet" });
  },
};
