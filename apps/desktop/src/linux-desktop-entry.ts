/**
 * Linux AppImage launcher entry. Desktops find a window's icon through the .desktop file named
 * after its app id ("pego", from desktopName in package.json); on Wayland that is the only way.
 * deb/rpm/pacman packages install one, an AppImage does not, so the dock showed a generic icon.
 * Run as an AppImage, Pego writes its own pego.desktop and icon into the user's data folder and
 * keeps Exec pointing at the AppImage (it may be moved).
 */

/** Marks the entry as Pego's own, so it may be updated; a user's own pego.desktop is left alone. */
export const ENTRY_MARKER = "X-Pego-AppImage=true";

/** The launcher entry for the AppImage at `appImage`. */
export const desktopEntry = (appImage: string): string =>
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Pego",
    "Comment=AI-native design editor",
    `Exec="${appImage.replace(/(["`$\\])/g, "\\$1")}" %U`,
    "Icon=pego",
    "Terminal=false",
    "Categories=Graphics;2DGraphics;VectorGraphics;",
    "Keywords=design;editor;canvas;ai;",
    "StartupWMClass=pego",
    ENTRY_MARKER,
    "",
  ].join("\n");

export type EntryPlan = "write" | "keep" | "skip";

/**
 * What to do with the user's pego.desktop: nothing outside an AppImage or when a package installed
 * one system-wide (and Pego never wrote its own); never touch a user-made one; rewrite Pego's own
 * only when it changed (the AppImage moved, a newer entry).
 */
export const planEntry = (options: {
  appImage: string | undefined;
  existing: string | null;
  systemEntry: boolean;
}): EntryPlan => {
  const { appImage, existing, systemEntry } = options;
  if (!appImage) return "skip";
  if (existing !== null && !existing.includes(ENTRY_MARKER)) return "skip";
  if (existing === null && systemEntry) return "skip";
  return existing === desktopEntry(appImage) ? "keep" : "write";
};
