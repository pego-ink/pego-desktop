import type { AgentToolHost } from "../tool-host";
import type { CustomProvider } from "./types";

export type OpenAiRunContext = {
  provider: CustomProvider;
  apiKey: string;
  host: AgentToolHost;
  signal: AbortSignal;
  /** Explicit skill for this run: undefined = auto-detect, null = core only. */
  skillId?: string | null;
};

/**
 * Plan + execute with an OpenAI-compatible Chat Completions API (tools as functions).
 * Same store contract as `runApiAgent`: never throws, ends the run in the agent store.
 * (Stub: implemented by the provider work.)
 */
export const runOpenAiCompatibleAgent = async (
  prompt: string,
  ctx: OpenAiRunContext,
): Promise<void> => {
  void prompt;
  void ctx;
};
