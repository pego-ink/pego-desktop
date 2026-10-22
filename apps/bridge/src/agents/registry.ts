import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { geminiAdapter } from "./gemini";
import { opencodeAdapter } from "./opencode";
import { qwenAdapter } from "./qwen";
import type { AgentAdapter } from "./types";

/** Every supported local agent CLI, in display order. */
export const agentAdapters: AgentAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  qwenAdapter,
  geminiAdapter,
  cursorAdapter,
];
