import type { Next } from "hono";
import bcrypt from "bcryptjs";
import type { AppContext } from "./env";

export const KNOWN_BCRYPT_HASH = "REDACTED_BCRYPT_HASH";

export function validUsername(value?: string): boolean {
  return !!value && value.length >= 3 && value.length <= 64 && /^[a-zA-Z0-9_.-]+$/.test(value);
}

export function strongPassword(value?: string): string | null {
  if (!value || value.length < 8) return "Password must be at least 8 characters.";
  if (!/[0-9]/.test(value) || !/[a-zA-Z]/.test(value))
    return "Password must contain both letters and numbers.";
  return null;
}

export interface AuthUser {
  id: number;
  username: string;
  fullName?: string | null;
  email?: string | null;
  role: string; // 'viewer' | 'editor' | 'admin'
  canAdminAccess: boolean;
  status: string;
}

export interface AuthResult {
  user: AuthUser;
  scopes?: string[];
}

// ---------------------------------------------------------------------------
// Cookie helpers (moved here so both index.ts and the route handlers can use
// them without duplication). The session cookie is httpOnly + Secure + Lax.
// ---------------------------------------------------------------------------
export function getCookieVal(c: AppContext, key: string): string | undefined {
  const cookie = c.req.header("Cookie");
  if (!cookie) return undefined;
  const cookies: Record<string, string> = {};
  cookie.split(";").forEach((pair) => {
    const [k, v] = pair.trim().split("=");
    if (k && v) cookies[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return cookies[key];
}

export function setCookieHeader(
  c: AppContext,
  name: string,
  value: string,
  opts: { httpOnly?: boolean; secure?: boolean; sameSite?: "none" | "lax" | "strict"; path?: string; maxAge?: number }
) {
  let header = `${name}=${value}`;
  if (opts.path) header += `; Path=${opts.path}`;
  if (opts.maxAge !== undefined) header += `; Max-Age=${opts.maxAge}`;
  if (opts.httpOnly) header += "; HttpOnly";
  if (opts.secure) header += "; Secure";
  if (opts.sameSite) header += `; SameSite=${opts.sameSite}`;
  c.header("Set-Cookie", header, { append: true });
}

export function deleteCookieHeader(c: AppContext, name: string) {
  setCookieHeader(c, name, "", { maxAge: 0, path: "/" });
}

// ---------------------------------------------------------------------------
// Password + token primitives
// ---------------------------------------------------------------------------
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(10));
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getClientIp(c: AppContext): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// Sessions (stored in KV)
// ---------------------------------------------------------------------------
export interface SessionData {
  authenticated: boolean;
  userId: number;
  username: string;
  role: string;
  canAdminAccess: boolean;
  createdAt?: string;
}

const SESSION_KEY_PREFIX = "sess:";

export async function createSession(c: AppContext, user: AuthUser): Promise<void> {
  const sessionId = crypto.randomUUID();
  const data: SessionData = {
    authenticated: true,
    userId: user.id,
    username: user.username,
    role: user.role,
    canAdminAccess: user.canAdminAccess,
    createdAt: new Date().toISOString(),
  };
  await c.env.SESSIONS.put(SESSION_KEY_PREFIX + sessionId, JSON.stringify(data), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  setCookieHeader(c, "sessionId", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function destroySession(c: AppContext): Promise<void> {
  const sessionId = getCookieVal(c, "sessionId");
  if (sessionId) await c.env.SESSIONS.delete(SESSION_KEY_PREFIX + sessionId);
  deleteCookieHeader(c, "sessionId");
}

export async function destroySessionById(c: AppContext, sessionId: string): Promise<void> {
  await c.env.SESSIONS.delete(SESSION_KEY_PREFIX + sessionId);
}

// ---------------------------------------------------------------------------
// Auth resolution: Bearer token first, then cookie session.
// ---------------------------------------------------------------------------
export async function getAuthUser(c: AppContext): Promise<AuthResult | null> {
  const auth = c.req.header("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const tokenHash = await sha256Hex(token);
      const row = await c.env.DB.prepare(
        "SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL"
      )
        .bind(tokenHash)
        .first<any>();
      if (row) {
        await c.env.DB.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?")
          .bind(row.id)
          .run();
        const user = await loadUser(c, row.user_id);
        if (user) {
          return { user, scopes: parseJsonArray(row.scopes) };
        }
      }
    }
    return null;
  }

  const sessionId = getCookieVal(c, "sessionId");
  if (sessionId) {
    const session = await c.env.SESSIONS.get<SessionData>(SESSION_KEY_PREFIX + sessionId, "json");
    if (session?.authenticated) {
      const user = await loadUser(c, session.userId);
      if (user) return { user };
    }
  }
  return null;
}

async function loadUser(c: AppContext, id: number): Promise<AuthUser | null> {
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
  if (!row) return null;
  return rowToAuthUser(row);
}

export function rowToAuthUser(row: any): AuthUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    role: row.role || "viewer",
    canAdminAccess: !!row.can_admin_access,
    status: row.status || "active",
  };
}

export function parseJsonArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: any): Record<string, any> {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// RBAC helpers
// ---------------------------------------------------------------------------
export function isAdmin(user: AuthUser | null): boolean {
  return !!user?.canAdminAccess;
}

export function canEdit(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.canAdminAccess || user.role === "editor" || user.role === "admin";
}

export function hasScope(scopes: string[] | undefined, required: string): boolean {
  if (!scopes || scopes.length === 0) return true; // cookie sessions are full
  if (scopes.includes("admin")) return true;
  return scopes.includes(required);
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------
export async function writeAudit(
  c: AppContext,
  params: {
    userId?: number | null;
    action: string;
    entity?: string;
    entityId?: number | null;
    detail?: unknown;
    ip?: string;
  }
): Promise<void> {
  try {
    const userId = params.userId ?? c.get("authUser")?.user.id ?? null;
    await c.env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        userId,
        params.action,
        params.entity ?? null,
        params.entityId ?? null,
        params.detail === undefined ? null : JSON.stringify(params.detail),
        params.ip ?? getClientIp(c)
      )
      .run();
  } catch {
    // Never let audit failures break a request.
  }
}

// ---------------------------------------------------------------------------
// Hono middlewares
// ---------------------------------------------------------------------------
export async function requireAuth(c: AppContext, next: Next): Promise<Response | void> {
  const auth = await getAuthUser(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("authUser", auth);
  await next();
}

export async function requireAdmin(c: AppContext, next: Next): Promise<Response | void> {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  c.set("authUser", auth);
  await next();
}

// ---------------------------------------------------------------------------
// Login rate limiting + account lockout (KV backed, per IP + per account)
// ---------------------------------------------------------------------------
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function getIpFailures(c: AppContext, ip: string): Promise<number> {
  try {
    const raw = await c.env.SESSIONS.get(`ratelimit:login:${ip}`);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function bumpIpFailure(c: AppContext, ip: string): Promise<void> {
  try {
    const n = (await getIpFailures(c, ip)) + 1;
    await c.env.SESSIONS.put(`ratelimit:login:${ip}`, String(n), { expirationTtl: 60 * 10 });
  } catch {
    /* ignore */
  }
}

export async function resetIpFailures(c: AppContext, ip: string): Promise<void> {
  try {
    await c.env.SESSIONS.delete(`ratelimit:login:${ip}`);
  } catch {
    /* ignore */
  }
}

export function isAccountLocked(row: any): boolean {
  if (!row?.locked_until) return false;
  const t = new Date(row.locked_until).getTime();
  return !isNaN(t) && t > Date.now();
}

export async function recordAccountFailure(c: AppContext, userId: number): Promise<void> {
  await c.env.DB.prepare(
    `UPDATE users SET failed_attempts = failed_attempts + 1,
       locked_until = CASE WHEN failed_attempts + 1 >= ? THEN datetime('now', '+${LOCK_MINUTES} minutes') ELSE locked_until END
     WHERE id = ?`
  )
    .bind(MAX_FAILED, userId)
    .run();
}

export async function resetAccountFailures(c: AppContext, userId: number): Promise<void> {
  await c.env.DB.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?"
  )
    .bind(userId)
    .run();
}
