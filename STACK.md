# Pego — Stack & Architecture

Agentic design tool (Figma alternative). Decisions made 2026-10-22.

## Decisions

| Area | Choice | Notes |
|---|---|---|
| Monorepo | Bun workspaces | `apps/*`, `packages/*` |
| Web app | React + Vite + TypeScript | SPA, Tailwind v4, shadcn/ui, Zustand, TanStack Query, Zod, react-hook-form |
| Canvas | **Skia via CanvasKit WASM** (`canvaskit-wasm` 0.42.0, Ganesh on WebGL2), custom scene graph | Same engine as pen.dev (which ships its own Emscripten Skia build). Text via `skparagraph` (HarfBuzz + ICU), image decode and PNG/PDF export via Skia. Own document model; Skia only renders. Hit-testing, selection, transforms and flex layout are ours. Custom slim Skia build later if the ~7–10 MB WASM becomes a problem. |
| Document / undo | **Single user, no CRDT (for now)** | Immutable document in Zustand + operation log (insert/update/replace/move/delete). Undo = inverse ops. Keep ops serializable so Yjs can replace the store later without touching the renderer or the agent. |
| Agent | **Runs client-side, two backends** (decided 2026-10-22) | (1) **BYOK in the browser**: user's own Anthropic API key (IndexedDB, sent only to api.anthropic.com), `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`; planner `claude-opus-5-5` (structured plan), executor `claude-sonnet-5-5` (streaming tool loop), server-side refusal fallbacks on. (2) **Local Claude Code** via `apps/bridge` (Bun, 127.0.0.1:4519): MCP Streamable HTTP for Claude Code in a terminal (`claude mcp add --transport http pego http://127.0.0.1:4519/mcp`) and Claude Agent SDK runs started from the panel with the user's Claude Code login. All backends call the same provider-neutral tools in `packages/agent`, executed by the editor tab; one agent step = one undo transaction. |
| Persistence | **Local-first files** (decided 2026-10-22) | Documents are `.pego` files (JSON: `{ format: "pego", version, document }`, validated with the Zod schema) opened/saved via the File System Access API, download/upload fallback where unsupported. Autosave of the open document to IndexedDB so a refresh never loses work. No server, database or login for documents. |
| Auth / DB / Storage | **Deferred** | Supabase Postgres (Drizzle), Cloudflare R2 and custom JWT only come back if cloud sync/sharing is added later. |
| Deploy | Cloudflare Pages (web) | `apps/api` (Hono on Workers) is not needed by the client-side agent; frozen until a server feature needs it. |
| Desktop (later) | **Electron** wrapping `apps/web` as `apps/desktop` | Bundled Chromium = identical CanvasKit/WebGL2 rendering on every OS (Tauri's system webviews differ, WebKitGTK is weak). Same choice as Figma desktop and pen.dev. Web first; desktop not scaffolded yet. |
| Lint/format | ESLint + Prettier | |
| Tests | `bun test` | |

## Layout

```
pego/
  apps/
    web/            React + Vite + CanvasKit editor
    api/            Hono on Workers (frozen; not used by the client-side agent)
    bridge/         Local Bun bridge: MCP server + Claude Agent SDK runs, talks to the editor over WebSocket
  packages/
    doc/            Document schema (Zod), ops, apply/invert, layout engine (flex), validation
    agent/          Provider-neutral tools, document serialization, prompts, bridge protocol; pure, no I/O
    ui/             shadcn components + tokens (mono dark palette)
  design/           Exported designs (png/html) + pego.pen source
```

## Core idea: one op vocabulary

Everything that mutates a document — UI gestures, undo/redo, the AI agent, future multiplayer — goes through the same ops defined in `packages/doc`:

`insert`, `update`, `replace`, `move`, `delete`, `setVariables`

The agent never touches the renderer or React. It calls tools that emit ops; the client applies them and the renderer reacts. This is what makes "agent works live on canvas" cheap, and keeps the Yjs migration local to the store.

## Document model (v0)

Mirrors the `.pen` schema used for the design mock, simplified:

- Node types: `frame`, `group`, `rectangle`, `ellipse`, `path`, `text`, `icon`, `ref` (component instance)
- Frame layout: `none | horizontal | vertical`, `gap`, `padding`, `justifyContent`, `alignItems`
- Sizing: number | `fill_container` | `fit_content`
- Variables (`$name`) for colors, numbers, strings
- `reusable: true` marks a component; `ref` + `descendants` overrides for instances

## Agent run model

```
POST /agent/runs            -> { runId }   (prompt, fileId, attachments)
GET  /agent/runs/:id/events -> SSE: plan | step.start | op | step.done | decision | done | error
POST /agent/runs/:id/decide -> { stepId, choice }
```

- Planner (opus) returns a step list.
- Executor (sonnet) runs each step with document tools; every tool call becomes an `op` event.
- `decision` events pause a step and wait for `/decide`; other independent steps continue.

## UI screens (see design/)

1. Editor — layers | canvas | properties
2. Agent working — agent panel (plan, live step, decision card, composer) | canvas with per-screen status, ghost outline on the element being edited, changes bar (undo all / review)
