import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PegoDesktopApi, UpdateChannel } from "./desktop-api";
import { useUpdateChannel } from "./use-update-channel";

const install = (api: Partial<PegoDesktopApi>) => {
  (globalThis as { pegoDesktop?: Partial<PegoDesktopApi> }).pegoDesktop = {
    checkForUpdates: async () => {},
    ...api,
  };
};

describe("useUpdateChannel", () => {
  beforeEach(() => useUpdateChannel.setState({ channel: undefined, error: null }));
  afterEach(() => {
    delete (globalThis as { pegoDesktop?: unknown }).pegoDesktop;
  });

  test("no desktop app, or an older shell: no channel control", async () => {
    await useUpdateChannel.getState().load();
    expect(useUpdateChannel.getState().channel).toBeNull();
    install({});
    useUpdateChannel.setState({ channel: undefined });
    await useUpdateChannel.getState().load();
    expect(useUpdateChannel.getState().channel).toBeNull();
  });

  test("loads the channel and switches it", async () => {
    const calls: UpdateChannel[] = [];
    install({
      getUpdateChannel: async () => "stable",
      setUpdateChannel: async (channel) => {
        calls.push(channel);
        return channel;
      },
    });
    await useUpdateChannel.getState().load();
    expect(useUpdateChannel.getState().channel).toBe("stable");
    await useUpdateChannel.getState().select("nightly");
    expect(calls).toEqual(["nightly"]);
    expect(useUpdateChannel.getState().channel).toBe("nightly");
    await useUpdateChannel.getState().select("nightly");
    expect(calls).toEqual(["nightly"]);
  });

  test("rolls back and reports when the switch fails", async () => {
    install({
      getUpdateChannel: async () => "stable",
      setUpdateChannel: async () => {
        throw new Error("this build does not update itself\n at x");
      },
    });
    await useUpdateChannel.getState().load();
    await useUpdateChannel.getState().select("nightly");
    expect(useUpdateChannel.getState().channel).toBe("stable");
    expect(useUpdateChannel.getState().error).toBe("this build does not update itself");
  });
});
