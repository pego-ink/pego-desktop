# Teenage Engineering style: preset `field-instrument` + style skill `teenage-engineering`

Status: draft for approval (2026-10-23). Approved mockups: `.superpowers/brainstorm/73809-1792748047/content/`
`te-visual-language.html` (palette, type, hardware kit, light and dark directions) and `te-three-uses.html`
(dashboard, landing page, Instagram post). They are local and not committed; the decisions below are the source of
truth.

## Intent

The user loves the visual language of teenage engineering's **physical products** (OP–1 field, EP–133 K.O. II,
TX–6, OP–XY, pocket operators): the shape of the keys and knobs, the panel layout, the modern industrial feel, the
palette and the way fonts are combined. They want Pego's agent to translate that language into screen design and
UI, not into music-only graphics. The first designs they will ask for: an **app dashboard**, a **landing page**
and an **Instagram post**. Both a **light** direction (OP–1 field, EP–133: aluminium grey body, black keys) and a
**dark** direction (OP–XY, TX–6 black: graphite body, grey keys) are wanted; the user said both fit.

The core idea, as played back and approved: a screen reads as an **instrument panel**. Grey is the material,
controls are objects (numbered keys, encoders, one big round button), numbers live on small "OLED" screens in a
dot-matrix face, labels look engraved (tiny, uppercase, tracked), orange is rationed to one control, and one playful
surprise (a starburst sticker) per screen.

## Goals

- When a prompt names teenage engineering or one of its products ("ala teenage engineering", "kayak OP-1",
  "pocket operator style"), the agent loads the `teenage-engineering` style skill and builds in this language.
- The `field-instrument` preset gives the light token set; the skill carries the dark ("black edition") swap.
- The skill has concrete Pego recipes for a dashboard, a landing page and a social post, matching the mockups.
- Works for any product (the mockups use a fictional time tracker, "tempo"), not only audio gear.

## Non-goals

- No new node types, fill types or renderer features (no conic gradients, no dot-pattern fill). Everything is built
  from existing nodes: frame, ellipse, path, text, icon, image, ref.
- No change to the font loader or `google-fonts.json`.
- No changes to the design skills' suggested-style lists (`dashboard`, `landing-page`, `social-media` each already
  hold the maximum of 5, enforced by `system-skills.test.ts` / `build-skills.test.ts`). My call: the pairing is
  stated in the style skill's "Pair with" section instead of displacing an existing preset.

## Anti-goals (a failure even if every test passes)

- Orange everywhere. Orange marks one control (or one bar, one sticker) per screen.
- Generic grey SaaS with an orange button: if keys, readouts and engraved labels are missing, it is not this style.
- Skeuomorphic textures: no brushed metal images, no glossy highlights, no fake screws. Depth is a 2px hard "key
  travel" shadow and flat material tones.
- Illegible type: labels must stay at or above the core skill minimum; Doto never for small text.
- Copying the brand: no TE logo, wordmark, product names, product photos or "teenage engineering" text in the
  generated design. The brand is named only in the skill (like `dieter-rams` names Braun).

## Constraints from the repo

- Preset tests (`packages/agent/src/styles/presets.test.ts`, `inspect/inspect.test.ts`): same 17 token names;
  `text` >= 7:1 and `text-muted` >= 4.5:1 on `bg`, `surface`, `surface-2`; `on-accent` on `accent` >= 4.5:1;
  `accent` on `surface` >= 3:1; accent OKLab distance >= 0.08 from every other preset and a unique accent value;
  fonts and weights exist in `apps/web/src/fonts/google-fonts.json`; `dos` >= 3, `donts` >= 2. Both tests
  hard-code the count 20 and `presets.test.ts` lists every id in `EXPECTED_IDS`.
- Digital style skill tests (`skills/movements/digital.test.ts`): content 2500 to 4800 **bytes**, 6 to 8 checklist
  items, 1 to 3 known preset ids (it keeps its own hard-coded `PRESET_IDS` list), exactly one line starting with
  `Fonts:` whose comma-separated names all exist in the catalog (no parentheses: this test does not strip them),
  at least one keyword containing an Indonesian word from its list (`gaya`, `desain`, `tampilan`, `tombol`, ...),
  no em dashes in `content` or `description`. The test also lists the nine ids exactly.
- Core skill (always on): body text 14px or more, nothing below 11px, **no more than two font families**.
  Dashboard skill: nothing below 12px.
