import { app } from "electron";
import { UPDATE_OWNER, UPDATE_REPO } from "@/constants";
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
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  setFeedURL: (options: { provider: "github"; owner: string; repo: string }) => void;
  checkForUpdates: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export type UpdateController = {
  getStatus: () => UpdateStatus;
  check: () => Promise<void>;
  install: () => void;
};

type ControllerDeps = {
  updater: UpdaterLike;
  publish: (status: UpdateStatus) => void;
  now?: () => number;
};

/** Wires updater events to a status store; the status is what the renderer sees. */
export const createUpdateController = ({
  updater,
  publish,
  now = Date.now,
}: ControllerDeps): UpdateController => {
  let status: UpdateStatus = IDLE_STATUS;
  const apply = (event: UpdaterEvent): void => {
    const next = reduceUpdaterEvent(status, event);
    if (next === status) return;
    status = next;
    publish(status);
  };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.setFeedURL({ provider: "github", owner: UPDATE_OWNER, repo: UPDATE_REPO });

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
  listen("update-downloaded", (info: { version: string; releaseNotes?: unknown }) =>
    apply({ type: "downloaded", info }),
  );
  listen("error", (error: unknown) => apply({ type: "error", error }));

  return {
    getStatus: () => status,
    check: async () => {
      if (status.state === "checking" || status.state === "downloading") return;
      try {
        await updater.checkForUpdates();
      } catch (error) {
        // electron-updater also emits "error"; this covers a rejection without an event.
        apply({ type: "error", error });
      }
    },
    install: () => {
      if (status.state !== "ready") return;
      updater.quitAndInstall(false, true);
    },
  };
};

/** Scripted statuses for UI work: `PEGO_FAKE_UPDATE=1 bun run desktop:dev`. */
export const createFakeController = (publish: (status: UpdateStatus) => void): UpdateController => {
  let status: UpdateStatus = IDLE_STATUS;
  let running = false;
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
  };
};

/**
 * Real updater in packaged macOS builds; fake with PEGO_FAKE_UPDATE=1; nothing otherwise. Linux and
 * Windows builds have no update feed yet (release.yml only publishes latest-mac.yml).
 */
export const createUpdater = async (
  publish: (status: UpdateStatus) => void,
): Promise<UpdateController> => {
  if (app.isPackaged && process.platform !== "darwin") {
    return { getStatus: () => IDLE_STATUS, check: async () => {}, install: () => {} };
  }
  if (!app.isPackaged) {
    if (process.env.PEGO_FAKE_UPDATE !== "1") {
      return { getStatus: () => IDLE_STATUS, check: async () => {}, install: () => {} };
    }
    const fake = createFakeController(publish);
    setTimeout(() => void fake.check(), 3000);
    return fake;
  }
  const { autoUpdater } = await import("electron-updater");
  const controller = createUpdateController({
    updater: autoUpdater as unknown as UpdaterLike,
    publish,
  });
  setTimeout(() => void controller.check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void controller.check(), CHECK_INTERVAL_MS).unref();
  return controller;
};
