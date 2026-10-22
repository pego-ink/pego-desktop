import { useEffect, useState } from "react";
import { loadApiKey } from "@/agent/api-key";

/** Whether an Anthropic API key is stored locally. The runtime may not implement storage in dev. */
export const useHasApiKey = () => {
  const state = useState(false);
  const [, setHasKey] = state;
  useEffect(() => {
    loadApiKey()
      .then((key) => setHasKey(Boolean(key)))
      .catch(() => setHasKey(false));
  }, [setHasKey]);
  return state;
};
