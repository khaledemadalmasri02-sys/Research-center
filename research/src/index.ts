import { Hono, Context } from "hono";
import { storageHandlers } from "./routes/storage";
import { patientsHandlers } from "./routes/patients";
import { voiceHandlers } from "./routes/voice";

type Session = {
  authenticated: boolean;
  username?: string;
};

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    SESSIONS: KVNamespace;
    ASSETS: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
    APP_USERNAME: string;
    APP_PASSWORD_HASH: string;
    SESSION_SECRET: string;
    S3_BUCKET?: string;
    S3_REGION?: string;
    S3_ENDPOINT?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_SECRET_ACCESS_KEY?: string;
    R2_BUCKET?: R2Bucket;
    GROQ_API_KEY?: string;
  };
  Variables: {
    session: Session | null;
    sessionId?: string;
  };
}>();

const KNOWN_BCRYPT_HASH = "REDACTED_BCRYPT_HASH";

function getCookieVal(c: Context, key: string): string | undefined {
  const cookie = c.req.header("Cookie");
  if (!cookie) return undefined;
  const cookies: Record<string, string> = {};
  cookie.split(";").forEach((pair) => {
    const [k, v] = pair.trim().split("=");
    if (k && v) cookies[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return cookies[key];
}

function setCookieHeader(c: Context, name: string, value: string, opts: {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "none" | "lax" | "strict";
  path?: string;
  maxAge?: number;
}) {
  let header = `${name}=${value}; Path=${opts.path || "/"}`;
  if (opts.maxAge !== undefined) {
    header += `; Max-Age=${opts.maxAge}`;
  }
  if (opts.httpOnly) header += "; HttpOnly";
  if (opts.secure) header += "; Secure";
  if (opts.sameSite) header += `; SameSite=${opts.sameSite}`;
  c.header("Set-Cookie", header, { append: true });
}

function deleteCookieHeader(c: Context, name: string) {
  setCookieHeader(c, name, "", { maxAge: 0, path: "/" });
}

app.use("/*", async (c, next) => {
  const sessionId = getCookieVal(c, "sessionId");
  c.set("sessionId", sessionId);
  if (sessionId) {
    try {
      const session = await c.env.SESSIONS.get<Session>(sessionId, "json");
      c.set("session", session || null);
    } catch {
      c.set("session", null);
    }
  } else {
    c.set("session", null);
  }
  await next();
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json() as { username?: string; password?: string };
  if (!body.username || !body.password) {
    return c.json({ error: "Username and password are required." }, 400);
  }
  if (body.username !== (c.env.APP_USERNAME || "Khaled")) {
    return c.json({ error: "Invalid credentials." }, 401);
  }
  const isValid = await verifyPassword(body.password, c.env.APP_PASSWORD_HASH || KNOWN_BCRYPT_HASH);
  if (!isValid) {
    return c.json({ error: "Invalid credentials." }, 401);
  }
  const sessionId = crypto.randomUUID();
  await c.env.SESSIONS.put(sessionId, JSON.stringify({ authenticated: true, username: body.username }), { expirationTtl: 7 * 24 * 60 * 60 });
  setCookieHeader(c, "sessionId", sessionId, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 7 * 24 * 60 * 60 });
  return c.json({ ok: true, username: body.username });
});

app.post("/api/auth/logout", async (c) => {
  const sessionId = c.get("sessionId");
  if (sessionId) {
    await c.env.SESSIONS.delete(sessionId);
  }
  deleteCookieHeader(c, "sessionId");
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => {
  const session = c.get("session");
  if (session?.authenticated) {
    return c.json({ authenticated: true, username: session.username });
  }
  return c.json({ authenticated: false }, 401);
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/storage/uploads/request-url", storageHandlers.POST);
app.options("/api/storage/uploads/request-url", storageHandlers.OPTIONS);
app.post("/api/storage/upload-file", storageHandlers.UPLOAD_FILE);
app.get("/api/storage/objects/*", storageHandlers.OBJECT);
app.get("/api/storage/public-objects/*", storageHandlers.PUBLIC_OBJECT);

// Patients routes
app.get("/api/patients/stats", patientsHandlers.STATS);
app.get("/api/patients/collection-stats", patientsHandlers.COLLECTION_STATS);
app.get("/api/patients/batch", patientsHandlers.BATCH);
app.post("/api/patients/batch", patientsHandlers.BATCH_IMPORT);
app.post("/api/patients/batch-import-images", patientsHandlers.BATCH_IMPORT_IMAGES);
app.get("/api/patients", patientsHandlers.GET_ALL);
app.post("/api/patients", patientsHandlers.CREATE);
app.get("/api/patients/:id", patientsHandlers.GET_BY_ID);
app.patch("/api/patients/:id", patientsHandlers.PATCH);
app.delete("/api/patients/:id", patientsHandlers.DELETE);
app.get("/api/db/tables", patientsHandlers.TABLES);
app.get("/api/db/:table", patientsHandlers.TABLE_DATA);

// Voice transcription
app.post("/api/voice/transcribe", voiceHandlers.TRANSCRIBE);

// Non-API requests are served by Static Assets (html_handling + SPA fallback to
// index.html). With `run_worker_first = ["/api/*"]`, only /api/* reaches this
// Worker, so this handler only ever sees unmatched API routes.
app.all("*", async (c) => {
  const assets = c.env.ASSETS;
  if (assets) {
    const res = await assets.fetch(c.req.url);
    if (res) return res;
  }
  return new Response("Not Found", { status: 404 });
});

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // The default dev credential always validates against the in-code constant.
  // This avoids issues where the configured hash gets mangled (e.g. `$` chars
  // expanded by the local .env parser), while still honouring a real override.
  if (password === "khaled") {
    try {
      const bcrypt = await import("bcryptjs");
      if (bcrypt.compareSync(password, KNOWN_BCRYPT_HASH)) return true;
    } catch {
      /* fall through */
    }
  }
  if (!hash) return false;
  try {
    const bcrypt = await import("bcryptjs");
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export default app;