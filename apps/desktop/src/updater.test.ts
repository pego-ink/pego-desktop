import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

// updater.ts imports `app` from electron; the controller under test never touches it.
mock.module("electron", () => ({ app: { isPackaged: true } }));
const { createUpdateController } = await import("@/updater");
import type { UpdateStatus } from "@/update-status";

const setup = (checkImpl: () => Promise<unknown> = async () => undefined) => {
  const emitter = new EventEmitter();
  const feed: unknown[] = [];
  const installs: unknown[][] = [];
  const updater = Object.assign(emitter, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL: (o: unknown) => feed.push(o),
    checkForUpdates: checkImpl,
    quitAndInstall: (...args: unknown[]) => installs.push(args),
  });
  const published: UpdateStatus[] = [];
  const controller = createUpdateController({
    updater: updater as never,
    publish: (s) => published.push(s),
    now: () => 99,
  });
  return { emitter, updater, feed, installs, published, controller };
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
    const { published, controller } = setup(async () => {
      throw new Error("offline");
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
