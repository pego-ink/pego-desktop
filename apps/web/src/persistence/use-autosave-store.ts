import { create } from "zustand";

const STORAGE_KEY = "pego.autosave.file";

/**
 * idle: nothing to show. saving/saved: transient write feedback.
 * needs-permission: a restored handle must be re-authorised by a click.
 * paused: a write failed; file autosave is off for this session until retried.
 * offline: the document saves through the bridge, which is not connected; it resumes on reconnect.
 */
export type AutosaveStatus =
  "idle" | "saving" | "saved" | "needs-permission" | "paused" | "offline";

const readEnabled = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

const writeEnabled = (enabled: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage can be blocked; the preference then lasts for this session only.
  }
};

type AutosaveState = {
  enabled: boolean;
  status: AutosaveStatus;
  setEnabled: (enabled: boolean) => void;
  setStatus: (status: AutosaveStatus) => void;
};

export const useAutosaveStore = create<AutosaveState>((set) => ({
  enabled: readEnabled(),
  status: "idle",
  setEnabled: (enabled) => {
    writeEnabled(enabled);
    set({ enabled });
  },
  setStatus: (status) => set({ status }),
}));
