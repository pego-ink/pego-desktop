# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Product goals live in [PRD.md](PRD.md), architecture
decisions in [STACK.md](STACK.md), run/release steps in [README.md](README.md).

## What Pego is

An AI-native design editor, built as an open alternative to Pencil (pen.dev). Skia (CanvasKit WASM) canvas,
local-first `.pego` files, and an agent that edits the canvas live through the same tools whether it runs in the
browser (BYOK), from the panel via Claude Code, or from Claude Code in a terminal over MCP.

## Commands

```bash
bun install
bun run dev                     # web editor on :5173 (+ apps/api); editor only: bun run --cwd apps/web dev
bun run bridge                  # local bridge on 127.0.0.1:4519 (MCP + Claude Code runs)
bun run typecheck
bun run lint
bun run format                  # Prettier write; CI runs format:check
bun run test                    # bun test in every workspace
bun test packages/doc/src/ops.test.ts   # single file, run from the repo root or the workspace
```

Run `typecheck`, `lint` and `test` before calling a change done. CI (`.github/workflows/ci.yml`) runs them on every
PR and push to `main`.

## Layout

```
apps/web/        React + Vite editor: canvas/, interaction/, panels/, agent/, persistence/, store/
apps/bridge/     Bun server: MCP (Streamable HTTP), Claude Agent SDK runs, WebSocket to the editor
apps/desktop/    Electron shell (macOS signed + auto-update; Linux, Windows), starts the bridge itself
apps/api/        Hono on Workers, frozen, not used by the editor
packages/doc/    schema (Zod), ops + inverse, history, tree helpers, instances, flex layout
packages/agent/  provider-neutral tools, prompts, skills, style presets, export (code/SVG), serialization,
                 bridge protocol
packages/ui/     shadcn components and tokens
design/          mocks (.pen, png, html), not linted
```

## Architecture rules

- **Every document change is an op** from `packages/doc/src/ops.ts`: `insert`, `update`, `replace`, `move`,
  `delete`, `setVariables`. UI gestures, undo/redo, the agent and any future multiplayer go through them. Never
  mutate a `PegoDocument` in place; ops return a new document.
- **Undo = inverse ops.** `history.ts` records one transaction per gesture, panel edit or agent step
  (`source: "user" | "agent"`). Drags use `extendLast` so one gesture is one undo step.
- **`packages/doc` and `packages/agent` are pure**: no DOM, React, network or file I/O. Editor capabilities reach
  tools only through `ToolHost` (`packages/agent/src/types.ts`); optional capabilities return an `unsupported`
  error when missing.
- **Tools never throw.** `ToolSpec.run` turns errors into `{ isError: true }` results.
- **One tool set for all backends.** Add or change a tool in `packages/agent`, not in the web app or the bridge.
- **Skia only renders.** Hit-testing, selection, transforms and layout are ours (`apps/web/src/interaction`,
  `packages/doc/src/layout.ts`).
- The bridge binds to `127.0.0.1:4519` only and checks origins (`apps/bridge/src/security.ts`). Keep it that way.
- **Several editors share one bridge** (`apps/bridge/src/editor-hub.ts`, protocol v7): every editor window stays
  connected; MCP calls (and the file tools) go to the most recently focused one, agent runs talk only to the
  editor that started them (up to `MAX_CONCURRENT_RUNS` = 3 at once, each with its own run-scoped MCP endpoint),
  `run_steer` feeds a running run. Two windows with the same project file: last focused wins, the other's
  `save_file` is refused until it is focused again (its changes stay in its browser autosave).
- The user's Anthropic API key stays in the browser and is sent only to `api.anthropic.com`.

## The `.pego` file format

Source of truth: `packages/doc/src/schema.ts` (document), `packages/doc/src/migrate.ts` (versions) and
`apps/web/src/persistence/file-format.ts` (envelope). Current version: **5**.
If this section and the code disagree, the code wins; fix this section.

### Envelope

A `.pego` file is UTF-8 JSON, pretty-printed with 2 spaces:

```json
{ "format": "pego", "version": 5, "document": { ... } }
```

