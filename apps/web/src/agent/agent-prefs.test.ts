/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { AGENT_PREFS_KEY, loadAgentPrefs, parseAgentPrefs, saveAgentPrefs } from "./agent-prefs";

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe("custom provider prefs", () => {
  test("a custom selection round-trips through storage", () => {
    const storage = memoryStorage();
    saveAgentPrefs(
      {
        backend: "custom",
        localAgentId: "claude-code",
        modelByAgent: {},
        customProviderId: "prov-1",
        explicit: true,
      },
      storage,
    );
    expect(JSON.parse(storage.getItem(AGENT_PREFS_KEY) ?? "{}").customProviderId).toBe("prov-1");
    expect(loadAgentPrefs(storage)).toMatchObject({
      backend: "custom",
      customProviderId: "prov-1",
      explicit: true,
    });
  });

  test('backend "custom" without a provider id falls back to the default backend', () => {
    expect(parseAgentPrefs(JSON.stringify({ backend: "custom", explicit: true }))).toMatchObject({
      backend: "local",
      customProviderId: null,
    });
    expect(
      parseAgentPrefs(
        JSON.stringify({ backend: "custom", customProviderId: "  ", explicit: true }),
      ),
    ).toMatchObject({ backend: "local", customProviderId: null });
  });

  test("a non-explicit pick is ignored, and a wrongly typed id is dropped", () => {
    expect(
      parseAgentPrefs(
        JSON.stringify({ backend: "custom", customProviderId: "prov-1", explicit: false }),
      ).backend,
    ).toBe("local");
    expect(
      parseAgentPrefs(JSON.stringify({ backend: "local", customProviderId: 7, explicit: true }))
        .customProviderId,
    ).toBeNull();
  });

  test("the id is kept while another backend is active (so switching back works)", () => {
    expect(
      parseAgentPrefs(
        JSON.stringify({ backend: "local", customProviderId: "prov-1", explicit: true }),
      ),
    ).toMatchObject({ backend: "local", customProviderId: "prov-1" });
  });
});
