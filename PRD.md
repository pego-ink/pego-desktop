# Pego: Product Requirements Document

Status: **draft**, 2026-10-22. Owners: the Pego team. Architecture: [STACK.md](STACK.md). Contributor guide:
[CLAUDE.md](CLAUDE.md).

## 1. Summary

Pego is an AI-native design editor: you describe a screen and an agent designs it live on a real canvas, and you
keep editing it by hand. Files are local `.pego` JSON that live in your repo next to the code. Pego aims to replace
Pencil (pen.dev) by offering the same agent-first workflow with an open file format, a choice of AI backends, and
the core design features that tools like Penpot have proven teams need.

## 2. Problem

- Designers and developers increasingly use coding agents (Claude Code, Codex, Cursor) but design tools are not
  built for agents to work in. Figma's model is cloud-first and closed; agents get read access at best.
- Pencil proved the agent-first design workflow (`.pen` files in git, MCP into Claude Code), but it is closed
  source and tied to its own app.
- Penpot is open source and full-featured, but it is a Figma replacement for teams first; its MCP support is
  experimental and it needs a server.

## 3. Positioning

|               | Pencil (pen.dev)        | Penpot                      | **Pego**                            |
| ------------- | ----------------------- | --------------------------- | ----------------------------------- |
| Core idea     | Agent-first design      | Open-source Figma for teams | Agent-first design, open            |
| Source        | Closed                  | Open (MPL-2.0)              | Open (license to decide)            |
| Files         | `.pen` JSON in the repo | Server database, export     | `.pego` JSON in the repo            |
| AI            | MCP + Claude Code       | MCP (experimental)          | MCP + Claude Code + in-browser BYOK |
| Collaboration | Through git             | Real-time multiplayer       | Through git now, real-time later    |
| Hosting       | Desktop app             | Cloud or self-hosted server | Web (no server) + desktop           |

One line: **"Pencil, but open: agent-first design that lives in your repo."**

## 4. Target users

1. **Developer who designs**: builds the product with Claude Code and needs screens without leaving the
   terminal/editor workflow.
2. **Product designer on an AI-heavy team**: wants the agent to draft layouts and variants, then refines them by
   hand.
3. **Pencil user** who wants an open format or their own API key.

## 5. Goals and non-goals

Goals:

- G1. An agent can design a complete, well-structured screen (layout, components, variables) from a prompt.
- G2. Designs round-trip to code: the agent can read a `.pego` file and implement it, and export gives usable
  HTML/CSS.
- G3. Pencil users can bring their `.pen` files over.
- G4. Hand editing is good enough that users never need another tool to fix what the agent made.
- G5. Works without a server or account: local files, any of three AI backends.

Non-goals (for now):

- Full Figma parity (vector networks, advanced prototyping, dev-mode handoff).
- Hosted cloud accounts, billing, or a document database.
- Real-time multiplayer (planned later, see M3).

## 6. Current state (v0, shipped)

- CanvasKit renderer for frame, group, rectangle, ellipse, path, text, icon (lucide), and component instances.
- Flex layout (horizontal/vertical, gap, padding, justify/align, fit/fill sizing), variables (color/number/string).
- Editor: layers, properties, selection, move/resize, text editing, undo/redo, shortcuts.
- `.pego` save/open (File System Access API) and IndexedDB autosave.
- Agent: about 29 tools (batch design, components, screenshots, layout check, search, selection, guides, style
  presets), planner/executor in the browser with your own key, Claude Code runs via the bridge, MCP server for
  Claude Code in a terminal. One agent step = one undo step; "Undo all" per run.
- macOS desktop app (Electron), signed and notarized release pipeline.
- Format v1 with migrations: shadows, layer blur, per-side borders, line height and letter spacing.
- `.pen` import through File → Open (M1-1, P0 part), with a warning list for anything not converted.
- Linear/radial gradient and embedded image fills; export of a node to PNG (1x-3x), SVG and HTML/CSS (M1-2,
  M1-3, M1-4, M1-5); agent tool `get_code` for design-to-code.
