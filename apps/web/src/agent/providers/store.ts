import type { CustomProvider } from "./types";

/**
 * Custom providers + their API keys, kept only in this browser (IndexedDB "pego-settings").
 * Keys are sent only to the provider's own base URL. (Stub: implemented by the provider work.)
 */
export const listCustomProviders = async (): Promise<CustomProvider[]> => [];

export const saveCustomProvider = async (provider: CustomProvider): Promise<void> => {
  void provider;
};

export const deleteCustomProvider = async (id: string): Promise<void> => {
  void id;
};

export const loadProviderKey = async (id: string): Promise<string | null> => {
  void id;
  return null;
};

export const saveProviderKey = async (id: string, key: string | null): Promise<void> => {
  void id;
  void key;
};
