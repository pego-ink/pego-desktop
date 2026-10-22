import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Bundle main + sandboxed preload to CommonJS (Electron loads them without node_modules). */
export const bundleElectron = async (): Promise<void> => {
  for (const name of ["main", "preload"]) {
    const result = await Bun.build({
      entrypoints: [join(root, "src", `${name}.ts`)],
      outdir: join(root, "dist"),
      target: "node",
      format: "cjs",
      external: ["electron"],
      naming: `${name}.cjs`,
      sourcemap: "none",
      minify: false,
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`bundling ${name} failed`);
    }
  }
};

if (import.meta.main) await bundleElectron();
