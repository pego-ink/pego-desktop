import { posix, win32 } from "node:path";

/** Platforms the desktop app ships for. */
export type DesktopPlatform = "darwin" | "linux" | "win32";

/** File name of the compiled bridge inside Resources/bridge for this platform. */
export const bridgeBinaryName = (platform: DesktopPlatform): string =>
  platform === "win32" ? "pego-bridge.exe" : "pego-bridge";

/**
 * PATH for the bridge child process. Apps started from Finder, a desktop launcher or the Start
 * menu get a minimal PATH, so add the folders where `claude` (and `bun`) are usually installed.
 */
export const bridgeSearchPath = (
  platform: DesktopPlatform,
  home: string,
  env: Record<string, string | undefined>,
): string => {
  if (platform === "win32") {
    const path = win32;
    const extra = [
      env.APPDATA && path.join(env.APPDATA, "npm"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "claude"),
      path.join(home, ".local", "bin"),
      path.join(home, ".bun", "bin"),
    ].filter((entry): entry is string => Boolean(entry));
    const current = (env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
    return [...new Set([...extra, ...current])].join(";");
  }
  const extra =
    platform === "darwin"
      ? [posix.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
      : [posix.join(home, ".local", "bin"), posix.join(home, ".bun", "bin"), "/usr/local/bin"];
  const current = (env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":").filter(Boolean);
  return [...new Set([...extra, ...current])].join(":");
};
