import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nativeImage } from "electron";
import { desktopEntry, planEntry } from "@/linux-desktop-entry";

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * Install (or refresh) the launcher entry and icon when running as an AppImage. Best effort: a
 * failure only costs the dock icon. `iconPath` is the app's 1024px icon.
 */
export const installAppImageEntry = (iconPath: string, env = process.env): void => {
  if (process.platform !== "linux") return;
  try {
    const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const entryFile = join(data, "applications", "pego.desktop");
    const plan = planEntry({
      appImage: env.APPIMAGE,
      existing: readOrNull(entryFile),
      systemEntry: ["/usr/share/applications", "/usr/local/share/applications"].some((dir) =>
        existsSync(join(dir, "pego.desktop")),
      ),
    });
    if (plan !== "write" || !env.APPIMAGE) return;
    const iconDir = join(data, "icons", "hicolor", "512x512", "apps");
    mkdirSync(iconDir, { recursive: true });
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty())
      writeFileSync(join(iconDir, "pego.png"), icon.resize({ width: 512 }).toPNG());
    mkdirSync(join(data, "applications"), { recursive: true });
    writeFileSync(entryFile, desktopEntry(env.APPIMAGE));
  } catch (error) {
    console.warn("[desktop entry]", error);
  }
};
