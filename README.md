# Pego

AI-native design editor. Skia (CanvasKit) canvas, local-first `.pego` files, and an agent that edits the
canvas live: with your own Anthropic API key, or with your local Claude Code. See [STACK.md](STACK.md) for
the architecture.

## Requirements

- [Bun](https://bun.sh) 1.3+
- A Chromium-based browser (Chrome, Edge, Arc) for the web app: CanvasKit needs WebGL2, and Save/Open uses the
  File System Access API (other browsers fall back to download/upload).
- Optional: [Claude Code](https://claude.com/claude-code) CLI, installed and logged in, for the Claude Code backend.
- Desktop app: macOS (signed), Linux (AppImage, deb) and Windows (installer), x64; macOS also arm64.

## Install

```bash
bun install
```

## Run the editor (web)

```bash
bun run dev
```

Open http://localhost:5173. This also starts `apps/api` (Hono on Workers via wrangler), which the editor does not
need; to run only the editor: `bun run --cwd apps/web dev`.

Pego opens on the **Dashboard**: the projects of this repository (`design/<project>/` with a `project.json` and
the design itself, `project.pego`, listed by the bridge with a preview). Open a project to get its own tab in the header with its files in the left panel; documents
open as tabs above the canvas and autosave in the browser (IndexedDB). **Scratch** holds documents outside any
project. Use **File → Save / Open** (`⌘S`, `⌘O`) for `.pego` files anywhere on disk.

From Claude Code, name the project: "open project Pego Website and add a pricing section" (or use its id); the
MCP tools `list_projects`, `open_project` and `create_project` do the rest.

## Use the agent

Open the **Agent** tab (top left), then pick a backend:

- **API key**: click _Add key_ and paste an Anthropic API key. It stays in this browser and is sent only to
  `api.anthropic.com`. Opus 5.5 plans, Sonnet 5.5 executes each step.
- **Claude Code (local)**: start the bridge in a second terminal, then send a prompt. Runs use your Claude Code login,
  no API key.

  ```bash
  bun run bridge
  ```

Every agent step is one undo step; _Undo all_ reverts a whole run.

## Drive Pego from Claude Code in a terminal (MCP)

With the editor open and `bun run bridge` running, register Pego's MCP server once:

```bash
claude mcp add --transport http pego http://127.0.0.1:4519/mcp
```

Then ask Claude Code to design; changes appear live in the open Pego tab. The server also exposes design guides as
resources and the prompts `design_screen`, `polish_selection` and `extract_components`.

The bridge listens on `127.0.0.1:4519` only and accepts editor connections from localhost origins (and `app://pego`
for the desktop app).

## Desktop app

```bash
bun run desktop:dev     # Electron on top of the Vite dev server, bridge included
bun run desktop:build   # build for this machine into apps/desktop/release (macOS: signed, not notarized locally)
bun run desktop:build -- --linux --x64   # AppImage + deb
bun run desktop:build -- --win --x64     # NSIS installer (build on Windows)
```

The desktop app starts the bridge itself; Claude Code runs need the `claude` CLI on your PATH. Details:
[apps/desktop/README.md](apps/desktop/README.md).

## Checks

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test        # runs each workspace's tests from its own folder
```

CI runs the same on every push to `main`.

## Release

1. Bump `version` in `apps/desktop/package.json`, commit.
2. Tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. The `release` workflow builds arm64 + x64 dmg/zip, signs with Developer ID, notarizes, verifies, and creates a
   **draft** GitHub release. Review it, then `gh release edit vX.Y.Z --draft=false`.

Needs these repository secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password). The workflow fails if any is missing.

## Layout

```
apps/
  web/       React + Vite editor (canvas, panels, agent runtime)
  bridge/    local Bun server: MCP for Claude Code + Agent SDK runs
  desktop/   Electron shell (macOS, Linux, Windows)
  api/       Hono on Workers (not used by the editor yet)
packages/
  doc/       document schema, ops, undo history, flex layout
  agent/     agent tools, prompts, guides, style presets, bridge protocol
  export/    HTML/CSS and SVG export of a node (pure, shared by the editor and the agent)
  ui/        shared UI components and tokens
design/      design mocks (.pen, png, html)
```
