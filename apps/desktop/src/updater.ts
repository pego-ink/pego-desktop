import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { UPDATE_OWNER, UPDATE_REPO } from "@/constants";
import {
  canAutoUpdate,
  channelFromVersion,
  feedSettings,
  type UpdateChannel,
} from "@/update-channel";
import { createUpdatePrefs, type UpdatePrefs } from "@/update-prefs";
import {
  IDLE_STATUS,
  reduceUpdaterEvent,
  type UpdateStatus,
  type UpdaterEvent,
} from "@/update-status";

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The slice of electron-updater's AppUpdater we use (lets tests pass a fake). */
export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  /** electron-updater only accepts a string once set; it also switches allowDowngrade on. */
  channel: string | null;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  setFeedURL: (options: { provider: "github"; owner: string; repo: string }) => void;
  checkForUpdates: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export type UpdateController = {
  getStatus: () => UpdateStatus;
  check: () => Promise<void>;
  install: () => void;
  /** The channel in effect; null when this build cannot update itself. */
  getChannel: () => UpdateChannel | null;
  /** Saves the channel, drops what the old one fetched, and checks the new one right away. */
  setChannel: (channel: UpdateChannel) => Promise<void>;
};

type ControllerDeps = {
  updater: UpdaterLike;
  publish: (status: UpdateStatus) => void;
  /** Running app version (decides the channel when none is saved). */
  version: string;
  /** The saved channel, null when the user never chose one. */
  initialChannel: UpdateChannel | null;
  saveChannel: (channel: UpdateChannel) => Promise<void>;
  /** Defaults to process.platform. */
  platform?: NodeJS.Platform;
  now?: () => number;
};

/** Shown when a channel switch is refused (the Settings control shows the same sentence). */
export const CHANNEL_LOCKED_MESSAGE =
  "Restart to finish the downloaded update before switching channels.";

/** What `checkForUpdates()` resolves with that we use: stop a running download. */
type CheckResult = {
  cancellationToken?: { cancel: () => void };
  downloadPromise?: Promise<unknown> | null;
} | null;

/** Wires updater events to a status store; the status is what the renderer sees. */
export const createUpdateController = ({
  updater,
  publish,
  version,
  initialChannel,
  saveChannel,
  platform = process.platform,
  now = Date.now,
}: ControllerDeps): UpdateController => {
  let status: UpdateStatus = IDLE_STATUS;
  let preference = initialChannel;
  let last: CheckResult = null;
  let running: Promise<void> | null = null;
  const apply = (event: UpdaterEvent): void => {
    const next = reduceUpdaterEvent(status, event);
    if (next === status) return;
    status = next;
    publish(status);
  };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.setFeedURL({ provider: "github", owner: UPDATE_OWNER, repo: UPDATE_REPO });
  const applyChannel = (): void => {
    const settings = feedSettings(preference, version);
    // Order matters: electron-updater's `channel` setter turns allowDowngrade on by itself.
    if (settings.channel !== undefined) updater.channel = settings.channel;
    if (settings.allowPrerelease !== undefined) updater.allowPrerelease = settings.allowPrerelease;
    if (settings.allowDowngrade !== undefined) updater.allowDowngrade = settings.allowDowngrade;
  };
  applyChannel();

  const listen = (event: string, handler: (arg: never) => void): void => {
    updater.on(event, handler as (...args: never[]) => void);
  };
  listen("checking-for-update", () => apply({ type: "checking" }));
  listen("update-available", (info: { version: string; releaseNotes?: unknown }) =>
    apply({ type: "available", info }),
  );
  listen("update-not-available", () => apply({ type: "not-available", now: now() }));
  listen("download-progress", (p: { percent: number }) =>
    apply({ type: "progress", percent: p.percent }),
  );
  listen("update-downloaded", (info: { version: string; releaseNotes?: unknown }) => {
    // From here on the pending file is the one of the channel in effect.
    updater.autoInstallOnAppQuit = true;
    apply({ type: "downloaded", info });
  });
  listen("error", (error: unknown) => apply({ type: "error", error }));

  const runCheck = async (): Promise<void> => {
    try {
      last = (await updater.checkForUpdates()) as CheckResult;
    } catch (error) {
      // electron-updater also emits "error"; this covers a rejection without an event.
      apply({ type: "error", error });
    }
  };

  return {
    getStatus: () => status,
    check: async () => {
      if (status.state === "checking" || status.state === "downloading") return;
      running = runCheck();
      await running;
    },
    install: () => {
      if (status.state !== "ready") return;
      updater.quitAndInstall(false, true);
    },
    getChannel: () => preference ?? channelFromVersion(version),
    setChannel: async (channel) => {
      if (channel === (preference ?? channelFromVersion(version))) return;
      // Squirrel/ShipIt applies a downloaded macOS update on quit whatever autoInstallOnAppQuit says,
      // so the old channel's file could not be kept from installing.
      if (platform === "darwin" && status.state === "ready")
        throw new Error(CHANNEL_LOCKED_MESSAGE);
      await saveChannel(channel);
      preference = channel;
      // Let a running check finish and stop a running download: both belong to the old channel.
      await running?.catch(() => {});
      const previous = last;
      last = null;
      if (previous?.cancellationToken) {
        previous.cancellationToken.cancel();
        await Promise.resolve(previous.downloadPromise).catch(() => {});
      }
      // Elsewhere a file downloaded from the old channel must not be installed on quit by accident.
      updater.autoInstallOnAppQuit = false;
      status = IDLE_STATUS;
      publish(status);
      applyChannel();
      running = runCheck();
      await running;
    },
  };
};

