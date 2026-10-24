import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isUpdateChannel, type UpdateChannel } from "@/update-channel";

/** Desktop preferences kept in the user data folder (`preferences.json`). */
export type UpdatePrefs = {
  readChannel: () => Promise<UpdateChannel | null>;
  writeChannel: (channel: UpdateChannel) => Promise<void>;
};

const readObject = async (file: string): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Missing or corrupt file: no preference. The next write replaces it.
    return {};
  }
};

/** JSON file store; other keys in the file are kept, writes go through a temp file and rename. */
export const createUpdatePrefs = (file: string): UpdatePrefs => ({
  readChannel: async () => {
    const value = (await readObject(file)).updateChannel;
    return isUpdateChannel(value) ? value : null;
  },
  writeChannel: async (channel) => {
    const next = { ...(await readObject(file)), updateChannel: channel };
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temp, file);
  },
});
