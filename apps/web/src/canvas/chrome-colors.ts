/**
 * Canvas chrome palette. Skia cannot read CSS variables, so these mirror the tokens in
 * `packages/ui/src/styles/globals.css` (bubblegum = the human, grape = the agent).
 */

/** Selection, handles, hover and marquee: bubblegum, the same in both themes. */
export const SELECTION = "#FF6FB5";

/** Text on the selection size pill. */
export const SELECTION_LABEL_TEXT = "#FFFFFF";

/** Marquee fill: bubblegum at about 10% alpha. */
export const MARQUEE_FILL = "#FF6FB51A";

/** Handle square fill. */
export const HANDLE_FILL = "#FFFFFF";

/** Agent accent (focus, cursor) per theme. */
export const AGENT_ACCENT = { dark: "#7B5CFF", light: "#5B2EFF" } as const;

/** Frame caption colors per theme: plain, hovered, components and instances. */
export const CAPTION_COLORS = {
  dark: { frame: "#A09FAE", hover: "#F2F1F7", component: "#9B80FF" },
  light: { frame: "#6B6489", hover: "#1E1048", component: "#5B2EFF" },
} as const;
