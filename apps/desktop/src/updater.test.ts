import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

// updater.ts imports `app` from electron; the controller under test never touches it.
mock.module("electron", () => ({ app: { isPackaged: true } }));
const { CHANNEL_LOCKED_MESSAGE, createUpdateController } = await import("@/updater");
import type { UpdateStatus } from "@/update-status";
import type { UpdateChannel } from "@/update-channel";

type SetupOptions = {
  checkImpl?: () => Promise<unknown>;
  version?: string;
  initialChannel?: UpdateChannel | null;
  platform?: NodeJS.Platform;
};

const setup = ({
  checkImpl = async () => undefined,
  version = "0.1.0",
  initialChannel = null,
  platform = "linux",
}: SetupOptions = {}) => {
  const emitter = new EventEmitter();
  const feed: unknown[] = [];
  const installs: unknown[][] = [];
  const saved: UpdateChannel[] = [];
  // Like electron-updater: allowPrerelease follows the version, setting `channel` allows downgrades.
  let channel: string | null = null;
  const updater = Object.assign(emitter, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: /-/.test(version),
    allowDowngrade: false,
    get channel() {
      return channel;
    },
    set channel(value: string | null) {
      channel = value;
      this.allowDowngrade = true;
    },
    setFeedURL: (o: unknown) => feed.push(o),
    checkForUpdates: checkImpl,
    quitAndInstall: (...args: unknown[]) => installs.push(args),
  });
  const published: UpdateStatus[] = [];
  const controller = createUpdateController({
    updater: updater as never,
    publish: (s) => published.push(s),
    version,
    initialChannel,
    saveChannel: async (c) => {
      saved.push(c);
    },
    platform,
    now: () => 99,
  });
  return { emitter, updater, feed, installs, saved, published, controller };
};

describe("createUpdateController", () => {
  test("configures the public GitHub feed and auto settings", () => {
    const { updater, feed } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(feed).toEqual([{ provider: "github", owner: "pego-ink", repo: "pego-desktop" }]);
  });

  test("maps electron-updater events to published statuses", () => {
    const { emitter, published } = setup();
    emitter.emit("checking-for-update");
    emitter.emit("update-available", { version: "0.0.2" });
    emitter.emit("download-progress", { percent: 50 });
    emitter.emit("update-downloaded", { version: "0.0.2" });
    expect(published.map((s) => s.state)).toEqual([
      "checking",
      "available",
      "downloading",
      "ready",
    ]);
  });

  test("install only works once an update is ready", () => {
    const { emitter, installs, controller } = setup();
    controller.install();
    expect(installs).toHaveLength(0);
    emitter.emit("update-downloaded", { version: "0.0.2" });
    controller.install();
    expect(installs).toEqual([[false, true]]);
  });

  test("a rejected check becomes an error status", async () => {
    const { published, controller } = setup({
      checkImpl: async () => {
        throw new Error("offline");
      },
    });
    await controller.check();
    expect(published.at(-1)).toEqual({ state: "error", message: "offline" });
  });

  test("not-available records the time", () => {
    const { emitter, controller } = setup();
    emitter.emit("update-not-available", { version: "0.0.1" });
    expect(controller.getStatus()).toEqual({ state: "not-available", checkedAt: 99 });
  });
});

