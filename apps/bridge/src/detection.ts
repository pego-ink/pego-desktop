import type { LocalAgentId, LocalAgentInfo } from "@pego/agent";
import { agentAdapters } from "./agents/registry";
import { buildChildEnv } from "./agents/env";
import type { AgentAdapter, AgentDetection } from "./agents/types";

export const DETECT_CACHE_TTL_MS = 30_000;
export const DETECT_TIMEOUT_MS = 10_000;
export const MODELS_TIMEOUT_MS = 20_000;

type DetectorOptions = {
  adapters?: AgentAdapter[];
  ttlMs?: number;
  timeoutMs?: number;
  modelsTimeoutMs?: number;
  /** Environment given to adapters (default: derived from the bridge's own). */
  env?: () => Record<string, string>;
  now?: () => number;
};

/**
 * Detects every adapter in parallel, each bounded by a timeout, and caches the answer for a
 * short while so reconnecting editors do not respawn six CLIs. A failing or hanging adapter
 * degrades to `installed: false` with a note; it never blocks the others.
 */
export const createAgentDetector = (options: DetectorOptions = {}) => {
  const adapters = options.adapters ?? agentAdapters;
  const ttlMs = options.ttlMs ?? DETECT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DETECT_TIMEOUT_MS;
  const modelsTimeoutMs = options.modelsTimeoutMs ?? MODELS_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const env = options.env ?? (() => buildChildEnv());

  let cache: { at: number; agents: LocalAgentInfo[] } | undefined;
  let inflight: Promise<LocalAgentInfo[]> | undefined;

  const detectOne = async (adapter: AgentAdapter): Promise<LocalAgentInfo> => {
    const base = {
      id: adapter.id,
      name: adapter.name,
      supportsModels: adapter.supportsModels,
      steer: adapter.steer ?? "restart",
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AgentDetection>((resolve) => {
      timer = setTimeout(
        () => resolve({ installed: false, note: "Detection timed out." }),
        timeoutMs,
      );
    });
    try {
      const detection = await Promise.race([
        Promise.resolve().then(() => adapter.detect(env())),
        timeout,
      ]);
      return { ...base, ...detection };
    } catch {
      return { ...base, installed: false, note: "Detection failed." };
    } finally {
      clearTimeout(timer);
    }
  };

  const detectAll = (force = false): Promise<LocalAgentInfo[]> => {
    if (!force && cache && now() - cache.at < ttlMs) return Promise.resolve(cache.agents);
    if (!force && inflight) return inflight;
    const run = Promise.all(adapters.map(detectOne)).then((agents) => {
      cache = { at: now(), agents };
      return agents;
    });
    inflight = run;
    void run.finally(() => {
      if (inflight === run) inflight = undefined;
    });
    return run;
  };

  const listModels = async (
    agentId: LocalAgentId,
  ): Promise<{ models: string[]; error?: string }> => {
    const adapter = adapters.find((candidate) => candidate.id === agentId);
    if (!adapter) return { models: [], error: `Unknown agent "${agentId}".` };
    if (!adapter.listModels) return { models: [] };
    const list = adapter.listModels;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), modelsTimeoutMs);
    });
    try {
      const models = await Promise.race([list(env()), timeout]);
      if (models === null) return { models: [], error: "Listing models timed out." };
      return { models };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { models: [], error: message.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  };

  return { detectAll, listModels };
};

export type AgentDetector = ReturnType<typeof createAgentDetector>;
