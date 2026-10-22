import type { AgentAdapter } from "./types";

export const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  name: "opencode",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "opencode support is not implemented yet" });
  },
};
