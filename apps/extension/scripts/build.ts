/**
 * Build the extension into dist/ (load it in chrome://extensions with "Load unpacked"):
 * the popup, the service worker and the picker are bundled; capture-page.js and
 * capture-picked.js are Pego's own page snapshot script (the one the desktop app's browser runs),
 * written out as plain files because MV3 extensions cannot evaluate code strings.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { snapshotScript } from "../../web/src/browser/page-scripts";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const bundle = async (files: string[], format: "esm" | "iife") => {
  const built = await Bun.build({
    entrypoints: files.map((file) => join(root, "src", file)),
    outdir: dist,
    target: "browser",
    format,
    minify: true,
  });
  if (!built.success) {
    for (const log of built.logs) console.error(log);
    process.exit(1);
  }
};
// The popup and the service worker are modules; the picker is injected into pages, possibly
// more than once, so it is wrapped in a function (no top-level names to clash).
await bundle(["popup.ts", "background.ts"], "esm");
await bundle(["picker.ts"], "iife");

// The script's value (its last expression) is what chrome.scripting.executeScript returns.
await writeFile(join(dist, "capture-page.js"), `${snapshotScript({ kind: "full-page" })};\n`);
await writeFile(join(dist, "capture-picked.js"), `${snapshotScript({ kind: "selection" })};\n`);
await cp(join(root, "src", "manifest.json"), join(dist, "manifest.json"));
await cp(join(root, "src", "popup.html"), join(dist, "popup.html"));
console.log(`Built the Pego extension into ${dist}`);
