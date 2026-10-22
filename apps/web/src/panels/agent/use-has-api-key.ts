import { useEffect } from "react";
import { create } from "zustand";
import { loadApiKey } from "@/agent/api-key";

type ApiKeyState = {
  hasKey: boolean;
  setHasKey: (hasKey: boolean) => void;
};

/** Shared so the composer pill and the settings page agree on whether a key is saved. */
const useApiKeyStore = create<ApiKeyState>((set) => ({
  hasKey: false,
  setHasKey: (hasKey) => set({ hasKey }),
}));

let requested = false;

/** Whether an Anthropic API key is stored locally. The runtime may not implement storage in dev. */
export const useHasApiKey = () => {
  const hasKey = useApiKeyStore((s) => s.hasKey);
  const setHasKey = useApiKeyStore((s) => s.setHasKey);
  useEffect(() => {
    if (requested) return;
    requested = true;
    loadApiKey()
      .then((key) => setHasKey(Boolean(key)))
      .catch(() => setHasKey(false));
  }, [setHasKey]);
  return [hasKey, setHasKey] as const;
};
