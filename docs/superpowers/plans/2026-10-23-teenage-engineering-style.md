# Teenage Engineering Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `field-instrument` style preset and the `teenage-engineering` style skill so Pego's agent can design
dashboards, landing pages and social posts in teenage engineering's instrument-panel language, light and dark.

**Architecture:** One preset (light tokens, fonts, scale) in `packages/agent/src/styles/presets.ts`; one style skill
(vocabulary, hardware to UI mapping, black edition token swap, recipes) in the digital movement group. No renderer,
schema or font-loader changes. Tests pin the spec's values; a dev-app run checks the result on the canvas.

**Tech Stack:** TypeScript (strict), Bun test, Zod variables schema from `@pego/doc`, Pego MCP tools for the dev-app
check.

**Spec:** `docs/superpowers/specs/2026-10-23-teenage-engineering-style-design.md` (approved 2026-10-23). Read it
first; this plan does not repeat its prose.

## Global Constraints

- Branch: `git switch -c feat/te-style` from the current `feat/ui-polish` HEAD. Local commits only; never push, never
  open a PR. Never stage `design/pego-website/project.pego`, `design/ig-post/`, `design/we-ui/` or `.superpowers/`.
- Commits: Conventional Commits with a scope (`feat(agent): ...`, `docs(changelog): ...`), ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `bun run format` before each commit.
- Code style: arrow functions, `import type` for types, Prettier (double quotes, semicolons, 100 columns).
- Preset and skill text in English; Indonesian only in `keywords`. No em dash (`—`) in skill `content` or
  `description`; en dashes in model numbers (`TP–01`) are fine.
- Fonts: exactly Noto Sans JP (heading, body) and Doto (mono). Skill `Fonts:` line: `Fonts: Noto Sans JP, Doto`.
- Generated designs never show a TE logo, wordmark, product name or photo; the brand is named only inside the skill.
- Skill content 2500 to 4800 bytes (UTF-8: each katakana and en dash is 3 bytes). Over budget: cut in the spec's
  order (Essence, Pitfalls, Pair with, ridge ticks and dot bars); never cut Black edition, Hardware to UI or recipes.

## Review Focus

- An Indonesian prompt naming TE ("dashboard aplikasi ala teenage engineering", "kayak op-1") picks the TE skill,
  and a prompt that only says "engineering" picks no style. Pinned in Task 2, Step 1 (`select.test.ts`).
- A dark request stays on `field-instrument` plus the black edition swap, and the swap passes the preset contrast
  rules. Pinned in Task 2, Step 1 (`teenage-engineering.test.ts`).
- The skill's `Fonts:` line drifts from the preset's fonts. Pinned in Task 2, Step 1.
- Keys at a panel corner trip the ui-polish concentric-corner warning. Pinned in Task 1, Step 1
  (`radius-sm + space-sm = radius-lg`) and checked with `check_layout` in Task 4.
- Fonts fall back to Inter, or Noto Sans JP (9.6 MB) loads too slowly on first use. Checked by screenshot in Task 4.

---

### Task 1: Preset `field-instrument`

**Files:**

- Modify: `packages/agent/src/styles/presets.ts` (append after `sunlit-pastel`, before the closing `];` at line 855)
- Modify: `packages/agent/src/styles/presets.test.ts:8-29,71-73`
- Modify: `packages/agent/src/inspect/inspect.test.ts:1132`
- Add to the commit: the spec and this plan (`docs/superpowers/specs/2026-10-23-teenage-engineering-style-design.md`,
  `docs/superpowers/plans/2026-10-23-teenage-engineering-style.md`)

**Interfaces:**

- Produces: a `StylePreset` with `name: "field-instrument"`, reachable through `findStyle("field-instrument")`,
  `list_styles` and `get_style`. Task 2 reads its `fonts` and its color token names.

- [ ] **Step 1: Write the failing tests**

In `presets.test.ts`: append `"field-instrument"` to `EXPECTED_IDS`; in the first test replace the hard-coded `20`
with `EXPECTED_IDS.length` and rename it "exactly the expected ids, unique, findable". Add:

