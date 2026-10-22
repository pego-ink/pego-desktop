# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Run/release steps live in
[README.md](README.md), architecture decisions in [STACK.md](STACK.md).

## Commands

```bash
bun install
bun run dev              # web editor on :5173 + the local bridge on 127.0.0.1:4519
bun run desktop:dev      # Electron app pointing at the Vite dev server
bun run typecheck
bun run lint
bun run format           # Prettier write; CI runs format:check
bun run test
```

Run `typecheck`, `lint` and `test` before calling a change done.

## Git

- Commit messages follow Conventional Commits with a scope: `feat(web): ...`, `fix(bridge): ...`.
- Do **not** add a `Co-Authored-By:` trailer for Claude (or any AI) to commits, and do not add a
  "Generated with Claude Code" line to pull request descriptions. Commits and PRs carry only the
  human author.
- Work on a branch and open a pull request; never push to `dev` or `main` directly.
