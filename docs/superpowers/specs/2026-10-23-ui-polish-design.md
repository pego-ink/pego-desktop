# UI polish skill (always on) and polish checks in check_layout

Decided with the user on 2026-10-23.

## Intent

The user finds agent-made designs "still very unpolished". Reviewing two agent-made documents in the running
editor (`design/pego-website`, and `design/we-ui`, a clinic queue dashboard an agent built on 2026-10-23) shows
concrete, repeatable defects:

- Nested radii that are not concentric (a 32px circle avatar inside an 8px-radius box with 8px padding; a
  6px-radius button in the corner of a 10px-radius card with 16px padding).
- Icons too thin next to semibold text (14px lucide icons beside 12-13px weight-600 labels in status chips and a
  "Semua jadwal →" link). Pego draws every lucide icon with a stroke of 2 on its 24px grid, scaled with the icon,
  so the rendered stroke is `size / 12`: 14px → 1.17px, 16px → 1.33px, 18px → 1.5px, 24px → 2px.
- Every card has a firm 1px border, so surfaces look flat. (Not a defect to fix: the `clinical-light` preset the
  agent picked asks for exactly that. See decision 1 below.)
- Cards in one row end at different heights (one KPI card has a bigger number).
- Lopsided padding on a painted panel (`[20, 20, 4, 20]`: the last row hugs the bottom edge).
- Big numbers with the unit in the same text at the same size ("3 pasien", "21 mnt"), which reads clunky.
- Grey skeleton bars left as content in a product mockup.

`check_layout` on the we-ui dashboard returns "No layout issues found". The agent's verify loop (screenshot +
check_layout, "fix every error and warning") therefore never sees these problems. A text skill alone is not
enough; the checks must surface them too.

The source is the `better-ui` skill by Jakub Krehel (MIT,
https://github.com/jakubkrehel/skills/tree/d01493b0a7b976a74bfcedc80c783d60c7995910/skills/better-ui), adapted to
Pego's static canvas and its props. Pego is MIT too.

## Goals

1. A skill `ui-polish` that applies to every design in every backend, like `core`: the panel with BYOK, the panel
   through Claude Code, and Claude Code in a terminal over MCP.
2. `check_layout` reports the polish defects above that can be detected reliably, so the agent fixes them while
   verifying.

## Non-goals

- better-ui's motion and CSS rules (transitions, press scale, stagger, reduced motion, `will-change`, hover media
  query, overscroll, theme-switch). The canvas is static and the exporter is out of scope.
- An icon stroke-width prop. That is a schema change (hot spot); it can be proposed separately.
- Ports of the other `better-*` skills (typography, accessibility, layout, colors).
- Auto-fixing. check_layout reports; the agent fixes with its normal tools.
- Changing how surfaces are separated (border, shadow, tonal layers, hard offset). That belongs to the style
  presets and design skills, which this change does not edit.

## Anti-goals

- **False positives.** A polish warning on a correct design makes the agent "fix" good work or learn to ignore
  check_layout. Every new check is conservative: when a case is ambiguous, report nothing.
- **Sameness.** The skill must not push one look (for example a shadow on every card); a style that is
  deliberately flat stays flat. Consistency within one design is the rule.
- **Prompt-cache breakage.** System prompts stay byte-identical across runs. Skill text keeps going in the user
  turn, as `skillsBlock` does today.

## Decisions

### 1. Style first, polish second (decided by the user)

The style preset (and the design skill) decide the surface treatment: borders, shadows, tonal layers or a hard
offset. `ui-polish` only keeps that treatment consistent and handles the details that do not depend on style.
`core`, the dashboard skill and the 20 style presets are not changed. Where `ui-polish` would disagree with them,
it says nothing: it has no rule about mono numbers and no rule that prefers shadows over borders.

### 2. Always-on mechanism

- `Skill.core` may be true on more than one skill. Add `coreSkills()` (all core skills, registry order: `core`,
  then `ui-polish`) next to `coreSkill()` in `packages/agent/src/skills/index.ts`. `coreSkill()` keeps returning
  the `core` skill (used by `get_guidelines` legacy topics).
