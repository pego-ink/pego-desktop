# Pego browser extension

Send any web page, an element of it, or a screenshot from Chrome to the Pego canvas. Pages and
elements arrive as editable layers, through the same DOM snapshot and converter as the desktop
app's built-in browser.

## Use it

1. Build: `bun run --cwd apps/extension build` (output in `apps/extension/dist`).
2. In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and
   pick `apps/extension/dist`.
3. Copy the pairing code from Pego (Settings › Agent & Models › Browser extension) into the
   extension's **Pairing** section. Set the port only if the bridge is not on 4519.
4. On any page, open the extension: **Send this page as layers**, **Pick an element…** (click it on
   the page, Esc cancels) or **Send a screenshot**.

Pego must be open with its bridge running (the desktop app, or `bun run dev`).

## How it works

- `capture-page.js` / `capture-picked.js` are Pego's page snapshot script
  (`apps/web/src/browser/page-scripts.ts`), written out at build time: MV3 extensions cannot
  evaluate code strings.
- The service worker (`src/background.ts`) runs them, screenshots the visible tab, and posts the
  result to the bridge: `POST http://127.0.0.1:<port>/extension/import`.
- The bridge (`apps/bridge/src/extension.ts`) accepts only browser-extension origins with the
  pairing code (a random secret in `~/.pego/extension-token`, shown to the editor only), up to
  20 MB, and forwards the capture to the focused editor (`EDITOR_OPS.importCapture`).
- The editor (`apps/web/src/browser/extension-import.ts`) embeds the page's images (through the
  bridge's `/fetch-image` when a site blocks CORS), converts the snapshot to layers and places them
  beside the shown page's content.

Permissions: `activeTab` and `scripting` (only the tab you send, when you click), `storage` (the
pairing code), and `http://127.0.0.1/*` (the local bridge). Nothing is sent anywhere else.
