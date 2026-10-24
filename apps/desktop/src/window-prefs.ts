import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isTitleBarMode, type TitleBarMode } from "@/window-chrome";

/** The saved title bar mode; "pego" when the file is missing or unreadable. */
export const readTitleBarMode = (file: string): TitleBarMode => {
  try {
    const saved = (JSON.parse(readFileSync(file, "utf8")) as { titleBar?: unknown }).titleBar;
    return isTitleBarMode(saved) ? saved : "pego";
  } catch {
    return "pego";
  }
};

/** Save the title bar mode; it applies to windows created after this (the next start). */
export const writeTitleBarMode = (file: string, mode: TitleBarMode): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ titleBar: mode }, null, 2)}\n`);
};
