# Contributing to Pego

Thanks for helping. Pego is an AI-native, local-first design editor. These rules keep the codebase consistent and the
review loop short.

## Before you start

- **Small fix** (typo, obvious bug, missing test): open a pull request directly.
- **Feature or behaviour change**: open an [issue](https://github.com/yolkmonday/pego/issues) first and describe the
  problem, not only the solution. Wait for a maintainer to agree on the direction before writing a lot of code.
- **Security issue**: do not open a public issue. Report it privately through
  [GitHub security advisories](https://github.com/yolkmonday/pego/security/advisories/new).

## Setup

Requirements, install and run commands are in the [README](README.md). In short:

```bash
bun install
bun run dev            # web editor + local bridge
bun run desktop:dev    # Electron shell (macOS)
```

Use **Bun** for everything (`bun install`, `bun run`, `bun test`, `bunx`). Do not add npm, yarn or pnpm lockfiles.

## Branches and pull requests

- Branch off `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`.
- `main` and `dev` are protected: changes land only through a pull request with at least one approving review. No
  force pushes to shared branches, and do not push to someone else's branch.
- One concern per pull request. Split unrelated refactors into their own PR.
- In the description, say what changed and why, how you tested it, and add a screenshot or short recording for any UI
  change.
- Keep the PR up to date with `main` and resolve review comments before asking for another review.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), in English, lowercase, short:

```
feat(web): frame presets for social media
fix(bridge): reconnect after editor reload
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`. Scope is the workspace you touched: `web`,
`desktop`, `bridge`, `api`, `doc`, `agent`, `ui`. Omit the scope when a change spans many workspaces.

## Checks

Run all of these before you open a pull request. CI runs the same on every pull request; a PR with a red check is not merged.

```bash
bun run typecheck
bun run lint
bun run format:check   # bun run format to fix
bun run test
```

## Code style

- TypeScript everywhere, strict mode. No `any` without a comment saying why.
- Functional style: `const` over `let`, arrow functions, early returns. No classes unless a framework needs them.
- Imports inside an app use the `@/` alias, not deep relative paths. Shared code goes through the `@pego/*` packages.
- File names: UI primitives `kebab-case.tsx` (`packages/ui`), feature components `PascalCase.tsx`, hooks
  `use-kebab-case.ts`, utilities `kebab-case.ts`.
- Comments explain why, not what. Match the density of the file you are editing.
- Prettier formats, ESLint lints. Do not hand-format against them.

## Project rules

These protect how Pego works. A PR that breaks one needs a strong reason in its description.

- **Local-first.** Documents, settings and API keys stay on the user's machine. No telemetry, no analytics, no remote
  storage, and no network call that the user did not ask for.
- **Document changes go through ops.** Edit documents only with the op engine in `packages/doc` so every change is
  validated and undoable. One user action or one agent step is one undo step.
- **Agent tools are provider-neutral.** Tools live in `packages/agent`, work for every backend (API key, local CLI,
  custom provider), validate their input, return coded errors, and come with tests.
- **Reuse the UI kit.** Use components from `packages/ui` and the existing motion and color tokens before creating new
  ones. New reusable components go in `packages/ui`, not next to a page. Match the spacing and patterns of existing
  panels, and keep keyboard access and `prefers-reduced-motion` working.
- **Tests sit next to the code** as `*.test.ts` and run with `bun test`. Bug fixes come with a test that fails
  without the fix.
- **No secrets in the repo.** Never commit API keys, certificates, `.env` files or signing material. Use
  `.env.example` with placeholder values.
- **Dependencies need a reason.** Prefer Web APIs and what the repo already uses. Say in the PR why a new package is
  needed.

## License

Pego is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed
under the same terms.
