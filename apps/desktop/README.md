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

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes only `window.pegoDesktop` (`platform`, `version`, update calls) over a fixed IPC channel allowlist; main checks the sender is the app origin and statuses are validated on both sides.
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
gh release edit vX.Y.Z --draft=false   # publishing the draft is what ships the update
```

Required repo secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific password). The job fails if any is missing and verifies signature,
stapled ticket and Gatekeeper acceptance of both DMGs before creating the draft. It attaches both DMGs, both zips,
their blockmaps and `latest-mac.yml` using the built-in `GITHUB_TOKEN` (`contents: write`); no other secret is needed.

## Auto-update

- Feed: published releases of the public repo `pego-ink/pego-desktop` (GitHub provider, no token in the app; `src/constants.ts`
  and `publish` in `electron-builder.yml`). Drafts are invisible, so **publishing the draft release ships the update**.
- `electron-builder` is run with `--publish never` in CI; it still writes `latest-mac.yml` (one file listing the arm64 and
  x64 zip + dmg; `channel: latest` keeps that name even for `-beta` versions). macOS updates need the zip target and a
  signed + notarized app. Squirrel.Mac verifies the new build is signed by the same identity before installing.
- `src/updater.ts`: packaged builds only. Checks 10s after launch and every 6h, `autoDownload` and `autoInstallOnAppQuit`
  on. Status goes to the renderer over IPC (`src/update-status.ts` holds the status model, validation and channel names);
  the web app reads it from `window.pegoDesktop` (`apps/web/src/desktop`). `desktop:dev` skips the updater.
- Pre-releases: electron-updater sets `allowPrerelease` from the installed version. A `-beta` build (current) accepts beta
  and stable releases (mark `-beta` releases as pre-release; the workflow does); a stable build only sees stable ones.
  So once a stable version ships, beta testers have to install a beta build by hand to go back on the beta line.
- Test the UI without a release: `PEGO_FAKE_UPDATE=1 bun run desktop:dev` replays checking, available, downloading and
  ready over a few seconds (3s after launch, and again on "check for updates"). `installUpdate` is a no-op there.
- Test the real path: build version X, install it, publish a release of X+1 and wait for the notice (or relaunch).
