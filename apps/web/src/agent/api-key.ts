/** The user's Anthropic API key, kept only in this browser (IndexedDB). Never sent anywhere but api.anthropic.com. */
export const loadApiKey = async (): Promise<string | null> => {
  throw new Error("not implemented");
};

export const saveApiKey = async (key: string | null): Promise<void> => {
  void key;
  throw new Error("not implemented");
};