```ts
test("field-instrument carries the official TE palette and the agreed fonts", () => {
  const style = findStyle("field-instrument")!;
  const v = (name: string) => style.variables[name]?.value;
  expect(style.title).toBe("Field Instrument");
  expect(style.fonts).toEqual({ heading: "Noto Sans JP", body: "Noto Sans JP", mono: "Doto" });
  expect(style.weights).toEqual({ heading: [200, 300], body: [300, 400, 500], mono: [700, 900] });
  expect(style.typeScale).toEqual({
    caption: 11,
    body: 15,
    lead: 18,
    h3: 22,
    h2: 32,
    h1: 48,
    display: 88,
  });
  expect(
    [
      "bg",
      "surface",
      "surface-2",
      "border",
      "text",
      "text-muted",
      "accent",
      "on-accent",
      "danger",
    ].map(v),
  ).toEqual([
    "#F0F0EF",
    "#F5F5F5",
    "#E5E5E5",
    "#CCCCCC",
    "#0F0E12",
    "#4D4D4D",
    "#F05A24",
    "#0F0E12",
    "#B81D13",
  ]);
  expect(["radius-sm", "radius-md", "radius-lg"].map(v)).toEqual([4, 6, 12]);
  expect(["space-xs", "space-sm", "space-md", "space-lg", "space-xl"].map(v)).toEqual([
    4, 8, 12, 24, 48,
  ]);
  // Keys at a panel corner stay concentric for the ui-polish check.
  expect((v("radius-sm") as number) + (v("space-sm") as number)).toBe(v("radius-lg") as number);
  expect(findStyle("Field Instrument")?.name).toBe("field-instrument");
});
```

In `inspect.test.ts:1132` change `toBe(20)` to `toBe(21)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/agent/src/styles/presets.test.ts packages/agent/src/inspect/inspect.test.ts`
Expected: FAIL (`EXPECTED_IDS` mismatch, `findStyle("field-instrument")` undefined, count 20 vs 21).

- [ ] **Step 3: Add the preset in `presets.ts`**

`variables: tokens({...}, { radius: [4, 6, 12], space: [4, 8, 12, 24, 48] })` with the nine colors above. Word
`mood`, `bestFor`, `layout` (grid, density, corners, imagery, icons), `stroke`, `elevation`, `dos` (3+) and `donts`
(2+) from spec Decision 2. They must say: depth is a 2px hard key-travel shadow (y 2, blur 0) and flat tones, no soft
shadows; orange on one control per screen, as a fill with black text, never orange text on light grey; labels
uppercase, tracked, 11px or more; Doto only at 18px or more; blue `#0071BB`, green `#006837`, yellow `#FAB413` only
as encoder caps and LEDs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/agent/src/styles packages/agent/src/inspect/inspect.test.ts`
Expected: PASS, including the existing contrast, font-catalog and accent-distance tests for the new preset.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/styles/presets.ts packages/agent/src/styles/presets.test.ts \
  packages/agent/src/inspect/inspect.test.ts docs/superpowers/specs/2026-10-23-teenage-engineering-style-design.md \
  docs/superpowers/plans/2026-10-23-teenage-engineering-style.md
git commit -m "feat(agent): field-instrument style preset"
```

### Task 2: Style skill `teenage-engineering`

**Files:**

- Create: `packages/agent/src/skills/movements/digital/teenage-engineering.ts`
- Create: `packages/agent/src/skills/movements/digital/teenage-engineering.test.ts`
- Modify: `packages/agent/src/skills/movements/digital.ts` (import, append to `digitalStyles` after
  `editorialMagazineSkill`)
- Modify: `packages/agent/src/skills/movements/digital.test.ts:5-26,32-45` (ten styles)
- Modify: `packages/agent/src/skills/select.test.ts:154-160` (built-in registry cases)

**Interfaces:**

- Consumes: `findStyle("field-instrument")` from Task 1.
- Produces: `export const teenageEngineeringSkill: Skill` (`id: "teenage-engineering"`, `category: "style"`,
  `styles: ["field-instrument"]`), served by `list_skills`, `get_skill`, `suggestStyle` and MCP resources without
  further wiring.

