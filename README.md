<img src="design/logo/pego-mark.svg" alt="Pego" width="64" height="64">

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

Open http://localhost:5173. This starts the editor and the local bridge (`127.0.0.1:4519`), so local agents are
detected automatically. If a bridge is already running (for example the desktop app), the second one exits and the
editor uses the running one.

Pego opens the editor on a local document. Use **File → Save / Open** (`⌘S`, `⌘O`) for `.pego` files anywhere
on disk; once saved, changes autosave to the file, and everything is also kept in the browser (IndexedDB), so it
works offline. When the bridge is running in a repository with a `design/` folder, the Pego logo opens the
**Dashboard** with that repository's projects (`design/<project>/` with a `project.json` and the design,
`project.pego`). An open project gets its own tab in the header and autosaves to its `project.pego` through the
bridge; **Scratch** holds local documents outside any project.

From Claude Code, name the project: "open project Pego Website and add a pricing section" (or use its id); the
MCP tools `list_projects`, `open_project` and `create_project` do the rest.

## Use the agent

Open the **Agent** tab (top left), then pick a backend:

- **API key**: click _Add key_ and paste an Anthropic API key. It stays in this browser and is sent only to
  `api.anthropic.com`. Opus 5.5 plans, Sonnet 5.5 executes each step.
- **Local agents** (default): Claude Code, Codex, opencode, Qwen Code, Gemini CLI and Cursor Agent, detected
  automatically through the bridge that `bun run dev` starts. Each runs with your own login for that CLI, no API key.
  Pick the agent and model in the panel; ⚙ opens the Agents overview.

Every agent step is one undo step; _Undo all_ reverts a whole run.

## Drive Pego from Claude Code in a terminal (MCP)

With the editor open (`bun run dev` or the desktop app), register Pego's MCP server once:

```bash
claude mcp add --transport http pego http://127.0.0.1:4519/mcp
```

Then ask Claude Code to design; changes appear live in the Pego window you used last (several windows can stay
connected). The server also exposes design guides as resources and the prompts `design_screen`, `polish_selection` and `extract_components`.

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

1. Bump `version` in `apps/desktop/package.json` in a pull request and merge it into `main`.
2. Tag the merged commit on `main` and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The `release` workflow builds arm64 + x64 dmg/zip, signs with Developer ID, notarizes, verifies, and creates a
   **draft** release on [pego-ink/pego-desktop](https://github.com/pego-ink/pego-desktop/releases) with the dmg, zip, blockmaps and
   `latest-mac.yml`. Review it, then **publish it to ship the update**: `gh release edit vX.Y.Z --draft=false`.

Installed apps check the published releases of this public repo (launch + 10s, then every 6h), download in the
background and offer "Restart to update". Drafts are invisible to the updater, so nothing ships until you publish.
`-beta` versions are marked pre-release; a `-beta` build of the app picks up beta and stable releases, a stable build
only stable ones. No extra secrets: the workflow uses the built-in `GITHUB_TOKEN`.

Needs these repository secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password). The workflow fails if any is missing.
Details and local testing (`PEGO_FAKE_UPDATE=1`): [apps/desktop/README.md](apps/desktop/README.md#auto-update).

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

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

[MIT](LICENSE)
