import type { UpdateStatus } from "@/desktop/desktop-api";

export type UpdateView = {
  /** Status line text. */
  text: string;
  /** 0..100 while downloading. */
  percent?: number;
  action: "check" | "restart" | "none";
  /** Disable the check button (busy). */
  busy: boolean;
  tone: "neutral" | "error";
};

/** Presentation of the auto-updater state for the About tab. */
export const describeUpdate = (status: UpdateStatus): UpdateView => {
  switch (status.state) {
    case "checking":
      return { text: "Checking for updates…", action: "check", busy: true, tone: "neutral" };
    case "not-available":
      return { text: "Pego is up to date.", action: "check", busy: false, tone: "neutral" };
    case "available":
      return {
        text: `Version ${status.version} is available. Downloading…`,
        action: "none",
        busy: true,
        tone: "neutral",
      };
    case "downloading": {
      const percent = Math.max(0, Math.min(100, Math.round(status.percent)));
      return {
        text: `Downloading version ${status.version}… ${percent}%`,
        percent,
        action: "none",
        busy: true,
        tone: "neutral",
      };
    }
    case "ready":
      return {
        text: `Version ${status.version} is ready to install.`,
        action: "restart",
        busy: false,
        tone: "neutral",
      };
    case "error":
      return {
        text: `Could not check for updates. ${status.message}`,
        action: "check",
        busy: false,
        tone: "error",
      };
    default:
      return { text: "", action: "check", busy: false, tone: "neutral" };
  }
};

/**
 * Why the update channel cannot be switched right now, or null. On macOS a downloaded update is
 * installed on quit whatever happens, so the channel stays put until the user restarts.
 */
export const channelLockHint = (status: UpdateStatus, platform: string): string | null =>
  platform === "darwin" && status.state === "ready"
    ? "Restart to finish the downloaded update before switching channels."
    : null;
