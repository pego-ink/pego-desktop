# Editor UI revamp to the pego.pen design system

Source of truth: `design/pego.pen`, frames "12 — UI Principles", "13 — UI Tokens", "14 — UI Components",
"15 — Agent Patterns" and "New UI — 01..12". Exported PNGs of those frames are the visual reference.

## Intent

Re-skin the existing editor to the new design. Same features, same behavior; new tokens, type, radii and
the agent patterns' look. "Quiet chrome, joyful moments": the chrome stays calm grape-tinted neutral so
the canvas shines; saturated color appears only when it means something.

## Rules (from UI Principles / Tokens)

- **Grape is the agent, bubblegum is you.** Agent ghosts, cursors, plans, run labels, primary actions use
  grape (`primary`, `violet`, `violet-soft`, `violet-text`). Your selection, your messages and handles use
  bubblegum (`human`, `human-soft`, `human-text`).
- **Components never use raw hex.** Use the tokens in `packages/ui/src/styles/globals.css`
  (`chrome` top bar and rail, `canvas` backdrop, `background`/`card` panels, `muted`/`secondary` raised
  inputs and cards, `border`, `foreground`, `muted-foreground`, `subtle-foreground` hints, `warning` for
  "needs your decision" / paused, `success`, `destructive`). Skia cannot read CSS variables: canvas chrome
  colors live in one module that mirrors the tokens per theme.
- **Dense, never cramped.** 13 px UI text (`text-[13px]`), section titles 14 semibold, panel titles 15
  semibold. Values (numbers, hex, ids, paths, tool names, shortcuts) 12 px mono; uppercase labels
  ("PLAN", "PAGES", "LAYERS", "JUSTIFY") 10-11 px mono with letter spacing, `subtle-foreground`.
- **Radius scale:** 6 input (`rounded-md`), 8 button (`rounded-lg`), 12 card (`rounded-xl`), 14 panel
  (`rounded-2xl`), full pill. 4 px spacing grid.
- **Fonts:** Geist (sans) and JetBrains Mono (mono), self-hosted through `@fontsource-variable`.

## Layout decisions

- Canvas toolbar: vertical, floating, left edge by default (Settings › General › Toolbar position still
  switches it). Zoom control bottom right.
- Top bar: undo/redo left, panel toggle + present + Share (primary grape button) right.
- Icon rail on `chrome`, active item `violet-soft` with `violet-text` icon.
- Layers: selected row `human-soft` with `human-text`; pages list selected row `violet-soft`.
- Canvas selection outline, handles, hover and size pill: bubblegum. Size pill and frame/agent labels use
  mono text. Agent focus, ghost and the first run color: grape.

## Agent patterns

- User message: `human-soft` bubble, `rounded-xl`, skill chips inside.
- Plan card: `muted` card `rounded-xl`, "PLAN" mono label + `n / m` mono counter in `violet-text`; done
  steps success check, active step grape spinner and semibold, pending steps `subtle-foreground`. Whole
  card border turns success when all steps are done.
- Tool call rows: collapsible "n tool calls" header; rows are a status icon, mono tool name in
  `violet-text`, mono args in `subtle-foreground`.
- Working bar: `violet-soft` bar `rounded-xl`, grape spinner, "Designing…" in `violet-text`, mono timer,
  stop button.
- Decision card (ask_user): `warning` border `rounded-2xl`, "Needs your decision" + mono "run paused";
  options numbered, the focused one `violet-soft` with a grape border; mono key hints in the footer.
- Changes bar: "n changes" + Undo all + Review, `muted` card `rounded-xl`.
- Queue: "QUEUED · n" mono label, rows with edit/remove/"Send now" (grape, small).
- Composer: `muted` box `rounded-2xl`, footer chips (agent, variants, skill) as small `rounded-lg` chips.

## Non-goals

- No new features. Screens in the design that show features the app does not have (e.g. providers that
  do not exist) are not built; only the look of existing features changes.
- No behavior changes, no store or protocol changes beyond the toolbar default.
- The changelog site (`apps/changelog`) keeps its own styles.
