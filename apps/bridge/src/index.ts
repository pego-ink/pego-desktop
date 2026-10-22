import { configFromEnv } from "./config";
import { resolveDesignDir } from "./project";
import { startBridge } from "./server";

// `bun run bridge` runs inside apps/bridge; INIT_CWD (when set) is where the user started it.
const config = {
  ...configFromEnv(process.env),
  designDir: resolveDesignDir(process.env, process.env.INIT_CWD ?? process.cwd()),
};

const isAddressInUse = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "EADDRINUSE";

let bridge: ReturnType<typeof startBridge>;
try {
  bridge = startBridge(config);
} catch (error) {
  if (!isAddressInUse(error)) throw error;
  // Another bridge (the desktop app or a second `bun run dev`) already serves this port; the
  // editor connects to whichever one is listening, so there is nothing to do here.
  config.log(`A Pego bridge is already running on 127.0.0.1:${config.port}; using that one.`);
  process.exit(0);
}

config.log(`Pego bridge listening on http://127.0.0.1:${bridge.port}`);
config.log("");
config.log("Connect Claude Code (run once):");
config.log(`  claude mcp add --transport http pego ${bridge.mcpUrl}`);
config.log("");
config.log(
  "Then open Pego (e.g. http://localhost:5173); the editor connects to ws://127.0.0.1:" +
    bridge.port +
    "/editor",
);
config.log(
  config.designDir
    ? `Design folder (projects): ${config.designDir}`
    : "No design folder found (set PEGO_DESIGN_DIR to keep projects somewhere)",
);
config.log(
  config.allowedOrigins
    ? `Allowed origins: ${config.allowedOrigins.join(", ")}`
    : "Allowed origins: any http(s)://localhost or 127.0.0.1 port (set PEGO_ALLOWED_ORIGINS to restrict)",
);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  config.log("Shutting down bridge...");
  bridge.stop();
  // Let an active run kill its CLI process tree and delete its workdir before exiting.
  await bridge.runs.whenIdle();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