- [ ] **Step 1: Write the failing tests**

`digital.test.ts`: add `"field-instrument"` to `PRESET_IDS`, add `"teenage-engineering"` to the expected ids and
rename the test to "has the ten expected styles".

`select.test.ts`, append to the built-in registry `cases`:

```ts
["dashboard aplikasi ala teenage engineering", "dashboard", "teenage-engineering"],
["landing page kayak op-1 field", "landing-page", "teenage-engineering"],
["post instagram gaya pocket operator", "social-media", "teenage-engineering"],
["dashboard untuk tim engineering", "dashboard", undefined],
```

`teenage-engineering.test.ts` (imports: `variablesSchema` from `@pego/doc`, `contrastBetweenHex` from
`../../../inspect/color`, `findStyle` from `../../../styles/index`):

```ts
const blackEdition = (): Record<string, string> =>
  Object.fromEntries(
    (skill.content.split("\n").find((l) => l.startsWith("Black edition tokens:")) ?? "")
      .slice("Black edition tokens:".length)
      .split(",")
      .map((pair) => pair.trim().split(/\s+/) as [string, string]),
  );

test("suggests only field-instrument and lists its two fonts", () => {
  expect(skill.styles).toEqual(["field-instrument"]);
  const { heading, body, mono } = findStyle("field-instrument")!.fonts;
  expect(heading).toBe(body);
  expect(skill.content.split("\n").filter((l) => l.startsWith("Fonts:"))).toEqual([
    `Fonts: ${heading}, ${mono}`,
  ]);
});

test("black edition swaps every color token and passes the preset contrast rules", () => {
  const dark = blackEdition();
  expect(dark).toEqual({
    bg: "#0F0E12",
    surface: "#272727",
    "surface-2": "#3B3B3D",
    border: "#4D4D4D",
    text: "#F5F5F5",
    "text-muted": "#B2B2B2",
    accent: "#F05A24",
    "on-accent": "#0F0E12",
    danger: "#FF7A6B",
  });
  const preset = findStyle("field-instrument")!;
  const colorKeys = Object.keys(preset.variables).filter(
    (k) => preset.variables[k]?.type === "color",
  );
  expect(Object.keys(dark).sort()).toEqual(colorKeys.sort());
  // same thresholds as presets.test.ts "WCAG contrast": text 7, text-muted 4.5 on bg/surface/surface-2;
  // on-accent on accent 4.5; accent on surface 3
  const swapped = {
    ...preset.variables,
    ...Object.fromEntries(Object.entries(dark).map(([k, value]) => [k, { type: "color", value }])),
  };
  expect(variablesSchema.safeParse(swapped).success).toBe(true);
});

test("has the mapping, the swap and the three recipes", () => {
  for (const part of [
    "## Hardware to UI",
    "## Black edition",
    "## In Pego",
    "**Dashboard**",
    "**Landing page**",
    "**Social post**",
  ])
    expect(skill.content).toContain(part);
});
```

