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
 * Custom model providers (Model settings > Custom providers) are called straight from the
 * renderer with the user's own key, and the base URL is whatever the user types: OpenRouter,
 * DeepSeek, a self-hosted gateway, or an Ollama / LM Studio server on this machine. So
 * `connect-src` must allow any https origin plus http on loopback. Plain http to a remote host
 * stays blocked here (and the provider form refuses it too), so a key never crosses the network
 * unencrypted. Nothing else in the policy is relaxed.
 */
const CUSTOM_PROVIDER_CONNECT = "https: http://localhost:* http://127.0.0.1:*";

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
  `connect-src 'self' https://api.anthropic.com ${FONT_CDN_ORIGIN} ${CUSTOM_PROVIDER_CONNECT} ws://${BRIDGE_HOST}:${BRIDGE_PORT} http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");
