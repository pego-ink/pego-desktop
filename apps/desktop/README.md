# @pego/desktop

Electron shell for Pego. It serves the built web app (`apps/web/dist`) from a privileged
`app://pego/` protocol and starts the local bridge (`apps/bridge`) as a child process, so the
desktop app gives the canvas, the agent panel and Claude Code MCP without a terminal.

- appId `id.yolk.pego`, product name `Pego`. macOS: dmg + zip, arm64 + x64, signed and notarized.
  Linux (x64 + arm64): AppImage, deb, rpm, pacman, tar.gz. Windows (x64 + arm64): NSIS installer + portable zip.
  Linux and Windows builds are unsigned.
- Single instance. Main/preload are bundled with `Bun.build` (`scripts/bundle.ts`) to CJS.

## Install

Download from the [releases page](https://github.com/pego-ink/pego-desktop/releases) and check `SHA256SUMS.txt`
(`sha256sum -c --ignore-missing SHA256SUMS.txt`). Pick `arm64` for Apple Silicon and ARM machines, `x64` otherwise
(Linux names: `amd64`/`x86_64` in deb/rpm/pacman/AppImage files). macOS, the Windows installer and the Linux AppImage
auto-update (see Auto-update); deb, rpm, pacman, tar.gz and the Windows zip need a manual download. Linux and Windows
builds are unsigned.

- **macOS**: open the `.dmg`, drag Pego to Applications. Signed and notarized, so Gatekeeper opens it normally.
- **Windows**: run `Pego-<version>-win-<arch>.exe` (per-user install, no admin needed). SmartScreen shows "Windows
  protected your PC" because the build is unsigned: More info, then Run anyway. Portable: unzip
  `Pego-<version>-win-<arch>.zip` and run `Pego.exe`. On Windows on ARM both x64 and arm64 builds work.
- **Debian / Ubuntu**: `sudo apt install ./Pego-<version>-linux-<arch>.deb`
- **Fedora / RHEL / openSUSE**: `sudo dnf install ./Pego-<version>-linux-<arch>.rpm` (openSUSE: `sudo zypper install ./...rpm`)
- **Arch**: `sudo pacman -U ./Pego-<version>-linux-<arch>.pacman`
- **AppImage** (any distro): `chmod +x Pego-<version>-linux-<arch>.AppImage && ./Pego-<version>-linux-<arch>.AppImage`
  (needs FUSE 2, or run with `--appimage-extract-and-run`).
- **tar.gz** (generic): `tar xzf Pego-<version>-linux-<arch>.tar.gz`, then run `pego` in the extracted folder. If the
  app exits right away on a distro with restricted user namespaces, start it with `--no-sandbox`.

Pego also needs the `claude` CLI on PATH only for the Claude Code backend; the BYOK backend needs nothing.

## Develop

```bash
bun run desktop:dev      # Vite on :5173 + Electron pointing at it; bridge started with `bun run`
bun run desktop:build    # web build + bridge binary + app for this machine in apps/desktop/release
bun run desktop:build -- --linux --x64   # AppImage, deb, rpm, pacman, tar.gz (rpm/pacman need `rpm` and `bsdtar` installed)
```

`desktop:build` signs with the Developer ID found in the keychain and notarizes only when
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set. Extra args go to
electron-builder: `bun run desktop:build -- --mac --arm64 --x64` (must include an arch flag).

## Security model

- `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes only `window.pegoDesktop` (`platform`, `version`, update calls) over a fixed IPC channel allowlist; main checks the sender is the app origin and statuses are validated on both sides.
- Navigation and `window.open` to anything outside the app origin are blocked; `https:` links open in the system browser.
- All permission requests are denied (the editor needs none).
- CSP is attached to every `app://pego` response (see `src/constants.ts`): `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src` limited to `'self'`, `https://api.anthropic.com`, any `https:` origin plus loopback `http` (custom
  model providers the user configures; this also covers the font CDN `https://cdn.jsdelivr.net`) and the bridge on
  `127.0.0.1:4519`.
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
reachable, so the bridge falls back to `claude` on `PATH`. The app adds the usual install folders to the bridge's
`PATH` per platform (`src/platform.ts`: `~/.local/bin`, Homebrew and `/usr/local/bin` on macOS, `~/.bun/bin` on
Linux, `%APPDATA%\npm` on Windows), so this works when launched from Finder, a desktop launcher or the Start menu.
Users need the `claude` CLI installed and logged in; the BYOK API-key backend works without it.

## Release

Tag must equal the version in `apps/desktop/package.json`:

```bash
# bump apps/desktop/package.json "version" to X.Y.Z, optionally write apps/desktop/release-notes/X.Y.Z.md
# (used as the release body; otherwise GitHub generates notes), commit, then
git tag vX.Y.Z && git push origin main vX.Y.Z
gh run watch            # .github/workflows/release.yml (builds come from build.yml)
gh release edit vX.Y.Z --draft=false   # publishing the draft is what ships the update
```

To check the packaging before tagging, run the workflow by hand (Actions, Release, Run workflow, pick the branch):
it builds every OS/arch and uploads the artifacts, but skips the tag check and the release job.

Runners: `macos-latest` (arm64, builds both mac arches), `ubuntu-24.04` + `ubuntu-24.04-arm`, `windows-2025` +
`windows-11-arm` (native builds per arch). The release job adds `SHA256SUMS.txt`, titles the draft "Pego vX.Y.Z".

