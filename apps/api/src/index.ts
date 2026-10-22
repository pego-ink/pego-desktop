import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";

const WEB_DEV_ORIGIN = "http://localhost:5173";

const app = new Hono<AppEnv>();

app.use("*", cors({ origin: [WEB_DEV_ORIGIN], credentials: true }));

app.get("/health", (c) => c.json({ ok: true }));

export default app;
