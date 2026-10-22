import { useEffect, useState } from "react";
import { create } from "zustand";
import { isLocalBaseUrl } from "@/agent/provider-url";
import {
  deleteCustomProvider,
  listCustomProviders,
  loadProviderKey,
  saveCustomProvider,
  saveProviderKey,
} from "@/agent/providers/store";
import type { CustomProvider } from "@/agent/providers/types";
import { useAgentStore } from "@/agent/use-agent-store";
import { staleCustomSelection } from "@/panels/agent/custom-provider/provider-form";

/**
 * Custom providers as the panel sees them, shared by the composer popover and the settings page so
 * an add/edit/delete in one shows in the other. Storage is the source of truth; this is a cache.
 */
type ProvidersState = {
  providers: CustomProvider[];
  loaded: boolean;
  refresh: () => Promise<void>;
};

export const useCustomProvidersStore = create<ProvidersState>((set) => ({
  providers: [],
  loaded: false,
  refresh: async () => {
    try {
      const providers = await listCustomProviders();
      set({ providers, loaded: true });
    } catch {
      // Keep `loaded` false: an unreadable store must not look like "no providers" and clear
      // the saved selection.
    }
  },
}));

/** Save a provider and, when given, its key (null removes it; undefined keeps the saved one). */
export const persistProvider = async (
  provider: CustomProvider,
  key: string | null | undefined,
): Promise<void> => {
  await saveCustomProvider(provider);
  if (key !== undefined) await saveProviderKey(provider.id, key);
  await useCustomProvidersStore.getState().refresh();
};

export const removeProvider = async (id: string): Promise<void> => {
  await deleteCustomProvider(id);
  await saveProviderKey(id, null);
  await useCustomProvidersStore.getState().refresh();
  const agent = useAgentStore.getState();
  if (agent.backend === "custom" && agent.customProviderId === id) {
    agent.clearCustomProvider("local");
  }
};

/** Providers list; loads once on first use. Also repairs a persisted selection that went stale. */
export const useCustomProviders = () => {
  const providers = useCustomProvidersStore((s) => s.providers);
  const loaded = useCustomProvidersStore((s) => s.loaded);
  const backend = useAgentStore((s) => s.backend);
  const selectedId = useAgentStore((s) => s.customProviderId);

  useEffect(() => {
    if (!loaded) void useCustomProvidersStore.getState().refresh();
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    const fallback = staleCustomSelection(backend, selectedId, providers);
    if (fallback) useAgentStore.getState().clearCustomProvider(fallback);
  }, [loaded, backend, selectedId, providers]);

  return { providers, loaded };
};

/** A provider can run when it has a saved key, or points at localhost where none is needed. */
export const useProviderReady = (provider: CustomProvider | undefined): boolean => {
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    loadProviderKey(provider.id)
      .then((key) => !cancelled && setHasKey(Boolean(key)))
      .catch(() => !cancelled && setHasKey(false));
    return () => {
      cancelled = true;
    };
  }, [provider]);
  return provider !== undefined && (isLocalBaseUrl(provider.baseUrl) || hasKey);
};