Required secrets (environment secrets of `release` and `nightly`, not repository secrets): `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific password). The job fails if any is missing and verifies signature,
stapled ticket and Gatekeeper acceptance of both DMGs before creating the draft. It attaches every installer, the
blockmaps and the update feeds (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`; the two
Windows builds each write a `latest.yml`, `.github/scripts/assemble-release.ts` merges them) using the built-in
`GITHUB_TOKEN` (`contents: write`); no other secret is needed.

### Nightly

`.github/workflows/nightly.yml` builds `dev` every night (19:00 UTC, or Run workflow on `dev`) through the same
`build.yml` with channel `nightly` and the version `<base>-nightly.<YYYYMMDD>.<run>.<attempt>`, and publishes a prerelease
`v<version>` (feeds `nightly-mac.yml`, `nightly.yml`, `nightly-linux.yml`, `nightly-linux-arm64.yml`). Windows builds
x64 only. It skips when `dev` equals the commit of the newest nightly and keeps the newest 7 nightly releases. The macOS
job signs in the `nightly` environment (deployment branch `dev`, required reviewer: one approval per nightly; see the
root README, Release, Nightly for the owner's one-time setup).
Local checks of the scripts: `bun test ./.github/scripts`.

## Auto-update

- Feed: published releases of the public repo `pego-ink/pego-desktop` (GitHub provider, no token in the app; `src/constants.ts`
  and `publish` in `electron-builder.yml`). Drafts are invisible, so **publishing the draft release ships the update**.
- `electron-builder` is run with `--publish never` in CI; it still writes the feed files per channel `<channel>`:
  `<channel>-mac.yml` (one file listing the arm64 and x64 zip + dmg), `<channel>.yml` (Windows, both arches),
  `<channel>-linux.yml` and `<channel>-linux-arm64.yml` (AppImage plus the other Linux packages). `channel: latest`
  keeps `latest*` even for `-beta` versions; nightlies pass `-c.publish.channel=nightly`. macOS updates need the zip
  target and a signed + notarized app (Squirrel.Mac verifies the new build is signed by the same identity). The
  Windows NSIS and Linux AppImage updaters work unsigned (no `publisherName`, so no signature check).
- `src/updater.ts`: packaged builds that can replace themselves (`canAutoUpdate` in `src/update-channel.ts`: macOS;
  Windows only for the NSIS install, detected by `Uninstall Pego.exe` next to the exe; Linux only as AppImage, i.e.
  `APPIMAGE` is set). Checks 10s after launch and every 6h, `autoDownload` and `autoInstallOnAppQuit`
  on. Status goes to the renderer over IPC (`src/update-status.ts` holds the status model, validation and IPC names);
  the web app reads it from `window.pegoDesktop` (`apps/web/src/desktop`). `desktop:dev` skips the updater.
- Update channel (Settings, About & Updates): `stable` or `nightly`, saved in `preferences.json` in the user data folder
  (`src/update-prefs.ts`). `feedSettings` in `src/update-channel.ts` maps it to electron-updater: nightly sets
  `channel = "nightly"` + `allowPrerelease` + `allowDowngrade` (the GitHub provider then takes the newest release whose
  tag has the `nightly` prerelease id and reads `nightly[-mac|-linux[-arm64]].yml`); an explicit stable sets
  `channel = "beta"`, `allowPrerelease = true`, `allowDowngrade = true` (the provider takes the newest beta or stable
  release, skips nightlies, reads `beta*.yml` and falls back to `latest*.yml`; not GitHub's "latest" release, which does
  not exist while only `-beta` prereleases are published; leaving nightly installs that build). Without a saved choice a nightly build follows nightly and every other build keeps
  electron-updater's defaults. Switching saves, stops a running download, checks right away and, off macOS,
  disarms install-on-quit for any file of the old channel. On macOS Squirrel/ShipIt installs a downloaded update on quit
  whatever that flag says, so `setChannel` refuses and the Settings control is disabled while an update is `ready`. The IPC pair is `pego:update:get-channel` / `set-channel`.
- Pre-releases: without a saved choice electron-updater sets `allowPrerelease` from the installed version. A `-beta` build
  (current) accepts beta and stable releases (mark `-beta` releases as pre-release; the workflow does); a stable build
  only sees stable ones; neither ever sees a nightly, because the GitHub provider skips releases with another
  prerelease id. So once a stable version ships, beta testers have to install a beta build by hand to go back on the
  beta line. The provider reads the repo's releases Atom feed (the newest 10 entries) when prereleases are allowed.
- Test the UI without a release: `PEGO_FAKE_UPDATE=1 bun run desktop:dev` replays checking, available, downloading and
  ready over a few seconds (3s after launch, and again on "check for updates"). `installUpdate` is a no-op there.
- Test the real path: build version X, install it, publish a release of X+1 and wait for the notice (or relaunch).

## App icon

`build/icon.svg` is the source (Pego mark on the macOS 1024px icon grid). Regenerate `build/icon.icns` after
changing it:

```bash
mkdir -p /tmp/pego.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s build/icon.svg -o /tmp/pego.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) build/icon.svg -o /tmp/pego.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns /tmp/pego.iconset -o build/icon.icns
```
