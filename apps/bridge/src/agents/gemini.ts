import type { AgentAdapter } from "./types";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  name: "Gemini CLI",
  supportsModels: false,
  detect: async () => ({ installed: false, note: "Not implemented yet" }),
  run: async (ctx) => {
    ctx.emit({ kind: "error", message: "Gemini CLI support is not implemented yet" });
  },
};
