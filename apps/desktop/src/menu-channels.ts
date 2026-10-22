/** Native menu commands forwarded to the page (main -> renderer only). */
export const MENU_COMMAND_CHANNEL = "pego:menu:command";

export const MENU_COMMANDS = ["select-all", "close-tab"] as const;
export type MenuCommand = (typeof MENU_COMMANDS)[number];

export const isMenuCommand = (value: unknown): value is MenuCommand =>
  typeof value === "string" && (MENU_COMMANDS as readonly string[]).includes(value);
