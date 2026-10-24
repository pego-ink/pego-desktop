import { describe, expect, test } from "bun:test";
import { canAutoUpdate, channelFromVersion, feedSettings, isUpdateChannel } from "@/update-channel";

describe("channelFromVersion", () => {
  test("only nightly versions default to nightly", () => {
    expect(channelFromVersion("0.1.0-nightly.20261024.17")).toBe("nightly");
    expect(channelFromVersion("0.1.0-beta")).toBe("stable");
    expect(channelFromVersion("0.1.0")).toBe("stable");
    expect(channelFromVersion("0.1.0-nightlyish")).toBe("stable");
  });
});

describe("isUpdateChannel", () => {
  test("accepts the two ids only", () => {
    expect(isUpdateChannel("stable")).toBe(true);
    expect(isUpdateChannel("nightly")).toBe(true);
    expect(isUpdateChannel("beta")).toBe(false);
    expect(isUpdateChannel(undefined)).toBe(false);
  });
});

describe("feedSettings", () => {
  test("nightly reads nightly feeds from prereleases and may downgrade", () => {
    const expected = { channel: "nightly", allowPrerelease: true, allowDowngrade: true };
    expect(feedSettings("nightly", "0.2.0")).toEqual(expected);
    expect(feedSettings(null, "0.1.0-nightly.20261024.1")).toEqual(expected);
  });

  test("an explicit stable choice follows the beta/stable line (never nightly) and may downgrade", () => {
    const expected = { channel: "beta", allowPrerelease: true, allowDowngrade: true };
    expect(feedSettings("stable", "0.1.0-nightly.20261024.1")).toEqual(expected);
    expect(feedSettings("stable", "0.1.0-beta")).toEqual(expected);
  });

  test("no choice on a stable or beta build leaves the updater alone", () => {
    expect(feedSettings(null, "0.2.0")).toEqual({});
    expect(feedSettings(null, "0.1.0-beta")).toEqual({});
  });
});

describe("canAutoUpdate", () => {
  const base = { appImage: undefined, hasUninstaller: false };
  test("macOS always, Windows with the NSIS uninstaller, Linux as an AppImage", () => {
    expect(canAutoUpdate({ ...base, platform: "darwin" })).toBe(true);
    expect(canAutoUpdate({ ...base, platform: "win32" })).toBe(false);
    expect(canAutoUpdate({ ...base, platform: "win32", hasUninstaller: true })).toBe(true);
    expect(canAutoUpdate({ ...base, platform: "linux" })).toBe(false);
    expect(canAutoUpdate({ ...base, platform: "linux", appImage: "/x/Pego.AppImage" })).toBe(true);
    expect(canAutoUpdate({ ...base, platform: "linux", appImage: "" })).toBe(false);
    expect(canAutoUpdate({ ...base, platform: "freebsd" })).toBe(false);
  });
});