- `resolveRunSkills` (`apps/web/src/agent/run-skills.ts`) puts every core skill first, then design, then style.
  BYOK runs get both texts through `skillsBlock`; Claude Code panel runs get both ids through `skillPromptPrefix`.
- Prompts that name `core` today name `ui-polish` with it: `WORKING_RULES` step 2 and `CLAUDE_CODE_SYSTEM` step 1
  in `packages/agent/src/prompts.ts` (the MCP server instructions come from `CLAUDE_CODE_SYSTEM`), and the three
  prompts in `apps/bridge/src/mcp-prompts.ts`. The strings stay constant.
- Everything that filters out `core` (skill chip, mentions, `suggestSkills`, `list_skills` category "core", MCP
  resource description) already handles any number of core skills; `ui-polish` shows up there as core.
- Tests: `system-skills.test.ts` changes "exactly one core skill" to "the core skills are `core` and `ui-polish`,
  with no keywords and no styles". Both keep the core content bound (2000 to 3300 bytes), because they ride along
  on every run.

### 3. Skill content (`packages/agent/src/skills/system/ui-polish.ts`)

A header comment names the source URL above, "Adapted from better-ui, Copyright (c) 2026 Jakub Krehel, MIT
License". Text in English like the other skills, no em dashes, Pego props and tools only. Rules, with exact
values:

- **Concentric corners.** When a child with a radius sits in its parent's corner at an even inset of 24px or less,
  the parent radius = child radius + padding (+ uniform stroke width). A circle or pill child in a rounded box:
  give the box that radius plus the padding, or make the box a pill too. Past 24px of inset, each surface keeps
  its own radius token.
- **Optical alignment.** A button with a leading icon gets 2px less padding on the icon side (`[v, 16, v, 14]`); a
  trailing icon mirrors it. Shift a play triangle 1 to 2px toward its point with padding on its container, never
  with x/y inside a flex frame.
- **One treatment per kind of surface.** The style decides how surfaces separate (border, shadow, tonal layer,
  hard offset); every surface of the same kind (all cards, all panels, all inputs) then gets the same treatment.
  Where the style lifts a surface with a soft shadow, use a layered ring instead of one big blur. Light: `effects`
  = `[{shadow #0000000F, x 0, y 0, blur 0, spread 1}, {shadow #0000000F, x 0, y 1, blur 2, spread -1},
{shadow #0000000A, x 0, y 2, blur 4, spread 0}]`. Dark: one ring `{shadow #FFFFFF14, x 0, y 0, blur 0, spread 1}`.
- **Image edges.** Photos (image nodes and image fills with content) get `stroke: {color: "#0000001A", width: 1}`
  on light surfaces and `#FFFFFF1A` on dark. Never a tinted neutral or the accent. Skip logos and transparent
  illustrations. (Builder's call, settled: Pego draws a uniform width centered on the edge, and image nodes have
  no effects, so this is a centered 1px edge; the half pixel outside is invisible at 10% alpha. The renderer is
  not changed.)
- **Icons beside text.** Size by the text's weight, since the stroke is `size / 12`: next to 400 to 500 text use
  an icon of about 1.25x the font size (at least 16); next to 600 or bolder use at least 16, and 18 to 20 beside
  14 to 16px text. One icon set per surface. State comes from the icon fill variable (`$text-muted` default,
  `$accent` or `$text` active), never a different icon.
- **Rows of cards end together.** Cards in one horizontal row get `height: "fill_container"` (the row hugs and
  takes the tallest card); never a guessed fixed height.
- **Padding per axis is symmetric** on a painted container (top = bottom, left = right), except where a divider
  or header edge is the reason.
- **Units beside big numbers.** A unit next to a large number ("21 mnt", "3 pasien") is a separate, smaller
  text in `$text-muted`, aligned to the number's baseline. The font of the number stays whatever the design skill
  and style say.
