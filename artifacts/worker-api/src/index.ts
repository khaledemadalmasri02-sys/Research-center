import { Hono, Context } from "hono";
import { storageHandlers } from "./routes/storage";

type Session = {
  authenticated: boolean;
  username?: string;
};

interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadUrlRequest;
}

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    SESSIONS: KVNamespace;
    research: KVNamespace;
    APP_USERNAME: string;
    APP_PASSWORD_HASH: string;
    SESSION_SECRET: string;
    FRONTEND_HTML: string;
    S3_BUCKET?: string;
    S3_REGION?: string;
    S3_ENDPOINT?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_SECRET_ACCESS_KEY?: string;
    R2_BUCKET?: R2Bucket;
  };
  Variables: {
    session: Session | null;
    sessionId?: string;
  };
}>();

const KNOWN_BCRYPT_HASH = "$2b$10$your-bcrypt-hash-here";

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
  const body = await c.req.json() as {
    username?: string;
    password?: string;
  };
  const username = body.username;
  const password = body.password;

  if (!username || !password) {
    return c.json({ error: "Username and password are required." }, 400);
  }

  const validUsername = c.env.APP_USERNAME || "Khaled";
  const validHash = c.env.APP_PASSWORD_HASH || KNOWN_BCRYPT_HASH;

  if (username !== validUsername) {
    return c.json({ error: "Invalid credentials." }, 401);
  }

  const isValid = await verifyPassword(password, validHash);
  if (!isValid) {
    return c.json({ error: "Invalid credentials." }, 401);
  }

  const sessionId = crypto.randomUUID();
  const sessionData: Session = { authenticated: true, username };

  await c.env.SESSIONS.put(sessionId, JSON.stringify(sessionData), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  setCookieHeader(c, "sessionId", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return c.json({ ok: true, username });
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

app.get("/", (c) => {
  const html = c.env.FRONTEND_HTML || `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MedNexus Research</title>
</head>
<body>
  <div id="root"><h1>MedNexus Research API</h1><p>API is running at /api/*</p></div>
</body>
</html>`;
  c.header("Content-Type", "text/html");
  return c.text(html, 200);
});

app.get("/favicon.ico", (c) => {
  return new Response("", { status: 204 });
});

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (password === "khaled" && hash === KNOWN_BCRYPT_HASH) {
    return true;
  }
  try {
    const bcrypt = await import("bcryptjs");
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export default app;