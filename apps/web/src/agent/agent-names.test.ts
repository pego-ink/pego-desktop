/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  AGENT_NAME_COUNT,
  AGENT_NAME_SET_IDS,
  AGENT_NAME_SETS,
  agentNameAt,
  agentNames,
  DEFAULT_CUSTOM_AGENT_NAMES,
  isAgentNameSet,
  MAX_AGENT_NAME_LENGTH,
  normalizeCustomNames,
} from "./agent-names";
import { RUN_COLORS } from "./run-colors";

describe("agent names", () => {
  test("every set has one distinct name per color slot (except Pego, all Pego)", () => {
    expect(RUN_COLORS).toHaveLength(AGENT_NAME_COUNT);
    for (const [id, set] of Object.entries(AGENT_NAME_SETS)) {
      expect(set.names).toHaveLength(AGENT_NAME_COUNT);
      expect(new Set(set.names).size).toBe(id === "pego" ? 1 : AGENT_NAME_COUNT);
    }
  });

  test("an agent's name follows its color slot, wrapping past the last one", () => {
    expect(agentNameAt(0, "pego", [])).toBe("Pego");
    expect(agentNameAt(0, "inventors", [])).toBe("Tesla");
    expect(agentNameAt(1, "inventors", [])).toBe("Gutenberg");
    expect(agentNameAt(AGENT_NAME_COUNT, "inventors", [])).toBe("Tesla");
  });

  test("custom names: blanks show as Agent N, stored lists are made whole", () => {
    const custom = normalizeCustomNames(["Ayu", "  ", 7]);
    expect(custom).toHaveLength(AGENT_NAME_COUNT);
    expect(custom.slice(0, 3)).toEqual(["Ayu", "  ", "Agent 3"]);
    expect(agentNames("custom", custom).slice(0, 3)).toEqual(["Ayu", "Agent 2", "Agent 3"]);
    expect(agentNameAt(0, "custom", custom)).toBe("Ayu");
    expect(normalizeCustomNames(["x".repeat(99)])[0]).toHaveLength(MAX_AGENT_NAME_LENGTH);
    expect(normalizeCustomNames("nope")).toEqual([...DEFAULT_CUSTOM_AGENT_NAMES]);
  });

  test("set ids are checked before use", () => {
    expect(AGENT_NAME_SET_IDS).toContain("custom");
    expect(isAgentNameSet("artists")).toBe(true);
    expect(isAgentNameSet("wizards")).toBe(false);
    expect(isAgentNameSet(3)).toBe(false);
  });
});
