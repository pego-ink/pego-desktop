import { create } from "zustand";
import { desktopApi, type UpdateChannel } from "./desktop-api";

type ChannelState = {
  /** undefined = not loaded yet, null = this install cannot switch channels (or no desktop app). */
  channel: UpdateChannel | null | undefined;
  /** The last switch failed: a short reason, cleared by the next attempt. */
  error: string | null;
  /** Read the channel from the desktop app (once is enough; call again after errors). */
  load: () => Promise<void>;
  /** Switch channel: shows the new one at once, rolls back when the desktop app refuses. */
  select: (channel: UpdateChannel) => Promise<void>;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message.split("\n")[0]! : "Please try again.";

/** Update channel preference of the desktop app (Settings > About & Updates). */
export const useUpdateChannel = create<ChannelState>((set, get) => ({
  channel: undefined,
  error: null,
  load: async () => {
    const api = desktopApi();
    if (!api?.getUpdateChannel || !api.setUpdateChannel) return set({ channel: null });
    try {
      set({ channel: await api.getUpdateChannel() });
    } catch {
      set({ channel: null });
    }
  },
  select: async (channel) => {
    const api = desktopApi();
    const previous = get().channel;
    if (!api?.setUpdateChannel || !previous || previous === channel) return;
    set({ channel, error: null });
    try {
      set({ channel: (await api.setUpdateChannel(channel)) ?? previous });
    } catch (error) {
      set({ channel: previous, error: reasonOf(error) });
    }
  },
}));
