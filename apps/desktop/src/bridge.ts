import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { APP_ORIGIN, BRIDGE_HOST, BRIDGE_PORT, DEV_ORIGINS } from "@/constants";
import { bridgeBinaryName, bridgeSearchPath, type DesktopPlatform } from "@/platform";

let child: ChildProcess | null = null;

const isPortOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: BRIDGE_HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });

const platform = process.platform as DesktopPlatform;

/** Packaged: compiled binary in Resources. Dev: run the TypeScript entry with `bun`. */
const bridgeCommand = (): { command: string; args: string[] } | null => {
  if (app.isPackaged) {
    const binary = join(process.resourcesPath, "bridge", bridgeBinaryName(platform));
    return existsSync(binary) ? { command: binary, args: [] } : null;
  }
  const entry = join(app.getAppPath(), "..", "bridge", "src", "index.ts");
  return { command: "bun", args: ["run", entry] };
};

export const startBridge = async (): Promise<void> => {
  if (await isPortOpen(BRIDGE_PORT)) {
    console.log(`[bridge] port ${BRIDGE_PORT} already in use, reusing the running bridge`);
    return;
  }
  const spec = bridgeCommand();
  if (!spec) {
    console.error("[bridge] bridge binary not found, agent features via Claude Code are disabled");
    return;
  }
  const proc = spawn(spec.command, spec.args, {
    env: {
      ...process.env,
      // Windows env lookups are case-insensitive but the copied object is not: set both.
      PATH: bridgeSearchPath(platform, homedir(), process.env),
      ...(platform === "win32" ? { Path: bridgeSearchPath(platform, homedir(), process.env) } : {}),
      PEGO_BRIDGE_PORT: String(BRIDGE_PORT),
      PEGO_ALLOWED_ORIGINS: [APP_ORIGIN, ...DEV_ORIGINS].join(","),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  proc.stdout?.on("data", (data: Buffer) => process.stdout.write(`[bridge] ${data}`));
  proc.stderr?.on("data", (data: Buffer) => process.stderr.write(`[bridge] ${data}`));
  proc.once("error", (error) => {
    console.error(`[bridge] failed to start: ${error.message}`);
    child = null;
  });
  proc.once("exit", (code, signal) => {
    console.log(`[bridge] exited (code ${code}, signal ${signal})`);
    if (child === proc) child = null;
  });
};

export const stopBridge = (): void => {
  if (!child) return;
  child.kill("SIGTERM");
  child = null;
};
