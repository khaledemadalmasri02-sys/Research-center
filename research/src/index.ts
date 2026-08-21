import { Hono, Context } from "hono";

// This Worker now acts as a thin edge layer for research-center.fit:
//   - static SPA assets are served by Cloudflare Assets (run_worker_first=/api/*)
//   - every /api/* request is reverse-proxied to the Postgres-backed api-server
//     (exposed locally via a cloudflared tunnel). This makes the FULL feature
//     set (records, signup, users, admin, feedback, patients) available at the
//     domain, sourced from the api-server rather than D1.
const app = new Hono<{
  Bindings: {
    API_BACKEND_URL: string;
    ASSETS: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
  };
}>();

app.all("/api/*", async (c: Context) => {
  const base = (c.env.API_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    return c.json({ error: "API_BACKEND_URL is not configured" }, 500);
  }

  const url = new URL(c.req.url);
  const target = `${base}${url.pathname}${url.search}`;

  // Forward the original request (method, headers, body, cookies) and tell the
  // api-server the real client IP for rate-limiting / audit. Build the request
  // explicitly (rather than `new Request(target, c.req.raw)`) so the Cookie
  // header is reliably copied through to the origin.
  const init: RequestInit = {
    method: c.req.method,
    headers: c.req.raw.headers,
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = c.req.raw.body;
  }
  const req = new Request(target, init);
  const cookie = c.req.header("cookie");
  if (cookie) req.headers.set("cookie", cookie);
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) req.headers.set("X-Forwarded-For", cfIp);

  const res = await fetch(req);
  return res;
});

// Non-API requests are served by Static Assets (SPA). Because of
// run_worker_first = ["/api/*"], this handler is only reached for unmatched
// API routes; in that case we surface a 404.
app.all("*", async (c: Context) => {
  const assets = c.env.ASSETS;
  if (assets) {
    const res = await assets.fetch(c.req.url);
    if (res) return res;
  }
  return new Response("Not Found", { status: 404 });
});

export default app;