Write the contrast assertions in the second test as the comment says (the implementer writes them, same shape as
`presets.test.ts`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/agent/src/skills`
Expected: FAIL (module `./teenage-engineering` missing; digital ids and registry cases fail).

- [ ] **Step 3: Write `teenage-engineering.ts`**

Follow `skills/movements/midcentury/dieter-rams.ts` for shape (sources comment, keywords, checklist, content). The
sources comment lists `https://teenage.engineering/products/op-1`, `https://teenage.engineering/guides/ep-133`,
`https://blakecrosley.com/guides/design/teenage-engineering` and
`https://read.cv/jdsimcoe/inside-design-at-teenage-engineering`.
Pinned by the spec, Decision 3:

- `title`: "Teenage Engineering / instrument panel UI"; `description` one line, no em dash.
- `keywords` (10+): the spec's list, including "gaya teenage engineering" and "ala teenage engineering"; never the
  bare word "te".
- `content` sections, in order: `## Essence`, `## Visual vocabulary` (holds the single `Fonts: Noto Sans JP, Doto`
  line), `## Hardware to UI`, `## Black edition` (holds one line exactly
  `Black edition tokens: bg #0F0E12, surface #272727, surface-2 #3B3B3D, border #4D4D4D, text #F5F5F5, text-muted #B2B2B2, accent #F05A24, on-accent #0F0E12, danger #FF7A6B`),
  `## In Pego` (component recipes, then bullets starting `- **Dashboard**:`, `- **Landing page**:`,
  `- **Social post**:`), `## Pitfalls`, `## Pair with`.
- In Pego must state: keys `$radius-sm` in panels with `$space-sm` padding and `$radius-lg`; OLED unit in `$accent`
  as the style's choice over ui-polish's `$text-muted` unit rule; uppercase typed in the text; underlines as a 1px
  rule; social post labels 28 to 32px on 1080-wide posts; dark is `field-instrument` plus the swap via
  `set_variables`, by default for posts.
- `checklist`: 6 to 8 items from the spec.

Register it in `digital.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/agent/src/skills packages/agent/src/styles`
Expected: PASS. If a registry case fails because another skill outranks TE, fix the TE keywords, not the case.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/skills/movements/digital.ts packages/agent/src/skills/movements/digital.test.ts \
  packages/agent/src/skills/movements/digital/teenage-engineering.ts \
  packages/agent/src/skills/movements/digital/teenage-engineering.test.ts packages/agent/src/skills/select.test.ts
git commit -m "feat(agent): teenage-engineering style skill with black edition and recipes"
```

### Task 3: Changelog entry and repo checks

**Files:**

- Create: `apps/changelog/src/content/entries/instrument-panel-style.md`

**Interfaces:**

- Consumes: the preset and skill from Tasks 1 and 2 (describes them; no code).

- [ ] **Step 1: Write the entry**

Frontmatter like `more-polished-agent-designs.md`: `title` (e.g. "A new instrument-panel style"), `date` today with
a time later than other entries of the day, `summary` at most 160 characters, `tags: [new]`. Body bullets in product
language: a style inspired by portable synthesizers (grey panels, numbered keys, knobs, small screens with
dot-matrix numbers, one orange), light and dark, fits dashboards, landing pages and social posts; ask for it by
name. No brand name, no internal details.

- [ ] **Step 2: Validate the entry**

Run: `bun run --cwd apps/changelog test`
Expected: PASS.

- [ ] **Step 3: Run the repo checks**

Run: `bun run typecheck && bun run lint && bun run format:check && bun run test`
Expected: all pass (no new failures compared with `feat/ui-polish`).

- [ ] **Step 4: Commit**

```bash
git add apps/changelog/src/content/entries/instrument-panel-style.md
git commit -m "docs(changelog): instrument-panel style"
```

### Task 4: Dev-app check

No code unless the check finds drift in the skill text (then edit `teenage-engineering.ts`, rerun Task 2 Step 4,
commit as `fix(agent): ...`).

- [ ] **Step 1: Reload the bridge on this branch**

The user's dev desktop app runs the bridge from this checkout (`apps/bridge/src/index.ts`, port 4519). Ask the user
to restart it, then confirm with the Pego MCP tools: `list_styles` includes `field-instrument`, `get_skill` with
`teenage-engineering` returns the new content.

- [ ] **Step 2: Build the three designs through MCP**

`create_project` named `te-style-check` (its folder stays uncommitted). Then, following the skill and preset:
an app dashboard (light), a landing page (light), an Instagram post 1080x1350 (black edition swap). Use the
mockup `.superpowers/brainstorm/73809-1792748047/content/te-three-uses.html` as the reference.

- [ ] **Step 3: Verify on the canvas**

For each design: `get_screenshot` shows Noto Sans JP and Doto (not Inter); `check_layout` reports no warnings,
including the polish checks; orange marks one control group. Note how long the first Noto Sans JP load takes.

- [ ] **Step 4: Report**

Show the user the three screenshots and the check results. Ask them to try one Indonesian prompt in the agent
panel (e.g. "bikin dashboard aplikasi ala teenage engineering") to confirm the automatic pick. Stop there: no
push, no PR.
