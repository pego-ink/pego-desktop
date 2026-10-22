import { LOCAL_AGENT_IDS, type LocalAgentId, type LocalAgentInfo } from "@pego/agent";

/** Which engine runs the panel's agent. `local` goes through the bridge to a local agent CLI. */
export type AgentBackend = "api" | "local";

export const DEFAULT_LOCAL_AGENT: LocalAgentId = "claude-code";

export type AgentPrefs = {
  backend: AgentBackend;
  localAgentId: LocalAgentId;
  /** Selected model per local agent; a missing key means the CLI's default. */
  modelByAgent: Partial<Record<LocalAgentId, string>>;
  /** The user picked the backend/agent themselves; until then Pego picks a ready local agent. */
  explicit: boolean;
};

export const AGENT_PREFS_KEY = "pego.agent.prefs.v1";

export const defaultAgentPrefs = (): AgentPrefs => ({
  backend: "local",
  localAgentId: DEFAULT_LOCAL_AGENT,
  modelByAgent: {},
  explicit: false,
});

/**
 * The local agent to use when the user has not chosen one: the first ready agent (installed,
 * nothing to fix) in display order, else the first installed one. Null when none is installed.
 */
export const pickDefaultAgent = (agents: readonly LocalAgentInfo[]): LocalAgentId | null =>
  (agents.find((agent) => agent.installed && !agent.note) ?? agents.find((a) => a.installed))?.id ??
  null;

export const isLocalAgentId = (value: unknown): value is LocalAgentId =>
  typeof value === "string" && (LOCAL_AGENT_IDS as readonly string[]).includes(value);

/** Storage may be missing or throw (private mode, blocked site data): treat that as "none". */
const defaultStorage = (): Pick<Storage, "getItem" | "setItem"> | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Shape-check persisted prefs; anything invalid falls back to the default for that field. */
export const parseAgentPrefs = (raw: string | null): AgentPrefs => {
  const prefs = defaultAgentPrefs();
  if (!raw) return prefs;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (typeof value !== "object" || value === null) return prefs;
  const record = value as Record<string, unknown>;
  prefs.explicit = record.explicit === true;
  // Before `explicit` existed every save was an explicit pick, except the untouched "api" default.
  if (record.explicit === undefined && record.backend === "local") prefs.explicit = true;
  if (prefs.explicit && (record.backend === "api" || record.backend === "local")) {
    prefs.backend = record.backend;
  }
  if (prefs.explicit && isLocalAgentId(record.localAgentId))
    prefs.localAgentId = record.localAgentId;
  if (typeof record.modelByAgent === "object" && record.modelByAgent !== null) {
    for (const [id, model] of Object.entries(record.modelByAgent)) {
      if (isLocalAgentId(id) && typeof model === "string" && model.trim()) {
        prefs.modelByAgent[id] = model;
      }
    }
  }
  return prefs;
};

export const loadAgentPrefs = (storage = defaultStorage()): AgentPrefs => {
  try {
    return parseAgentPrefs(storage?.getItem(AGENT_PREFS_KEY) ?? null);
  } catch {
    return defaultAgentPrefs();
  }
};

export const saveAgentPrefs = (prefs: AgentPrefs, storage = defaultStorage()): void => {
  try {
    storage?.setItem(AGENT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Persistence is best effort.
  }
};