`parseDocumentFile` rejects anything without `"format": "pego"` and versions newer than this build. Older
versions are upgraded by `migrateDocument` (also applied to the IndexedDB autosave), then validated with
`documentSchema`. Version 1 added `effects`, per-side stroke widths, text `lineHeight`/`letterSpacing`, path
`viewBox` and gradient/image fills; version 2 added pages (older top-level nodes become "Page 1"); version 3
added `image` nodes, path `strokeCap`/`strokeJoin`/`startMarker`/`endMarker` and text `fontStyle` (no data
change: the bump makes older builds refuse these files instead of dropping the props); version 4 added `visible` (hidden layers), frame `slot` (component slots), page
`library` (library pages) and image `source` (screenshot origin), again with no data change; version 5 added `flipX`/`flipY` (mirror around the node's own center, on every node but pages), again with no data change.

### Document

```json
{
  "version": 5,
  "id": "k3m9x0qa",
  "name": "Landing page",
  "variables": {
    "accent": { "type": "color", "value": "#4F46E5" },
    "radius": { "type": "number", "value": 12 },
    "brand": { "type": "string", "value": "Pego" }
  },
  "children": [
    { "type": "page", "id": "p1", "name": "Main flow", "children": [/* screen frames */] },
    { "type": "page", "id": "p2", "name": "Components", "children": [/* reusable nodes */] }
  ]
}
```

### Pages

- `document.children` holds only pages (at least one); a page holds the canvas content and is never nested.
  Ops enforce it (`invalid_parent`, `last_page`); a page is renamed with `update` and removed with `delete`.
- A page with `library` (`{ projectId, name, path, syncedAt }`) holds read-only copies of another project's
  components, replaced on update from that project's file; instance them, do not edit them.
- Ids are unique across all pages, refs resolve across pages (a "Components" page works) and undo spans pages.
- Layout gives pages no box: their content keeps its own x/y. The canvas, hit-testing, layers panel, marquee and
  zoom-to-fit take a `pageId` (null = the first page).
- `parentId: null` in UI code and in agent tools means "the top level of the shown/active page":
  `placeOnPage` (`packages/doc/src/ops.ts`) rewrites such ops in the document store and in the tools.
- The web app keeps the shown page in `useDocumentStore().pageId`; read it with `activePage(state)` and switch
  with `showPage` (`apps/web/src/pages/page-actions.ts`, which also remembers a camera per page). Agent tools:
  `create_page`, `go_to_page`; `get_document` lists all pages but prints only the active page's tree.

### Nodes

Every node has `id` (unique in the whole document), `type`, and optionally `name`, `x`, `y` (default `0`),
`width`, `height`, `rotation`, `flipX`, `flipY` (not on pages: mirror around the box center, applied before the rotation, so the box does not change; children and text mirror too), `opacity`, `reusable`, `visible` (`false` hides the node and its children: not
drawn, not hit, no room in a flex layout, not exported).

| Type        | Extra props                                                                                                                              | Children |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `frame`     | `fill`, `stroke`, `effects`, `cornerRadius`, `clip`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `slot`                  | yes      |
| `group`     | none                                                                                                                                     | yes      |
| `rectangle` | `fill`, `stroke`, `effects`, `cornerRadius`                                                                                              | no       |
| `ellipse`   | `fill`, `stroke`, `effects`                                                                                                              | no       |
| `path`      | `fill`, `stroke`, `effects`, `geometry` (SVG path data, required), `viewBox`, `strokeCap`, `strokeJoin`, `startMarker`, `endMarker`      | no       |
| `text`      | `content` (required), `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `lineHeight`, `letterSpacing`, `textAlign`, `fill`, `effects` | no       |
| `image`     | `src` (data: or https URL, required), `fit` (`fill` \| `fit` \| `crop` \| `tile`), `cornerRadius`, `stroke`, `alt`, `source`             | no       |
| `icon`      | `iconSet` (default `"lucide"`), `iconName` (kebab-case, required), `fill`, `effects`                                                     | no       |
| `ref`       | `ref` (id of a reusable node, required), `descendants` (overrides)                                                                       | no       |

Value rules:

- **Colors**: hex `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or a `$variable`.
- **Fill**: a color on every painted node. Frame, rectangle, ellipse and path also take
  `{ "type": "linear", "angle", "stops" }` (CSS angles: 0 up, 90 right, 180 default),
  `{ "type": "radial", "center": [0.5, 0.5], "radius": [0.5, 0.5], "stops" }` (fractions of the node size) or
  `{ "type": "image", "src": "data:image/png;base64,...", "fit": "cover" | "contain" | "stretch" }`. Stops are
  `{ "color", "position" }` with position 0..1, at least two. Images are embedded (scaled to at most 2048 px on
  import from the panel); geometry helpers shared by canvas and exports live in `packages/doc/src/paint.ts`.
- **Stroke**: `{ color, width }`. `width` defaults to `1`; a uniform width is centered on the outline, per-side
  `[top, right, bottom, left]` is drawn inside the box like a CSS border (`[0, 0, 1, 0]` = bottom divider).
- **Effects**: a list drawn in order. `{ "type": "shadow", "color", "x", "y", "blur", "spread"?, "inner"? }`
  (drop shadow, or inner shadow with `"inner": true`; like CSS `box-shadow`, blur radius = 2 sigma) and
  `{ "type": "blur", "radius" }` (blurs the whole layer, children included; like CSS `filter: blur()`, radius =
  sigma).
- **Text**: `lineHeight` is a multiple of `fontSize` (CSS unitless), `letterSpacing` is in px, `fontFamily` may
  be a string `$variable`.
- **Path**: with `viewBox: [minX, minY, width, height]` the geometry is scaled to the node's size.
  `strokeCap` (`butt | round | square`), `strokeJoin` (`miter | round | bevel`) and the open-path markers
  `startMarker` / `endMarker` (`none | arrow | triangle | circle | bar`) ride on the stroke.
- **Image node** vs **image fill**: an `image` node is a placed bitmap (its own layer, `fit` like Figma); an image
  fill paints a shape's background. Both survive export. `source` (`{ url, selector? }`, http(s) only) records which browser page a screenshot came from.
- **Numbers** (`x`, `gap`, `fontSize`, `cornerRadius`, ...): a number or a `$variable`.
- **Sizing** (`width`, `height`): a number, `"fit_content"` (hug children; frames default to it, text measures
  itself) or `"fill_container"` (take the parent's remaining space).
- **Layout**: `layout` is `"none"` (default; children keep their own `x`/`y`), `"horizontal"` or `"vertical"`
  (children are placed by the frame; their `x`/`y` are ignored). `padding` is one value or
  `[top, right, bottom, left]`. `justifyContent`: `start | center | end | space_between | space_around`.
  `alignItems`: `start | center | end`.
- **Variables**: referenced as `$name`, stored in `document.variables` without the `$`. A reference to a missing
  variable or one of the wrong type falls back to the default (see `packages/doc/src/resolve.ts`).

### Components and instances

- Mark any node `"reusable": true` to make it a component.
- A `ref` node instantiates it: `{ "type": "ref", "id": "card1", "ref": "cardComponent", "x": 40, "y": 80 }`.
  Props on the ref (position, size, name, ...) override the component root.
- `descendants` overrides props of nodes inside the component, keyed by their id in the component:
  `"descendants": { "titleText": { "content": "Pricing" } }`. `id`, `type` and `children` cannot be overridden.
- A `frame` inside a component with `slot` (array of recommended component ids, may be empty) is a slot: an
  instance fills it with `"descendants": { "bodySlot": { "children": [nodes] } }` (the only way `children` can be
  overridden). Content is validated once per array; if none of it is valid, or there is none, the component's
  default content shows.
- At render time instance children get ids `<instanceId>/<sourceId>` (nested instances chain). These ids are
  not stored in the file and cannot be targeted by ops; edit the component or the ref's `descendants` instead.
- Refs nest at most 16 deep; a ref must not point at its own ancestor.

### Ids

New ids come from `createId()` (8 chars, base36). When copying a subtree use `cloneWithFreshIds`. Any string is
valid in a file, but it must be unique in the document; `insert` fails with `duplicate_id` otherwise.

### Editing `.pego` files

- **Prefer the agent tools** (via the open editor and MCP) over editing JSON by hand: they validate, keep ids
  unique and give one undo step per change. Use `batch_design` for multi-node edits (supports `@alias` for nodes
  created earlier in the same batch, max 200 operations).
- When editing JSON by hand, keep the envelope, keep ids unique, use only the props in the table above (unknown
  props are stripped on load), and validate by opening the file in the editor.
- `update` merges props; `null` removes a prop. `id`, `type` and `children` cannot be updated (use `replace` or
  `move`).
- Changing the schema: bump `DOCUMENT_VERSION` in `schema.ts`, add a step to `MIGRATIONS` in `migrate.ts`
  (never edit a shipped step), and update this section plus `json-schemas.ts`, `serialize.ts` and `prompts.ts`
  in `packages/agent`.

### Importing `.pen` (Pencil)

`importPen` (`packages/doc/src/pen.ts`) converts a `.pen` document; File → Open accepts `.pen` and opens the
result as an unsaved `.pego`. Differences it handles: `.pen` frames without `layout` are horizontal, text
`textGrowth`, `strokeWidth` objects, `effect` shapes, `icon`/`library` props, string font weights, 2/3-value
padding. Instances that restyle their root or replace a descendant are detached. Anything else it cannot
represent is dropped and reported as a warning, never silently. Test fixture: `design/pego.pen`.

## Documents, sources and workspaces

- **Two document sources, one model** (`apps/web/src/persistence/document-source.ts`). The default is a local
  `.pego` file (File System Access API): open/save, file autosave (`file-autosave.ts`, debounced, permission
  resume, paused state) and the IndexedDB browser copy (`use-persistence.ts`); it works offline, no bridge
  needed. The second is a bridge file: a project's `project.pego` or a file opened by MCP `open_document`,
  written through the bridge (`save_file`) and autosaved the same way while the bridge is connected ("Bridge
  offline" otherwise, then it resumes). Never lose unsaved work: `isFileWriteInFlight` guards unload, and a
  pending autosave is written before another workspace's document replaces the live one.
- **Projects** are folders in the repository's `design/` with a `project.json` (`{ id, name, createdAt }`) and
  the project's design, `project.pego` (one document; screens are its pages), e.g. `design/pego-website/`. Its
  document id is the project id (chat sessions are keyed by document id). The bridge finds `design/` (nearest
  `.git` above where it runs; `PEGO_DESIGN_DIR` overrides), lists projects (`apps/bridge/src/projects.ts`) and
  creates them. Projects, the dashboard and the project tabs appear only while a bridge serves a design folder.
  Deleting (Dashboard card menu) moves the folder to the OS Trash, never a permanent delete: the editor sends only
  the project id (`trash_project`), the bridge re-validates the folder (`trash.ts`); it is not an agent tool.
- **Workspaces** (`apps/web/src/workspace/use-workspace-store.ts`): Scratch (local files, the default) and one
  per open project, each with **one document**. The shown document lives in the normal stores (document, file,
  viewport; `workspace/live-document.ts`), the others keep a snapshot. Open documents through `openDocument`
  (File > Open, drops, .pen import, `open_document`, projects), never with `useDocumentStore.load` directly; it
  asks the user about unsaved changes ("ask"), refuses for Claude Code ("refuse": save first) or drops them
  ("discard"). Switching is blocked while a panel agent run is active. The Dashboard is a view (the Pego logo in
  the icon rail opens it), not a workspace.
- Editor chrome: icon rail with Agent, Layers (pages + layer tree), Assets (the document's components,
  `apps/web/src/assets/`) and, in the desktop app only, Browser; resizable side panel, properties column (pin,
  hide); `Ctrl/⌘ + \` hides both sides.
  Layout state is one store, `apps/web/src/store/use-layout-store.ts`.
- MCP: `list_projects`, `open_project` (by id, name or unambiguous prefix), `create_project`,
  `list_documents` (the open documents, one per workspace) and `switch_document`; they act on the focused editor.
- Dev: `?bridge=4599` in the editor URL connects to a bridge on another port (`PEGO_BRIDGE_PORT=4599 bun run
bridge`), handy for testing without touching your main editor tab.

## Export

One engine, in `packages/agent/src/export/`: `exportCode` (React + Tailwind or HTML/CSS) and `exportSvg`, used by
the `export_code` / `export_image` tools and the editor's Export section (`apps/web/src/export/`, PNG via
`renderNodeImage`, code preview dialog). Both take the layout the canvas uses, so positions and hug sizes match.
When you add a node prop, update the canvas renderer and the exporter together, and check them side by side.
(The separate `@pego/export` package and the `get_code` tool were folded into this engine in the dev_echo merge.)

## Agent

- Tools: `packages/agent/src/tools.ts` (registry), `tools-edit.ts`, `tools-inspect.ts`, `edit/`, `inspect/`.
- Prompts: `prompts.ts`. Design guidance is the skills system (`skills/`: one design skill plus one style
  skill per run, `list_skills` / `get_skill`; `get_guidelines` maps old topic names onto skills). Style presets
  (`list_styles`, `get_style`): `styles/presets.ts`.
- BYOK models: planner `claude-opus-5-5`, executor `claude-sonnet-5-5` (`apps/web/src/agent/api-runtime.ts`).
- Plan and progress always go through `report_plan` / `report_step` so every backend drives the same panel.
- MCP (`apps/bridge/src/mcp.ts`): every tool carries annotations (`packages/agent/src/annotations.ts`); add a new
  tool there too. Over HTTP the bridge also serves `open_document` / `save_document`
  (`apps/bridge/src/file-tools.ts`): the bridge reads and writes absolute `.pego` paths (reads `.pen`), the
  editor parses and serializes (`apps/web/src/persistence/bridge-documents.ts`), and File → Save writes back to
  that path through the bridge. These go to the focused editor; agent runs never get them.
- `export_code` returns a node as React + Tailwind or HTML/CSS so Claude Code can implement a design; embedded
  image data is cut to keep the result small.
- In-app browser (desktop only, like pen.dev): a `WebContentsView` in its own session (`persist:pego-browser`)
  drawn over the Browser panel (`apps/desktop/src/browser-*.ts`, `apps/web/src/browser/`). The editor drives it
  over IPC + CDP; page scripts run in an isolated world and return a `DomSnapshot` that `media/dom.ts` turns
  into nodes. Tool `browser` (`tools-browser.ts`, host `ToolHost.browser`): load-page (http(s) only),
  import-to-canvas, screenshot-to-canvas, return-element, return-screenshot, cdp. CDP is an allowlist of
  methods, kept identical in `apps/desktop/src/browser-cdp.ts` (enforced in main) and
  `packages/agent/src/browser-cdp.ts`; page text reaches the model wrapped as untrusted `<page_content>`.
- Add a test next to every new tool (`*.test.ts`, use `test-host.ts`).

## Code conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (`import type` for types).
- Prettier: double quotes, semicolons, trailing commas, 100 columns. Run `bun run format` before committing.
- Arrow-function exports, Zod schemas as the source of types (`z.infer`), short JSDoc on exported functions.
- Tests are `bun test`, colocated as `*.test.ts`. Pure logic (ops, layout, tools, parsing) must have tests.
- Web state lives in Zustand stores under `apps/web/src/store` and `*/use-*-store.ts`.
- Shared UI goes in `packages/ui`; editor-specific components stay in `apps/web`.

## Git workflow

Two people contribute to `github.com/yolkmonday/pego`, so:

- Never push to `main`. Work on a branch, open a PR, and let CI pass before merging.
- Rebase on `origin/main` often; keep PRs small.
- Commit messages follow Conventional Commits with a scope: `feat(web): ...`, `fix(doc): ...`, `docs: ...`.
- Coordinate before touching shared hot spots: `packages/doc/src/schema.ts`, `packages/doc/src/ops.ts`,
  `packages/agent/src/tools.ts`, root `package.json`.
- On a `bun.lock` conflict, take `main`'s version and rerun `bun install`; never hand-edit it.
