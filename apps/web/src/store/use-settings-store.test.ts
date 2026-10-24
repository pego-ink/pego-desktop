import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

const data = new Map<string, string>();
let store: typeof import("./use-settings-store");

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  store = await import("./use-settings-store");
});

beforeEach(() => {
  data.clear();
  store.useSettingsStore.getState().reset();
  data.clear();
});

describe("mergeSettings", () => {
  test("non-objects fall back to defaults", () => {
    expect(store.mergeSettings(null)).toEqual(store.DEFAULT_SETTINGS);
    expect(store.mergeSettings("x")).toEqual(store.DEFAULT_SETTINGS);
  });
  test("partial values merge over defaults", () =>
    expect(store.mergeSettings({ nudgeSmall: 5 })).toEqual({
      ...store.DEFAULT_SETTINGS,
      nudgeSmall: 5,
    }));
  test("invalid values are dropped", () =>
    expect(
      store.mergeSettings({
        nudgeSmall: -1,
        nudgeLarge: "9",
        wheelBehavior: "spin",
        snapToPixel: 1,
      }),
    ).toEqual(store.DEFAULT_SETTINGS));
  test("interface style: docked or floating, anything else falls back to docked", () => {
    expect(store.mergeSettings({ interfaceStyle: "floating" }).interfaceStyle).toBe("floating");
    expect(store.mergeSettings({ interfaceStyle: "compact" }).interfaceStyle).toBe("docked");
    expect(store.mergeSettings({}).imageSearch).toBe("browser");
    expect(store.mergeSettings({ imageSearch: "openverse" }).imageSearch).toBe("openverse");
    expect(store.mergeSettings({ imageSearch: "bing" }).imageSearch).toBe("browser");
  });
  test("toolbar position: a known side is kept, anything else falls back to left", () => {
    expect(store.mergeSettings({ toolbarPosition: "left" }).toolbarPosition).toBe("left");
    expect(store.mergeSettings({ toolbarPosition: "middle" }).toolbarPosition).toBe("left");
  });
  test("valid wheel behaviour and snap kept", () =>
    expect(store.mergeSettings({ wheelBehavior: "zoom", snapToPixel: false })).toMatchObject({
      wheelBehavior: "zoom",
      snapToPixel: false,
    }));
  test("agent names: a known set and the custom names are kept, anything else dropped", () => {
    const merged = store.mergeSettings({ agentNameSet: "custom", customAgentNames: ["Ayu"] });
    expect(merged.agentNameSet).toBe("custom");
    expect(merged.customAgentNames[0]).toBe("Ayu");
    expect(merged.customAgentNames).toHaveLength(10);
    expect(store.mergeSettings({ agentNameSet: "wizards" }).agentNameSet).toBe("pego");
  });
});

describe("useSettingsStore", () => {
  test("update persists only settings", () => {
    store.useSettingsStore.getState().update({ nudgeSmall: 5, wheelBehavior: "zoom" });
    const saved = JSON.parse(data.get("pego:settings.v1") ?? "{}");
    expect(saved).toEqual({ ...store.DEFAULT_SETTINGS, nudgeSmall: 5, wheelBehavior: "zoom" });
  });
  test("reset restores defaults and persists them", () => {
    store.useSettingsStore.getState().update({ snapToPixel: false });
    store.useSettingsStore.getState().reset();
    expect(store.useSettingsStore.getState().snapToPixel).toBe(true);
    expect(JSON.parse(data.get("pego:settings.v1") ?? "{}")).toEqual(store.DEFAULT_SETTINGS);
  });
});

describe("useSettingsModal", () => {
  test("open, switch tab and close", () => {
    const m = store.useSettingsModal.getState();
    m.openSettings("agent", "add-provider");
    expect(store.useSettingsModal.getState()).toMatchObject({
      open: true,
      tab: "agent",
      section: "add-provider",
    });
    store.useSettingsModal.getState().close();
    expect(store.useSettingsModal.getState()).toMatchObject({
      open: false,
      section: undefined,
      tab: "agent",
    });
  });
});

describe("connectors setting", () => {
  test("on by default; a stored boolean is kept, anything else falls back", () => {
    expect(store.mergeSettings({}).connectors).toBe(true);
    expect(store.mergeSettings({ connectors: false }).connectors).toBe(false);
    expect(store.mergeSettings({ connectors: "no" }).connectors).toBe(true);
  });
});
