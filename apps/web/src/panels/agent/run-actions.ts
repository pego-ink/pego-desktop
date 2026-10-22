import { toast } from "sonner";

/** Run an agent runtime action; surface thrown errors (incl. "not implemented" in dev) as a toast. */
export const safely = async (action: () => unknown | Promise<unknown>): Promise<boolean> => {
  try {
    await action();
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Agent action failed");
    return false;
  }
};
