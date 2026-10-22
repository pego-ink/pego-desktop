import { useEffect } from "react";
import { startBridgeConnection } from "./bridge-client";

/**
 * Keeps the editor connected to the local Claude Code bridge while the component is mounted.
 * Mount it once near the app root (e.g. in `App`); it reconnects quietly with backoff and
 * mirrors the connection into `useAgentStore().bridge`.
 */
export const useBridgeConnection = (): void => {
  useEffect(() => startBridgeConnection(), []);
};
