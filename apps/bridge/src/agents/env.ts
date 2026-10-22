import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** API-key style variables the user's own CLI logins must not be overridden by. */
export const API_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
] as const;

/** Where agent CLIs usually live when the bridge was started from a bare launchd/GUI shell. */
export const extraPathDirs = (home: string = homedir()): string[] => [
  join(home, ".local", "bin"),
  join(home, ".opencode", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/** Append directories missing from a PATH string (user order wins). */
export const extendPath = (path: string | undefined, dirs: string[]): string => {
  const parts = (path ?? "").split(delimiter).filter((part) => part !== "");
  const missing = dirs.filter((dir) => !parts.includes(dir));
  return [...parts, ...missing].join(delimiter);
};

/**
 * Environment for an agent child process: the bridge's env with PATH extended and API-key
 * variables removed (the CLIs use their own logins). Values that are `undefined` are dropped.
 */
export const buildChildEnv = (
  base: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if ((API_KEY_ENV_VARS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  env.PATH = extendPath(env.PATH, extraPathDirs(home));
  return env;
};

/**
 * For adapters whose CLI legitimately reads provider keys from the environment (opencode talks
 * to arbitrary providers): copy the stripped API-key variables back from `source`.
 */
export const withApiKeys = (
  env: Record<string, string>,
  source: Record<string, string | undefined> = process.env,
): Record<string, string> => {
  const result = { ...env };
  for (const key of API_KEY_ENV_VARS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
};
