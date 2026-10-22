declare const __APP_VERSION__: string | undefined;

/** Build-time package version (injected by Vite `define`); undefined outside a Vite build (tests). */
export const WEB_VERSION: string | undefined =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined;
