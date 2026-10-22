import type { AgentAdapter } from "./types";

export const qwenAdapter: AgentAdapter = {
  id: "qwen",
  name: "Qwen Code",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "Qwen Code support is not implemented yet" });
  },
};
