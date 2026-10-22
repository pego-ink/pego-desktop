import { configFromEnv } from "./config";
import { resolveDesignDir } from "./project";
import { startBridge } from "./server";

// `bun run bridge` runs inside apps/bridge; INIT_CWD (when set) is where the user started it.
const config = {
  ...configFromEnv(process.env),
  designDir: resolveDesignDir(process.env, process.env.INIT_CWD ?? process.cwd()),
};
const bridge = startBridge(config);

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
    ? `Project design folder: ${config.designDir}`
    : "No design folder found (set PEGO_DESIGN_DIR to show one in the project panel)",
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
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
