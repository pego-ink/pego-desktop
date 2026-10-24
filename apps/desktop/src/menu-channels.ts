/** Native menu commands forwarded to the page (main -> renderer only). */
export const MENU_COMMAND_CHANNEL = "pego:menu:command";

export const MENU_COMMANDS = ["select-all", "close-tab"] as const;
export type MenuCommand = (typeof MENU_COMMANDS)[number];

export const isMenuCommand = (value: unknown): value is MenuCommand =>
  typeof value === "string" && (MENU_COMMANDS as readonly string[]).includes(value);

/**
 * Close Tab pressed while a page in the built-in browser has focus: Cmd+W on macOS, Ctrl+W
 * elsewhere, nothing else held.
 */
export const isCloseTabKey = (
  input: {
    type: string;
    key: string;
    control: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
  },
  platform: NodeJS.Platform,
): boolean =>
  input.type === "keyDown" &&
  input.key.toLowerCase() === "w" &&
  !input.shift &&
  !input.alt &&
  (platform === "darwin" ? input.meta && !input.control : input.control && !input.meta);
