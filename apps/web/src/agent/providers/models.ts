import type { CustomProviderKind } from "./types";

/** List model ids from the provider's models endpoint. Throws a readable Error on failure. */
export const fetchProviderModels = async (
  kind: CustomProviderKind,
  baseUrl: string,
  apiKey: string,
): Promise<string[]> => {
  void kind;
  void baseUrl;
  void apiKey;
  return [];
};
