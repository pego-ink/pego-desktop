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
apps/desktop/    Electron shell (macOS), starts the bridge itself
apps/api/        Hono on Workers, frozen, not used by the editor
packages/doc/    schema (Zod), ops + inverse, history, tree helpers, instances, flex layout
packages/agent/  provider-neutral tools, prompts, guides, style presets, serialization, bridge protocol
packages/export/ HTML/CSS and SVG export of a node from document + layout (pure)
packages/ui/     shadcn components and tokens
design/          mocks (.pen, png, html), not linted
```

## Architecture rules

- **Every document change is an op** from `packages/doc/src/ops.ts`: `insert`, `update`, `replace`, `move`,
  `delete`, `setVariables`. UI gestures, undo/redo, the agent and any future multiplayer go through them. Never
  mutate a `PegoDocument` in place; ops return a new document.
- **Undo = inverse ops.** `history.ts` records one transaction per gesture, panel edit or agent step
  (`source: "user" | "agent"`). Drags use `extendLast` so one gesture is one undo step.
- **`packages/doc`, `packages/agent` and `packages/export` are pure**: no DOM, React, network or file I/O. Editor capabilities reach
  tools only through `ToolHost` (`packages/agent/src/types.ts`); optional capabilities return an `unsupported`
  error when missing.
- **Tools never throw.** `ToolSpec.run` turns errors into `{ isError: true }` results.
- **One tool set for all backends.** Add or change a tool in `packages/agent`, not in the web app or the bridge.
- **Skia only renders.** Hit-testing, selection, transforms and layout are ours (`apps/web/src/interaction`,
  `packages/doc/src/layout.ts`).
- The bridge binds to `127.0.0.1:4519` only and checks origins (`apps/bridge/src/security.ts`). Keep it that way.
- The user's Anthropic API key stays in the browser and is sent only to `api.anthropic.com`.

## The `.pego` file format

Source of truth: `packages/doc/src/schema.ts` (document), `packages/doc/src/migrate.ts` (versions) and
`apps/web/src/persistence/file-format.ts` (envelope). Current version: **2**.
If this section and the code disagree, the code wins; fix this section.

### Envelope

A `.pego` file is UTF-8 JSON, pretty-printed with 2 spaces:

```json
{ "format": "pego", "version": 2, "document": { ... } }
```

`parseDocumentFile` rejects anything without `"format": "pego"` and versions newer than this build. Older
versions are upgraded by `migrateDocument` (also applied to the IndexedDB autosave), then validated with
`documentSchema`. Version 1 added `effects`, per-side stroke widths, text `lineHeight`/`letterSpacing`, path
`viewBox` and gradient/image fills; version 2 added pages (older top-level nodes become "Page 1").

### Document

```json
{
  "version": 2,
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
`width`, `height`, `rotation`, `opacity`, `reusable`.

| Type        | Extra props                                                                                                                 | Children |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| `frame`     | `fill`, `stroke`, `effects`, `cornerRadius`, `clip`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`             | yes      |
| `group`     | none                                                                                                                        | yes      |
| `rectangle` | `fill`, `stroke`, `effects`, `cornerRadius`                                                                                 | no       |
| `ellipse`   | `fill`, `stroke`, `effects`                                                                                                 | no       |
| `path`      | `fill`, `stroke`, `effects`, `geometry` (SVG path data, required), `viewBox`                                                | no       |
| `text`      | `content` (required), `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `fill`, `effects` | no       |
| `icon`      | `iconSet` (default `"lucide"`), `iconName` (kebab-case, required), `fill`, `effects`                                        | no       |
| `ref`       | `ref` (id of a reusable node, required), `descendants` (overrides)                                                          | no       |

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

## Projects, workspaces and tabs

- **Projects** are folders in the repository's `design/` with a `project.json` (`{ id, name, createdAt }`) and
  the project's design, `project.pego` (one document; screens are its pages), e.g. `design/pego-website/`.
  Opening a project opens `project.pego` (created when missing); its tab and the header show the project name
  (the document name), other files their file name. The bridge finds `design/` (nearest `.git` above where it runs;
  `PEGO_DESIGN_DIR` overrides), lists projects (`apps/bridge/src/projects.ts`) and creates them.
- **Workspaces** (`apps/web/src/workspace/use-workspace-store.ts`): the header shows Dashboard, Scratch
  (documents outside any project) and one tab per open project. Each workspace keeps its own document tabs;
  only the live one is in the stores, like document tabs. The Dashboard is a view, not a workspace.
- **One document per workspace** (`apps/web/src/tabs/use-tabs-store.ts`): a project shows its `project.pego`,
  Scratch one loose document; screens are pages, there is no document tab bar. The shown document lives in the
  normal stores (document, file, viewport). Open documents through `openTab` (File > Open, drops, .pen import,
  `open_document`, the project panel), never with `useDocumentStore.load` directly; it asks the user about
  unsaved changes ("ask"), refuses for Claude Code ("refuse": save first) or drops them ("discard"). Switching
  projects is blocked while a panel agent run is active. Autosave stores every workspace.
- Inside a project, like Figma: the left panel has Layers (pages + layer tree), Assets (the document's
  components, `apps/web/src/assets/`; click to show, + to place an instance) and Agent. There is no file list;
  other `.pego` files are opened with File > Open or by Claude Code. Bridge reads are limited to `design/`.
- MCP: `list_projects`, `open_project` (by id, name or unambiguous prefix), `create_project`,
  `list_documents` (active project, open tabs, files) and `switch_document`; edit tools act on the active tab of
  the active project.
- Dev: `?bridge=4599` in the editor URL connects to a bridge on another port (`PEGO_BRIDGE_PORT=4599 bun run
bridge`), handy for testing without touching your main editor tab.

## Export

`packages/export`: `exportHtml(doc, layout, nodeId)` and `exportSvg(doc, layout, nodeId)`. Both take the layout the
canvas uses, so positions and hug sizes match; SVG also takes `textLines` (CanvasKit line breaks) and HTML maps
flex frames to flexbox, variables to CSS custom properties. The editor's Export section
(`apps/web/src/export/export-actions.ts`) adds PNG via `renderNodeImage` with a transparent background. When
you add a node prop, update the canvas renderer and both exporters together, and check them side by side.

## Agent

- Tools: `packages/agent/src/tools.ts` (registry), `tools-edit.ts`, `tools-inspect.ts`, `edit/`, `inspect/`.
- Prompts: `prompts.ts`. Design guides (`get_guidelines`): `guides/`. Style presets (`list_styles`,
  `get_style`): `styles/presets.ts`.
- BYOK models: planner `claude-opus-5-5`, executor `claude-sonnet-5-5` (`apps/web/src/agent/api-runtime.ts`).
- Plan and progress always go through `report_plan` / `report_step` so every backend drives the same panel.
- MCP (`apps/bridge/src/mcp.ts`): every tool carries annotations (`packages/agent/src/annotations.ts`); add a new
  tool there too. Over HTTP the bridge also serves `open_document` / `save_document`
  (`apps/bridge/src/file-tools.ts`): the bridge reads and writes absolute `.pego` paths (reads `.pen`), the
  editor parses and serializes (`apps/web/src/persistence/bridge-documents.ts`), and File → Save writes back to
  that path through the bridge. Only one editor tab is connected at a time; a replaced tab waits for "Use this
  window" instead of reconnecting.
- `get_code` returns a node as HTML/CSS (via `@pego/export`) so Claude Code can implement a design; image fills
  are replaced by file names to keep the result small.
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
