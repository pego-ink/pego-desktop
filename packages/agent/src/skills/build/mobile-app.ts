import type { Skill } from "../types";

export const mobileAppSkill: Skill = {
  id: "mobile-app",
  title: "Mobile app",
  description:
    "390x844 app screens: safe areas, status bar, tab bar, thumb-reachable actions, list rows, one intent per screen.",
  keywords: [
    "mobile app",
    "ios app",
    "android app",
    "app screen",
    "onboarding screen",
    "mobile screen",
    "iphone",
    "aplikasi mobile",
    "aplikasi hp",
    "layar aplikasi",
    "tampilan mobile",
    "desain aplikasi android",
  ],
  styles: ["soft-bento", "nordic-calm", "warm-craft", "playful-rounded", "quiet-ink"],
  content: `# Mobile app

## Intent
Screens that read in two seconds and work with one thumb. One primary intent per screen; the first elements answer "where am I" and "what can I do". Success: consistent chrome across screens, reachable key actions, real content, nothing hidden behind the status bar or home indicator.

## Workflow
1. get_selection / get_document; reuse variables and components, else list_styles / get_style (prefer this skill's styles).
2. List the flow's screens (3-5) and each one's single intent before drawing.
3. find_empty_space direction right, padding 80; all screens of a flow share y and size 390 x 844.
4. Build the chrome (status bar, tab bar) once as components, then fill content. Rows, buttons, chips, list items are components with overrides.
5. get_screenshot + check_layout per screen; compare screens side by side for identical title size and padding. focus_nodes at the end.

## Screen recipe
- Frame: 390 x 844, vertical, clip true, fill $bg, cornerRadius 0 (40 only for a device look).
- Status bar: row, height 59 (safe top), time left, signal / wifi / battery icons right, 15-17 weight 600. Nothing app-related behind it.
- Content wrapper: vertical, fill_container, padding [0, 20, 24, 20], gap 24 between sections, 12 between related items. Padding is set once here. Use wrapper gap and padding, never spacer frames.
- Large title 28-32 / 700, identical on every screen; section header 17-20 / 600; body 15-17 / lineHeight 1.4; secondary 13-14; caption never under 11-12.
- Tab bar: last child of the screen, height 83 (49 bar + 34 home-indicator safe area), 3-5 items, icon 24 over 10-11 label; selected uses $accent and a filled icon, others $text-muted. Either full-width bar with 1px $border top, or inset capsule (inset 16 sides, 12 bottom, radius = half height). Pick one and keep it.
- Stack tail: primary button height 52, fill_container, radius 12-14, sits above the tab bar or the 34 home safe area.

## Components and lists
- List row: height 56-72, leading icon 24 or avatar 40, title 16 + one secondary line 13, trailing value or chevron-right; 1px $border divider inset 20 or none. Touch targets >= 44.
- Chips height 32-36, segmented controls 36-40, inputs height 48-52 with label above.
- Sheets: top radius 24, grabber 36x5, padding 20. Dialogs max 2 actions.
- Group by spacing; use a $surface container only for grouped interactive content (settings group radius 12-16). Not every element in a card.

## Banned
Content under the status bar or home indicator; tab bar absolutely positioned; tiny 10px body text; icon-only primary actions; five tabs of equal weight with no selected state; floating action button plus tab bar plus bottom sheet all at once; glass blur on everything; gradient hero cards; emoji as icons; stock illustration blobs; fake avatars of real-looking people (use initials); inconsistent radii; "Welcome back!" filler.

## Copy
Short: titles 1-3 words, button labels verbs ("Bayar sekarang", "Simpan alamat"), list titles real nouns. Prompt language, sentence case, no em dashes. Show a populated state, add empty/error variant when the flow needs it.`,
  checklist: [
    "Frame is 390 wide; status bar 59 and tab bar 83 (or home safe area 34) respected",
    "Padding set once on the wrapper; horizontal margins identical across screens",
    "Title size and weight identical on every screen of the flow",
    "Touch targets >= 44px; primary action reachable in the lower half",
    "Body text >= 15px, secondary >= 13px, nothing below 11px",
    "Contrast >= 4.5:1 for text, selected tab state distinguishable without color alone",
    "Rows and chrome are components shared by all screens; check_layout is clean",
    "Real content in lists; initials for avatars; no emoji icons or invented stats",
    "One radius scale (8 / 12-16 / pill only for chips and capsule tab bar)",
  ],
};
