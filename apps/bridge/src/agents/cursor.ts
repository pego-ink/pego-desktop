import type { AgentAdapter } from "./types";

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  name: "Cursor Agent",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "Cursor Agent support is not implemented yet" });
  },
};