/** Scripted statuses for UI work: `PEGO_FAKE_UPDATE=1 bun run desktop:dev`. */
export const createFakeController = (
  publish: (status: UpdateStatus) => void,
  initialChannel: UpdateChannel = "stable",
): UpdateController => {
  let status: UpdateStatus = IDLE_STATUS;
  let running = false;
  let channel = initialChannel;
  const set = (next: UpdateStatus): void => {
    status = next;
    publish(next);
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const version = "0.0.2";
  return {
    getStatus: () => status,
    check: async () => {
      if (running) return;
      running = true;
      set({ state: "checking" });
      await sleep(1200);
      set({ state: "available", version, releaseNotes: "Fake release notes for UI testing." });
      await sleep(800);
      for (let percent = 0; percent <= 100; percent += 10) {
        set({ state: "downloading", version, percent });
        await sleep(350);
      }
      set({ state: "ready", version, releaseNotes: "Fake release notes for UI testing." });
      running = false;
    },
    install: () => console.log("[updater] fake install requested (no-op)"),
    getChannel: () => channel,
    setChannel: async (next) => {
      channel = next;
    },
  };
};

/** Controller of a build without an updater (dev, deb/rpm/pacman/tar.gz installs, portable zip). */
const inertController = (): UpdateController => ({
  getStatus: () => IDLE_STATUS,
  check: async () => {},
  install: () => {},
  getChannel: () => null,
  setChannel: async () => {},
});

/**
 * Real updater in packaged builds that can replace themselves (macOS; the Windows NSIS install; the
 * Linux AppImage); fake with PEGO_FAKE_UPDATE=1; nothing otherwise. The saved update channel lives
 * in `preferences.json` in the user data folder.
 */
export const createUpdater = async (
  publish: (status: UpdateStatus) => void,
): Promise<UpdateController> => {
  if (!app.isPackaged) {
    if (process.env.PEGO_FAKE_UPDATE !== "1") return inertController();
    const fake = createFakeController(publish);
    setTimeout(() => void fake.check(), 3000);
    return fake;
  }
  const supported = canAutoUpdate({
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    hasUninstaller: existsSync(join(dirname(process.execPath), "Uninstall Pego.exe")),
  });
  if (!supported) return inertController();
  const prefs: UpdatePrefs = createUpdatePrefs(join(app.getPath("userData"), "preferences.json"));
  const { autoUpdater } = await import("electron-updater");
  const controller = createUpdateController({
    updater: autoUpdater as unknown as UpdaterLike,
    publish,
    version: app.getVersion(),
    initialChannel: await prefs.readChannel(),
    saveChannel: prefs.writeChannel,
  });
  setTimeout(() => void controller.check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void controller.check(), CHECK_INTERVAL_MS).unref();
  return controller;
};
