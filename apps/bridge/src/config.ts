import { BRIDGE_DEFAULT_PORT } from "@pego/agent";

/**
 * Largest WebSocket frame accepted from the editor. The biggest legitimate frame is a
 * `run_start` with the maximum composer attachments (6 images of 5MB, ~42MB as base64); tool
 * results (document dumps, up to 8MB of screenshots = ~10.7MB as base64) are far smaller.
 */
export const MAX_WS_MESSAGE_BYTES = 48 * 1024 * 1024;
/** Largest .pego file the bridge reads or writes. */
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;
/** Largest MCP HTTP request body. */
export const MAX_MCP_BODY_BYTES = 1024 * 1024;
/** How long the bridge waits for the editor to answer a forwarded tool call. */
export const TOOL_CALL_TIMEOUT_MS = 60_000;
/** Prefix Claude Code gives to tools of an in-process SDK MCP server named `pego`. */
export const SDK_SERVER_NAME = "pego";

export type BridgeConfig = {
  port: number;
  /** Exact origins allowed to open the editor socket. `null` = any localhost / 127.0.0.1 port. */
  allowedOrigins: string[] | null;
  toolTimeoutMs: number;
  log: (line: string) => void;
  /** The design folder holding the projects (see project.ts); null = none. */
  designDir?: string | null;
};

const parsePort = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return BRIDGE_DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PEGO_BRIDGE_PORT must be an integer 0-65535, got "${raw}"`);
  }
  return port;
};

const parseOrigins = (raw: string | undefined): string[] | null => {
  if (raw === undefined || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin !== "");
};

export const configFromEnv = (env: Record<string, string | undefined>): BridgeConfig => ({
  port: parsePort(env.PEGO_BRIDGE_PORT),
  allowedOrigins: parseOrigins(env.PEGO_ALLOWED_ORIGINS),
  toolTimeoutMs: TOOL_CALL_TIMEOUT_MS,
  log: (line) => console.log(line),
});