- Multiple pages per document (M1-6), web fonts from Fontsource (M1-7), Linux and Windows desktop builds
  (M1-8), drag & drop of files and images.

## 7. Requirements by milestone

Priority: **P0** must ship in the milestone, **P1** should, **P2** nice to have.

### M1: Switch from Pencil

| ID   | Requirement                                                                                          | Priority |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- |
| M1-1 | Import `.pen` files into a `.pego` document; unsupported features are reported, not silently dropped | P0       |
| M1-2 | Export a frame to HTML/CSS (flex layout maps to CSS flexbox, variables to CSS custom properties)     | P0       |
| M1-3 | Export a frame or selection to PNG and SVG                                                           | P0       |
| M1-4 | Schema: linear/radial gradients, drop/inner shadow, blur                                             | P0       |
| M1-5 | Schema: image fill and image nodes (stored next to the file or embedded)                             | P0       |
| M1-6 | Multiple pages per document                                                                          | P1       |
| M1-7 | Text: line height, letter spacing, text decoration, multiple fonts (Google Fonts)                    | P1       |
| M1-8 | Desktop app for Linux and Windows                                                                    | P1       |
| M1-9 | File version migration: v0 files keep opening after schema changes                                   | P0       |

### M2: Design systems

| ID   | Requirement                                                                                     | Priority |
| ---- | ----------------------------------------------------------------------------------------------- | -------- |
| M2-1 | Design tokens: variables grouped into collections with modes (light/dark), exported as CSS/JSON | P0       |
| M2-2 | Shared libraries: use components and tokens from another `.pego` file                           | P1       |
| M2-3 | Component variants and properties (e.g. button size/state)                                      | P1       |
| M2-4 | Grid layout (CSS Grid model) next to flex                                                       | P1       |
| M2-5 | Export to React components (agent-assisted)                                                     | P1       |
| M2-6 | Agent: "extract components" and "apply style preset" across a whole document                    | P2       |

### M3: Collaboration and ecosystem

| ID   | Requirement                                                                    | Priority |
| ---- | ------------------------------------------------------------------------------ | -------- |
| M3-1 | Comments on canvas, stored in the file                                         | P1       |
| M3-2 | Real-time multiplayer via Yjs (replaces the document store; ops stay the same) | P1       |
| M3-3 | Plugin API built on the same agent tools, with a sandbox                       | P2       |
| M3-4 | Basic prototyping: links between frames, preview mode                          | P2       |
| M3-5 | Optional self-hostable sync server                                             | P2       |

## 8. Product principles

1. **Agent and human are equals.** Everything the agent can do, a user can do in the UI, and the reverse. Both go
   through the same ops.
2. **Files over servers.** A `.pego` file is readable, diffable JSON that belongs in git.
3. **Every agent change is reversible.** One step = one undo step; a whole run can be undone.
4. **Bring your own AI.** No Pego account is needed to use the agent.
5. **Open format.** The schema is documented (CLAUDE.md) and versioned; no lock-in.

## 9. Success metrics (proposals)

- Agent quality: share of prompts in a fixed eval set that produce a screen with no `check_layout` issues and that
  a reviewer accepts without manual fixes.
- `.pen` import: share of sample Pencil files that import with no lost features.
- Export fidelity: pixel diff between the canvas and exported HTML for a reference set.
- Adoption (after open-source release): GitHub stars, weekly active desktop installs, community plugins.

## 10. Risks

- **CanvasKit size** (~7–10 MB WASM) slows first load; mitigation: custom slim Skia build, caching.
- **`.pen` format is not public** and may change; mitigation: version-detect, keep the importer isolated.
- **Token cost** of agent runs; mitigation: smaller executor model, `batch_design`, caching, screenshots only when
  needed.
- **Two contributors, shared core files**: mitigation: PR flow and the hot-spot list in CLAUDE.md.

## 11. Open questions

- License: MIT, Apache-2.0 or MPL-2.0 (like Penpot)?
- Is there a paid offering later (hosted sync, team libraries), and does that change the license choice?
- Should `.pego` adopt `.pen` as its native format instead of importing it?
- Branch naming and release cadence for the team (to be decided after repo setup).
