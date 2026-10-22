import type { AgentAdapter } from "./types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "Codex support is not implemented yet" });
  },
};
