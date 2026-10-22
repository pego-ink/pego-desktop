import { join } from "node:path";
import { bundleElectron } from "./bundle";

const desktop = join(import.meta.dir, "..");
const webDir = join(desktop, "..", "web");
const DEV_URL = "http://localhost:5173";

// Vite (strictPort 5173) + Electron pointed at it; main spawns the bridge via `bun run`.
const vite = Bun.spawn(["bunx", "--bun", "vite"], {
  cwd: webDir,
  stdio: ["ignore", "inherit", "inherit"],
});

const waitForServer = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(DEV_URL)).ok) return;
    } catch {
      // server not up yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Vite did not start on ${DEV_URL}`);
};

try {
  await bundleElectron();
  await waitForServer();
  const electronBin = (await import("electron")).default as unknown as string;
  const app = Bun.spawn([electronBin, desktop], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PEGO_DEV_URL: DEV_URL },
  });
  await app.exited;
} finally {
  vite.kill();
}
