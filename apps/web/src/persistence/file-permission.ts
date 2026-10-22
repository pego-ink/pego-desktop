import type { PegoFileHandle } from "./fs-access";

export type WritePermission = "granted" | "prompt" | "denied";

const DESC = { mode: "readwrite" } as const;

/** Handles without the permission API (older engines, fakes) are treated as writable. */
export const queryWritePermission = async (handle: PegoFileHandle): Promise<WritePermission> => {
  if (!handle.queryPermission) return "granted";
  try {
    return await handle.queryPermission(DESC);
  } catch {
    return "prompt";
  }
};

/** Must run inside a user gesture to be allowed to show the browser prompt. */
export const requestWritePermission = async (handle: PegoFileHandle): Promise<WritePermission> => {
  if (!handle.requestPermission) return "granted";
  try {
    return await handle.requestPermission(DESC);
  } catch {
    return "denied";
  }
};

export const ensureWritePermission = async (handle: PegoFileHandle) =>
  (await queryWritePermission(handle)) === "granted" ||
  (await requestWritePermission(handle)) === "granted";

export const writeToHandle = async (handle: PegoFileHandle, text: string) => {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};