- **No visual placeholders.** No grey skeleton bars in mockups or product shots; build small real content.
- **Verify.** `get_screenshot` at scale 2 on corners, buttons and icon-text pairs, then `check_layout`.

Checklist of 6 to 8 items mirroring the rules. If the text cannot fit 3300 bytes, trim wording, not rules.

### 4. Polish checks in check_layout (`packages/agent/src/inspect/check-layout.ts`)

New checks in `checkNode`, each with a hint that names the fix in Pego props. `warning` for the high-confidence
ones (the working rules make agents fix every error and warning). Instance children get the existing
`INSTANCE_HINT` suffix.

| Check                           | Condition (all must hold)                                                                                                                                                                                       | Severity |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Inner corner rounder than outer | Frame P with radius rp > 0 and flex layout; child C with radius rc > rp; C's box touches one of P's inner corners (both edges within 0.5px); the two paddings meeting at that corner are equal and ≤ 24         | warning  |
| Corner not concentric           | Same as above but rc ≤ rp, the padding p ≤ 24 (the same limit as the skill rule), and rp differs from rc + p (+ uniform stroke width) by more than 2                                                            | info     |
| Thin icon beside bold text      | Icon width < 16 and its neighbour in the same flex frame's children (previous or next) is text with fontWeight ≥ 600                                                                                            | warning  |
| Row of cards ends unevenly      | Horizontal flex frame with ≥ 2 children, every child a painted frame (fill or stroke) or an instance of one; none has height `fill_container`; alignItems start or unset; child heights differ by more than 2px | warning  |
| Lopsided padding                | Frame with a fill or a uniform stroke (per-side strokes are dividers and are skipped); top and bottom (or left and right) are both > 0, the larger is at least 2x the smaller and at least 8px more             | warning  |

Also fix one existing false positive: the "circular" fill_container check fires on a horizontal row whose
children all have `height: "fill_container"`, which is the equal-heights idiom (`computeLayout` pass 3 stretches
cross-axis fill children to the tallest; the exporter emits `align-self: stretch`). On the cross axis of a flex
frame, report only when the resulting size is 0 (the existing error case). The main axis keeps today's behavior.

A polish issue inside component instances is reported once per component source node (the part of the render id
after the last `/`), not once per instance, so one defect in a row component does not fill the 50-issue cap.
(My call: the fix is in the component either way.)

Expected results, used as acceptance criteria and as the regression fixture:

- `design/we-ui` dashboard: 5 warnings. User card (inner corner rounder than outer), the "Semua jadwal" link and
  the Queue Row status chip (thin icon beside bold text, the chip once), KPI Row (ends unevenly), Doctor Panel
  (lopsided padding).
- `design/pego-website`: info "corner not concentric" on the three pricing tier cards (6px button in the corner
  of a 10px card with 16px padding); no warnings.

Tests in `packages/agent/src/inspect/inspect.test.ts`: a positive and a negative case per check, the cross-axis
stretch case, the instance de-duplication, and a regression fixture modeled on the we-ui KPI row, doctor panel,
status chip and user card that must produce exactly the expected issues.

### 5. Delivery

- Local branch `feat/ui-polish` from `dev`. No push or PR until the user asks.
- Commits with scopes, for example `feat(agent): ui-polish skill, always on` and
  `feat(agent): polish checks in check_layout`.
- Done means `bun run typecheck`, `bun run lint` and `bun run test` pass, and in the Electron dev app:
  check_layout on `design/we-ui` and `design/pego-website` lists the expected polish issues without a flood of
  false ones, and a fresh agent run of a dashboard brief comes out with concentric corners, even card rows and
  icon sizes that follow the rule.
- No hot spot is touched (`schema.ts`, `ops.ts`, `tools.ts`, root `package.json`). No new tool, so no new
  annotations.

## Left to the builder

- The skill's exact wording within the 3300-byte bound, and its checklist wording.
- Whether prompt strings list `ui-polish` literally or build it from a constant (they must stay constant
  either way).
- How "touches the inner corner" and "neighbour" are computed from layout boxes and children order, within the
  conditions above.
