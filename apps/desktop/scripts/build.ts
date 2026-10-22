import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { bundleElectron } from "./bundle";

const desktop = join(import.meta.dir, "..");
const repo = join(desktop, "..", "..");

const run = async (cmd: string[], cwd: string, env?: Record<string, string>): Promise<void> => {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${code}`);
};

// Args after the script go straight to electron-builder; default is a local arm64 build.
const forwarded = Bun.argv.slice(2);
const args = forwarded.length > 0 ? forwarded : ["--mac", "--arm64"];
const archs = (["arm64", "x64"] as const).filter((arch) => args.includes(`--${arch}`));
if (archs.length === 0) throw new Error("pass --arm64 and/or --x64");

console.log("== web build");
await run(["bunx", "--bun", "vite", "build"], join(repo, "apps", "web"));

console.log("== bundle main/preload");
await rm(join(desktop, "dist"), { recursive: true, force: true });
await bundleElectron();

console.log("== compile bridge");
await mkdir(join(desktop, "resources"), { recursive: true });
for (const arch of archs) {
  await run(
    [
      "bun",
      "build",
      "--compile",
      `--target=bun-darwin-${arch}`,
      join(repo, "apps", "bridge", "src", "index.ts"),
      "--outfile",
      join(desktop, "resources", `pego-bridge-${arch}`),
    ],
    repo,
  );
}

console.log("== electron-builder");
await rm(join(desktop, "release"), { recursive: true, force: true });
await run(["bunx", "electron-builder", ...args], desktop);
