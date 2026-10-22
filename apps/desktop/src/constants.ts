export const APP_SCHEME = "app";
export const APP_HOST = "pego";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_URL = `${APP_ORIGIN}/`;

export const BRIDGE_HOST = "127.0.0.1";
export const BRIDGE_PORT = 4519;

/** Vite dev server origin used by `desktop:dev` (apps/web/vite.config.ts, strictPort). */
export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Google Fonts (apps/web/src/fonts/font-service.ts): picker previews load a CSS2 stylesheet from
 * fonts.googleapis.com whose files come from fonts.gstatic.com; the actual font bytes for the
 * canvas are fetched from the google/fonts repo through cdn.jsdelivr.net.
 */
const FONT_STYLE_ORIGIN = "https://fonts.googleapis.com";
const FONT_FILE_ORIGIN = "https://fonts.gstatic.com";
const FONT_CDN_ORIGIN = "https://cdn.jsdelivr.net";

/**
 * CSP for the packaged app. CanvasKit needs `wasm-unsafe-eval`; Tailwind/Radix inject inline
 * styles, so styles allow `unsafe-inline` (scripts do not).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  `style-src 'self' 'unsafe-inline' ${FONT_STYLE_ORIGIN}`,
  "img-src 'self' data: blob:",
  `font-src 'self' data: ${FONT_FILE_ORIGIN}`,
  `connect-src 'self' https://api.anthropic.com ${FONT_CDN_ORIGIN} ws://${BRIDGE_HOST}:${BRIDGE_PORT} http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");
