# @pego/desktop

Electron shell for Pego. It serves the built web app (`apps/web/dist`) from a privileged
`app://pego/` protocol and starts the local bridge (`apps/bridge`) as a child process, so the
desktop app gives the canvas, the agent panel and Claude Code MCP without a terminal.

- appId `id.yolk.pego`, product name `Pego`, macOS only for now (dmg + zip, arm64 + x64).
- Single instance. Main/preload are bundled with `Bun.build` (`scripts/bundle.ts`) to CJS.

## Develop

```bash
bun run desktop:dev      # Vite on :5173 + Electron pointing at it; bridge started with `bun run`
bun run desktop:build    # web build + bridge binary + signed arm64 dmg/zip in apps/desktop/release
```

`desktop:build` signs with the Developer ID found in the keychain and notarizes only when
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set. Extra args go to
electron-builder: `bun run desktop:build -- --mac --arm64 --x64` (must include an arch flag).

## Security model

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload only exposes `window.pegoDesktop.platform`.
- Navigation and `window.open` to anything outside the app origin are blocked; `https:` links open in the system browser.
- All permission requests are denied (the editor needs none).
- CSP is attached to every `app://pego` response (see `src/constants.ts`): `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src` limited to `'self'`, `https://api.anthropic.com` and the bridge on `127.0.0.1:4519`.
  It is not applied in `desktop:dev` (Vite HMR needs inline scripts).
- The bridge only accepts editor sockets from `app://pego` and the Vite dev origin
  (`PEGO_ALLOWED_ORIGINS`), and only requests with a loopback `Host` header.

## Bridge packaging

`bun build --compile --target=bun-darwin-<arch> apps/bridge/src/index.ts` produces a standalone binary,
shipped at `Contents/Resources/bridge/pego-bridge` and signed with the same entitlements as the app
(`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`; see `build/entitlements.mac.plist`).

If port 4519 is already taken (for example `bun run bridge` is running) the app logs it and reuses that bridge.
The app stops only the bridge it started.

Claude Code resolution: under `--compile` the Agent SDK's bundled CLI (a `node_modules` platform package) is not
reachable, so the bridge falls back to `claude` on `PATH`. The app passes a PATH that includes `~/.local/bin`,
`/opt/homebrew/bin` and `/usr/local/bin` so this works when launched from Finder. Users need the `claude` CLI
installed and logged in; the BYOK API-key backend works without it.

## Release

Tag must equal the version in `apps/desktop/package.json`:

```bash
# bump apps/desktop/package.json "version" to X.Y.Z, commit, then
git tag vX.Y.Z && git push origin main vX.Y.Z
gh run watch            # .github/workflows/release.yml
gh release edit vX.Y.Z --draft=false   # after checking the draft
```

Required repo secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific password). The job fails if any is missing and verifies signature,
stapled ticket and Gatekeeper acceptance of both DMGs before creating the draft.

## Auto-update (not enabled)

The repo is private, so an update feed would need a token inside the app. To add updates later:

1. Create a public releases repo (for example `yolkmonday/pego-releases`) and publish the dmg/zip + `latest-mac.yml` there
   (`publish: { provider: github, owner, repo }` in `electron-builder.yml`, with `GH_TOKEN` for that repo in CI).
2. Add `electron-updater` as a dependency of `@pego/desktop`, bundle it into `main.cjs`, and call
   `autoUpdater.checkForUpdatesAndNotify()` after the window is ready (packaged builds only).
3. macOS updates need the zip target and a signed + notarized app, which this pipeline already produces.
