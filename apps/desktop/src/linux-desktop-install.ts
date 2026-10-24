import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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

const readBytesOrNull = (file: string): Buffer | null => {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
};

/**
 * Install (or refresh) the launcher entry and icon when running as an AppImage. Best effort: a
 * failure only costs the dock icon. `iconPath` is the app's 1024px icon. The icon is rewritten
 * whenever it differs from the installed one (a new AppImage with a new logo, even at the same
 * path), and the icon theme folder is touched so GNOME reloads it: it rescans a theme only when
 * that folder's time changes, so a file overwritten in place keeps showing the old picture.
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
    if (plan === "skip" || !env.APPIMAGE) return;
    // The entry names the icon: without one there is nothing to fix, so neither is written.
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    const theme = join(data, "icons", "hicolor");
    const iconDir = join(theme, "512x512", "apps");
    const iconFile = join(iconDir, "pego.png");
    const png = icon.resize({ width: 512 }).toPNG();
    if (!readBytesOrNull(iconFile)?.equals(png)) {
      mkdirSync(iconDir, { recursive: true });
      writeFileSync(iconFile, png);
      const now = new Date();
      utimesSync(theme, now, now);
    }
    if (plan !== "write") return;
    mkdirSync(join(data, "applications"), { recursive: true });
    writeFileSync(entryFile, desktopEntry(env.APPIMAGE));
  } catch (error) {
    console.warn("[desktop entry]", error);
  }
};
