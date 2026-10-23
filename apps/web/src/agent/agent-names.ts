/** Names per set: one per palette slot (agent/run-colors), in the order agents take them. */
export const AGENT_NAME_COUNT = 10;

/** Longest custom name kept (the cursor pill stays short). */
export const MAX_AGENT_NAME_LENGTH = 24;

/**
 * The built-in name sets for agents working on the canvas. "pego" (the default) calls every agent
 * Pego, so runs are told apart by color alone.
 */
export const AGENT_NAME_SETS = {
  pego: { label: "Pego", names: Array.from({ length: AGENT_NAME_COUNT }, () => "Pego") },
  artists: {
    label: "Artists",
    names: [
      "Vermeer",
      "Hokusai",
      "Klimt",
      "Matisse",
      "Kahlo",
      "Turner",
      "Cézanne",
      "Basquiat",
      "O'Keeffe",
      "Magritte",
    ],
  },
  philosophers: {
    label: "Philosophers",
    names: [
      "Socrates",
      "Aristotle",
      "Confucius",
      "Descartes",
      "Hume",
      "Arendt",
      "Avicenna",
      "Beauvoir",
      "Nietzsche",
      "Locke",
    ],
  },
  inventors: {
    label: "Inventors",
    names: [
      "Tesla",
      "Gutenberg",
      "Franklin",
      "Lamarr",
      "Babbage",
      "Hopper",
      "Bell",
      "Diesel",
      "Marconi",
      "Wright",
    ],
  },
  mythic: {
    label: "Mythic",
    names: [
      "Merlin",
      "Morgana",
      "Circe",
      "Odin",
      "Thoth",
      "Hermes",
      "Medea",
      "Vivian",
      "Freya",
      "Anansi",
    ],
  },
  scientists: {
    label: "Scientists",
    names: [
      "Darwin",
      "Bohr",
      "Planck",
      "Pasteur",
      "Meitner",
      "Feynman",
      "Maxwell",
      "Hawking",
      "Mendeleev",
      "Sagan",
    ],
  },
} as const satisfies Record<string, { label: string; names: readonly string[] }>;

export type AgentNameSet = keyof typeof AGENT_NAME_SETS | "custom";

export const AGENT_NAME_SET_IDS = [
  ...(Object.keys(AGENT_NAME_SETS) as (keyof typeof AGENT_NAME_SETS)[]),
  "custom",
] as const satisfies readonly AgentNameSet[];

export const isAgentNameSet = (value: unknown): value is AgentNameSet =>
  typeof value === "string" && (AGENT_NAME_SET_IDS as readonly string[]).includes(value);

/** The stand-in for slot `index` (0-based) of a custom set left blank. */
export const fallbackAgentName = (index: number) => `Agent ${index + 1}`;

export const DEFAULT_CUSTOM_AGENT_NAMES: readonly string[] = Array.from(
  { length: AGENT_NAME_COUNT },
  (_, index) => fallbackAgentName(index),
);

/** `value` cut to MAX_AGENT_NAME_LENGTH characters (code points, so an emoji is never split). */
export const clipAgentName = (value: string): string =>
  Array.from(value).slice(0, MAX_AGENT_NAME_LENGTH).join("");

/** Stored custom names as exactly AGENT_NAME_COUNT strings, each cut to the length limit. */
export const normalizeCustomNames = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: AGENT_NAME_COUNT }, (_, index) => {
    const value = list[index];
    return typeof value === "string"
      ? clipAgentName(value)
      : (DEFAULT_CUSTOM_AGENT_NAMES[index] ?? "");
  });
};

/** The names of `set` in slot order; a blank custom name shows as "Agent N". */
export const agentNames = (set: AgentNameSet, custom: readonly string[]): readonly string[] =>
  set === "custom"
    ? Array.from(
        { length: AGENT_NAME_COUNT },
        (_, index) => custom[index]?.trim() || fallbackAgentName(index),
      )
    : AGENT_NAME_SETS[set].names;

/** The name of the agent in palette slot `index` (its run's color slot). */
export const agentNameAt = (
  index: number,
  set: AgentNameSet,
  custom: readonly string[],
): string => {
  const names = agentNames(set, custom);
  return names[((index % names.length) + names.length) % names.length] ?? "Pego";
};