- Contrast facts for the official TE orange `#F05A24` (checked with `contrastBetweenHex`): black on orange 5.67,
  white on orange 3.39 (fails), orange on `#F5F5F5` 3.11, on `#F0F0EF` 2.97, on `#E5E5E5` 2.69. So orange is a
  fill with black text on light surfaces, never thin orange text on light grey. Accent distance: 0.101 from
  `swiss-grid`, 0.103 from `carbon-dense` (passes).
- ui-polish (PR #48, branch `feat/ui-polish`, open into `dev`, not on `dev` yet): an always-on `ui-polish` skill
  plus polish checks in `check_layout`. Its design decision 1 is "style first, polish second": where it disagrees
  with a style, the style wins. Two of its rules touch this style: `check_layout` warns when nested corners are not
  concentric (parent radius = child radius + inset, for even insets up to 24), and the skill text says a unit next
  to a big number is `$text-muted`.
- Text case and decoration: Pego text has no text-transform and no underline prop. Uppercase labels are typed in
  uppercase; an underlined link is a text plus a 1px rule.
- Social posts: the `social-media` skill sets nothing below 28px on 1080-wide posts, so the post's corner labels are
  28 to 32px there (the mockup is scaled down).
- Rendering: the repo loads Google Fonts (`apps/web/src/fonts/font-service.ts`, since `1d6826e`); an older
  installed Pego.app rendered everything as Inter. Verify in the dev app.
- Git (my call after the builder check): work on a new local branch `feat/te-style` cut from `feat/ui-polish`, so
  the style is built and verified against the polish checks it will ship with; rebase it onto `dev` after #48
  merges. Commit only when the user asks, never push or open a PR without asking. A PR into `dev` needs a changelog
  entry. `feat/ui-polish` has unrelated uncommitted changes (`design/pego-website/project.pego`, untracked
  `design/ig-post/`, `design/we-ui/`); leave them alone and do not commit them.

## Decisions

### 1. Two pieces: a preset and a style skill (my call, approved in chat)

Tokens alone cannot carry key shapes, panel layout and label habits, so the style is a preset (tokens, fonts,
scale) plus a style skill (vocabulary, hardware to UI mapping, recipes). One preset only: two presets with the same
orange would fail the accent tests, so the dark direction is a value swap inside the skill (same token names,
applied with `set_variables`).

### 2. Preset `field-instrument` (`packages/agent/src/styles/presets.ts`, appended last)

Name is my call: neutral like the other presets, no brand name.

- `title`: "Field Instrument"
- `mood`: aluminium-grey instrument panel, black keys, one signal orange, thin lowercase type and dot-matrix
  numbers (builder words it).
- `bestFor`: hardware and creative tools, app dashboards, product launch pages, tech brands with a playful side.
- `fonts`: heading **Noto Sans JP**, body **Noto Sans JP**, mono **Doto** (decided by the user, option C: one
  family covers the thin Latin text and the orange katakana accents, so the design stays at two families; Doto is
  the dot-matrix face for numbers and readouts). Substitutes for TE's Univers TE (thin) and TechnoType, which are
  not on Google Fonts. The mockups used Inter Tight for Latin; Noto Sans JP's Latin is a little wider, accepted.
- `weights`: heading [200, 300], body [300, 400, 500], mono [700, 900].
- Cost of option C: the editor loads the full variable TTF per family through jsDelivr; Noto Sans JP is 9.6 MB
  (Inter Tight would be 0.6 MB), under the font service's 40 MB cap. One download covers every weight. Check the
  first-load time in the dev app.
- `typeScale`: caption 11, body 15, lead 18, h3 22, h2 32, h1 48, display 88.
- Tokens (light, official TE values from the CSS of teenage.engineering, `--te-*` variables, except `text-muted`):

  | token      | value     | note                                                      |
  | ---------- | --------- | --------------------------------------------------------- |
  | bg         | `#F0F0EF` | page, `--theme-body-bc`                                   |
  | surface    | `#F5F5F5` | light keys, cards, `--te-white`                           |
  | surface-2  | `#E5E5E5` | panel body (aluminium), `--te-grey-100`                   |
  | border     | `#CCCCCC` | `--te-grey-200`                                           |
  | text       | `#0F0E12` | also the fill of dark keys and OLED screens, `--te-black` |
  | text-muted | `#4D4D4D` | `--te-grey-900`; the site's `#767676` fails 4.5:1         |
  | accent     | `#F05A24` | `--te-orange`                                             |
  | on-accent  | `#0F0E12` | black on orange                                           |
  | danger     | `#B81D13` | `--te-red`                                                |

  Contrast: text 15.3 to 17.6, text-muted 6.7 to 7.8, danger 5.2 to 6.0, on-accent 5.67, accent on surface 3.11.

- Scale (my call): radius [4, 6, 12], space [4, 8, 12, 24, 48]. Keys use `$radius-sm` (4); a panel that holds keys
  at its corners uses `$space-sm` (8) padding and `$radius-lg` (12), so corners stay concentric for the polish
  check (4 + 8 = 12). The same rule for an OLED inside a panel (radius 4 at inset 8 in a 12 panel). Pills use 999.
- `layout`, `stroke`, `elevation`, `dos`, `donts`: condensed from Decision 3 (builder words them). Must include:
  elevation is a 2px hard key-travel shadow (y 2, blur 0) and flat tones, no soft drop shadows; orange on one
  control per screen; labels uppercase tracked at 11px+; Doto only at 18px+.
- Secondary signal colors (not tokens, used as literal fills only for encoder caps and status LEDs):
  blue `#0071BB`, green `#006837`, yellow `#FAB413`. On dark surfaces blue fails as text (2.90 on `#272727`), so
  links in the dark direction are `$text` underlined or `$accent`.

### 3. Style skill `teenage-engineering` (`packages/agent/src/skills/movements/digital/teenage-engineering.ts`)

Registered in `skills/movements/digital.ts` (my call: TE is contemporary product design, the digital group's era).

- `title`: "Teenage Engineering / instrument panel UI"; `category: "style"`.
- `keywords` (10+): teenage engineering, teenage-engineering, op-1, op-1 field, op-z, op-xy, ep-133, k.o. ii,
  pocket operator, tx-6, field system, synth ui, instrument panel, plus Indonesian: "gaya teenage engineering",
  "ala teenage engineering", "desain seperti synthesizer", "tampilan seperti op-1", "tombol seperti synth". Avoid
  the bare word "te" (too ambiguous for selection in `skills/select.ts`).
- `styles`: ["field-instrument"] only (my call after the builder check: a second preset would pull dark requests
  away from the TE fonts and orange; dark is `field-instrument` plus the black edition swap, and the skill says so).
- Sources comment at the top like `dieter-rams.ts`: teenage.engineering product and guide pages, plus the
  secondary sources from the research (Blake Crosley guide, read.cv "inside design at teenage engineering").
- `content` sections (fits 2500 to 4800 bytes; English like every skill):
  1. **Essence**: Stockholm studio (2005), OP–1 (2011), field system, pocket operators; consumer electronics treated
     as playful instruments; constraint as aesthetic.
  2. **Visual vocabulary**: material palette (90% greys, under 10% signal colors); type in three voices: thin
     lowercase grotesk for speech, uppercase tracked labels like engraving, dot-matrix numbers on screens; model
     numbers with an en dash (TP–01); numbering (01, 02) on sections and keys; registration crosses and technical
     labels in corners; one starburst sticker; orange katakana as a second accent (one or two words, e.g. the
     product's function in katakana beside a label, on dark or as large text since orange on light grey is below
     4.5:1). The single `Fonts:` line: `Fonts: Noto Sans JP, Doto`.
  3. **Hardware to UI** mapping, as in the approved kit: numbered key (number bottom-left, label top-right) =
     segmented control, tabs, nav item; two-function key = action plus shift action (orange label on black half);
     encoder = slider or stepper, cap color names the parameter; big round orange button = the one primary action;
     OLED screen = readout, hero number, status; slide switch plus LED = toggle and status; black pill plus blue
     text link = web CTA pair; starburst = one surprise per screen, rotated about -8 to -10 degrees.
  4. **Black edition** (dark swap for `set_variables`, same names; all pass the preset contrast rules):
     bg `#0F0E12`, surface `#272727`, surface-2 `#3B3B3D` (keys), border `#4D4D4D`, text `#F5F5F5`,
     text-muted `#B2B2B2`, accent `#F05A24`, on-accent `#0F0E12`, danger `#FF7A6B` (text 10.3 to 17.6, muted 5.3
     to 9.1, accent on surface 4.41). Use when the prompt asks for dark, black or "black edition", and for posts by
     default (as in the mockup).
  5. **In Pego** recipes (node level, short):
     - Key: frame, radius `$radius-sm`, fill `$text` (dark key) or `$surface` (light key) or `$accent`
       (active), effect shadow `{x 0, y 2, blur 0}` in black (dark key) or `#B2B2B2` (light key); number text 15/300
       bottom-left, label text 11/500 uppercase letterSpacing ~1.5 top-right.
     - Encoder: ellipse 40 with `$surface-2` fill and 1px `$border` stroke, inner ellipse 24 in a signal color with
       an inner shadow; optional ring of short path ticks (ridges) only on hero objects.
     - OLED: frame fill `$text` (light) or `#0F0E12` (dark), radius `$radius-sm` when it sits at a panel corner
       (concentric rule), inner shadow; Doto 900 for the hero number, Doto 700 for its unit in `$accent`. The skill
       states this as the style's choice over ui-polish's "unit in `$text-muted`" (that grey is unreadable on the
       black screen; style first); bar chart as plain bars with the highlighted bar in `$accent` (dot-matrix
       bars only if each bar stays under ~40 small ellipses; otherwise plain).
     - Starburst: one path, 32-point polygon on a 0..100 `viewBox`, fill `$accent`, Doto text on top.
     - Dashboard: side panel (`$surface-2`, radius `$radius-lg`) with numbered nav keys; time range as a row of
       keys; one OLED panel with the main number and chart; small readouts; table with uppercase 11px headers,
       1px `$border` row rules, right-aligned numbers in Noto Sans JP, status as LEDs plus a word.
     - Landing page: lowercase nav, technical label with model number, thin centered headline (display/h1 at
       200), one body line, black pill plus text link, the product's own UI drawn as a physical device as the
       hero image with one starburst, a spec row of Doto numbers with uppercase labels, separated by a 1px rule.
     - Social post (4:5, dark by default): one giant Doto number, one thin sentence, two or three keys as
       ornament, technical labels and registration crosses in the corners, optional starburst.
  6. **Pitfalls**: orange creep; texture and gloss; icon soup instead of labels; Doto for body or small numbers;
     orange text on light grey (fails contrast); copying TE marks.
  7. **Pair with**: dashboard, web-app, landing-page, social-media, mobile-app, slides.
- Byte budget (my call): keep the shared 4800-byte ceiling in `digital.test.ts`. If the content does not fit, cut
  in this order: Essence to two sentences, Pitfalls to three bullets, Pair with to one line, ridge ticks and
  dot-matrix bars out of the recipes. Black edition, Hardware to UI and the three recipes stay. Raising the
  ceiling is a last resort and gets reported in the handover.
- `checklist` (6 to 8): orange on at most one control group; numbered keys or encoders carry the controls; numbers
  on OLED panels in Doto 18px+; labels uppercase tracked and 11px+ (12px+ in dashboards); depth only from the
  2px key shadow and tones; two families only (Noto Sans JP, Doto); one surprise element at most; contrast
  4.5:1 for text, black on orange.

### 4. Wiring and tests

- `presets.test.ts`: add `field-instrument` to `EXPECTED_IDS`, count 20 to 21. `inspect/inspect.test.ts`: 20 to 21. Better (builder's call): derive the counts from `EXPECTED_IDS.length` so the next preset touches one list.
- `digital.ts` and `digital.test.ts`: register the skill, add its id (ten styles), add `field-instrument` to
  `PRESET_IDS`.
- Check other tests that count skills or style skills (`style-skills`, `select.test.ts`, `system-skills.test.ts`)
  and update counts if they are hard-coded.
- Changelog entry in `apps/changelog/src/content/entries/` (tag `new`): a new instrument-panel style inspired by
  portable synths, light and dark. Product language, no internal details.

### 5. Verification

- `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`.
- In the dev app (bridge plus editor from this branch): ask the agent, in Indonesian, for the three first designs
  ("dashboard aplikasi ala teenage engineering", a landing page, an Instagram post). Check that the skill and
  preset are picked, the fonts render (not Inter), `check_layout` is clean including the polish checks, and the
  result matches the mockups'
  character. Fix the skill text where the agent drifts.

## Resolved after the builder check

- **Font families** (decided by the user): option C, Noto Sans JP + Doto. The alternatives were dropping the
  katakana (Inter Tight + Doto) or keeping three families against the core skill's two-family rule. Comparison
  screen: `.superpowers/brainstorm/73809-1792748047/content/te-fonts.html`.
- **Base branch, concentric corners, OLED unit color, `styles` list, byte budget**: my calls, written into the
  sections above.

## Left to the builder

Exact wording of mood, bestFor, layout fields, dos/donts, description, keywords beyond the list above and the skill
prose (within the byte budget); position of entries in arrays; changelog slug and text; whether to refactor the
hard-coded test counts.
