import { protocol, net } from "electron";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAppFile } from "@/app-path";
import { APP_HOST, APP_SCHEME, CONTENT_SECURITY_POLICY } from "@/constants";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Must run before `app.whenReady()`. */
export const registerAppScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
};

/** Serve `root` (the web build) at `app://pego/` so absolute /assets and /fonts paths work. */
export const registerAppProtocol = (root: string): void => {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response("Not found", { status: 404 });
    const file = await resolveAppFile(root, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    const upstream = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(upstream.headers);
    headers.set("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, { status: upstream.status, headers });
  });
};