describe("update channel", () => {
  test("a stable build that never chose keeps electron-updater's defaults", () => {
    const { updater, controller } = setup({ version: "0.2.0" });
    expect(updater.channel).toBeNull();
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(controller.getChannel()).toBe("stable");
  });

  test("a beta build that never chose keeps its beta behaviour (no channel, prereleases on)", () => {
    const { updater, controller } = setup({ version: "0.1.0-beta" });
    expect(updater.channel).toBeNull();
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(controller.getChannel()).toBe("stable");
  });

  test("a nightly build follows nightly without a saved choice", () => {
    const { updater, controller } = setup({ version: "0.1.0-nightly.20261024.5" });
    expect(updater.channel).toBe("nightly");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
    expect(controller.getChannel()).toBe("nightly");
  });

  test("a saved stable choice beats the version: nightly build goes back to stable", () => {
    const { updater, controller } = setup({
      version: "0.1.0-nightly.20261024.5",
      initialChannel: "stable",
    });
    expect(updater.channel).toBe("beta");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
    expect(controller.getChannel()).toBe("stable");
  });

  test("a saved nightly choice on a stable build", () => {
    const { updater } = setup({ version: "0.2.0", initialChannel: "nightly" });
    expect(updater.channel).toBe("nightly");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
  });

  test("switching saves, applies the new settings and checks right away", async () => {
    let checks = 0;
    const { updater, saved, published, controller } = setup({
      version: "0.2.0",
      checkImpl: async () => {
        checks += 1;
        return null;
      },
    });
    await controller.setChannel("nightly");
    expect(saved).toEqual(["nightly"]);
    expect(updater.channel).toBe("nightly");
    expect(updater.allowPrerelease).toBe(true);
    expect(checks).toBe(1);
    expect(controller.getChannel()).toBe("nightly");
    await controller.setChannel("stable");
    expect(saved).toEqual(["nightly", "stable"]);
    expect(updater.channel).toBe("beta");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
    expect(checks).toBe(2);
    expect(published.at(-1)).toEqual({ state: "idle" });
  });

  test("choosing the channel already in effect does nothing", async () => {
    let checks = 0;
    const { saved, controller } = setup({
      checkImpl: async () => {
        checks += 1;
        return null;
      },
    });
    await controller.setChannel("stable");
    expect(saved).toEqual([]);
    expect(checks).toBe(0);
  });

  test("switching stops the running download and keeps the old file from installing on quit", async () => {
    let cancelled = 0;
    let finish: () => void = () => {};
    const download = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const { emitter, updater, controller } = setup({
      version: "0.2.0",
      checkImpl: async () => {
        calls += 1;
        return calls === 1
          ? {
              cancellationToken: {
                cancel: () => {
                  cancelled += 1;
                  finish();
                },
              },
              downloadPromise: download,
            }
          : null;
      },
    });
    await controller.check();
    emitter.emit("download-progress", { percent: 10 });
    expect(controller.getStatus().state).toBe("downloading");
    await controller.setChannel("nightly");
    expect(cancelled).toBe(1);
    expect(calls).toBe(2);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(controller.getStatus()).toEqual({ state: "idle" });
    // The new channel's download re-arms install on quit.
    emitter.emit("update-downloaded", { version: "0.2.1-nightly.20261025.2" });
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  test("a failing check after switching is reported, not thrown", async () => {
    const { published, controller } = setup({
      checkImpl: async () => {
        throw new Error("no nightly yet");
      },
    });
    await controller.setChannel("nightly");
    expect(published.at(-1)).toEqual({ state: "error", message: "no nightly yet" });
  });

  test("a beta build switches to nightly and back to the beta/stable line", async () => {
    const { updater, controller } = setup({ version: "0.1.0-beta" });
    await controller.setChannel("nightly");
    expect(updater.channel).toBe("nightly");
    await controller.setChannel("stable");
    expect(updater.channel).toBe("beta");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
  });

  test("a nightly build switches to stable: beta/stable line, downgrade allowed", async () => {
    const { updater, saved, controller } = setup({ version: "0.1.0-nightly.20261024.5.1" });
    expect(controller.getChannel()).toBe("nightly");
    await controller.setChannel("stable");
    expect(saved).toEqual(["stable"]);
    expect(updater.channel).toBe("beta");
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(true);
    expect(controller.getChannel()).toBe("stable");
  });

  test("on macOS a downloaded update blocks switching until restart", async () => {
    const { emitter, updater, saved, controller } = setup({ version: "0.2.0", platform: "darwin" });
    emitter.emit("update-downloaded", { version: "0.2.1" });
    await expect(controller.setChannel("nightly")).rejects.toThrow(CHANNEL_LOCKED_MESSAGE);
    expect(saved).toEqual([]);
    expect(updater.channel).toBeNull();
    expect(controller.getChannel()).toBe("stable");
    expect(controller.getStatus().state).toBe("ready");
  });

  test("elsewhere a downloaded update does not block switching", async () => {
    const { emitter, controller } = setup({ version: "0.2.0", platform: "win32" });
    emitter.emit("update-downloaded", { version: "0.2.1" });
    await controller.setChannel("nightly");
    expect(controller.getChannel()).toBe("nightly");
  });
});
