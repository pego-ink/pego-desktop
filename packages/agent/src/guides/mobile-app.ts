import type { Guide } from "./types";

export const mobileAppGuide: Guide = {
  id: "mobile-app",
  title: "Mobile app screens",
  description:
    "Screen frame, status bar, content wrapper, tab bar, touch targets and one-handed hierarchy for 390px screens.",
  content: `# Mobile app screens

## Screen frame
- Top-level frame 390 wide, layout vertical, height fit_content (let content decide; a typical screen lands near 844). clip: true, fill $bg, cornerRadius 0 (or 40 if you want a device look).
- Several screens of one flow sit side by side: find_empty_space with direction right, padding 80, and keep the same y.

## Anatomy, top to bottom
1. Status bar: a horizontal frame, height 54-62, time on the left and system icons on the right (icon nodes such as signal, wifi, battery), $text. Nothing of the app sits behind it.
2. Content wrapper: one vertical frame, width fill_container, padding [0, 20, 24, 20], gap 24 between sections and 12 between related items. Padding is set once here, not per section.
3. Tab bar (optional, 3-5 destinations): the last child of the screen, not absolutely positioned. A horizontal frame with a $surface fill, cornerRadius 28-32, padding 6, margin simulated by wrapper padding [0, 16, 12, 16]. Each item is a vertical frame (icon 22px over a 10-11px label), selected item uses $accent and a $surface-2 pill.

## Rules
- One primary intent per screen; the title and the first element answer "where am I" and "what can I do here".
- Same title size on every screen of the app (28-32, weight 600-700).
- Touch targets are at least 44px tall; buttons are 48-52 tall, width fill_container for the main action.
- Keep key actions in the lower half of the screen.
- Body text 15-17px, secondary 13px, never below 11px.
- Lists: rows of 56-72px with leading icon or avatar, title + one secondary line, trailing value or chevron icon (chevron-right). Rows share one component.
- Do not wrap every element in a card. Group with spacing; use a $surface container only where it holds interactive content.
- Show real content states: a populated list, plus an empty state variant when it matters.

## Spacing scale
4, 8, 12, 16, 20, 24, 32. Use $space-* variables when the style defines them.`,
};
