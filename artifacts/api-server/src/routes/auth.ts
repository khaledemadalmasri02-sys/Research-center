import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, signupRequestsTable } from "@workspace/db";
import { hashPassword, verifyPassword, isValidPassword, rateLimit } from "../lib/security";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const LOGIN_RATE_LIMIT = 10; // per IP per 15 min
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

// Valid-format bcrypt hash used only to equalize timing when no user exists.
const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYh2dQHP8DjL0eW";

function clientIp(req: Request): string {
  return (req.ip as string) ?? "unknown";
}

function isLocked(user: { lockedUntil: Date | null } | undefined): boolean {
  if (!user?.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}

function publicUser(u: { id: number; username: string; role: string; canAdminAccess: boolean; status: string }) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    canAdminAccess: u.canAdminAccess,
    status: u.status,
  };
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const limit = rateLimit(`login:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);

  // Always run a hash comparison to reduce timing oracle, but reject when no user.
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH);

  if (!user || !valid) {
    if (user && !isLocked(user)) {
      const attempts = user.failedAttempts + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        await db.update(usersTable).set({ failedAttempts: attempts, lockedUntil }).where(eq(usersTable.id, user.id));
      } else {
        await db.update(usersTable).set({ failedAttempts: attempts }).where(eq(usersTable.id, user.id));
      }
    }
    res.status(401).json({ error: "Invalid credentials." });
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.failure", detail: { username }, ip: clientIp(req) });
    return;
  }

  if (isLocked(user)) {
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.locked", detail: { username }, ip: clientIp(req) });
    res.status(429).json({ error: "Account is temporarily locked. Try again later." });
    return;
  }

  if (user.status === "pending") {
    res.status(403).json({ error: "Your account is pending admin approval." });
    return;
  }
  if (user.status === "suspended") {
    res.status(403).json({ error: "This account has been suspended." });
    return;
  }

  // Successful login: reset lockout counters.
  await db.update(usersTable).set({ failedAttempts: 0, lockedUntil: null }).where(eq(usersTable.id, user.id));

  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role as "admin" | "user";
  req.session.canAdminAccess = user.canAdminAccess;

  await writeAudit({ userId: user.id, action: "auth.login.success", ip: clientIp(req) });

  res.json({ ok: true, username: user.username, role: user.role, canAdminAccess: user.canAdminAccess });
});

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

// Sign-up application: creates a PENDING request reviewed by an admin.
router.post("/auth/signup", async (req: Request, res: Response) => {
  const limit = rateLimit(`signup:${clientIp(req)}`, 10, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  const { username, password, fullName, email, reason } = req.body as {
    username?: string;
    password?: string;
    fullName?: string;
    email?: string;
    reason?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }
  const pwCheck = isValidPassword(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.reason });
    return;
  }

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existingUser) {
    res.status(409).json({ error: "An account or request with that username already exists." });
    return;
  }
  const [existingRequest] = await db
    .select({ id: signupRequestsTable.id, status: signupRequestsTable.status })
    .from(signupRequestsTable)
    .where(eq(signupRequestsTable.username, username))
    .limit(1);
  if (existingRequest) {
    res.status(409).json({ error: "An account or request with that username already exists." });
    return;
  }

  const passwordHash = await hashPassword(password);
  try {
    await db.insert(signupRequestsTable).values({
      username,
      passwordHash,
      fullName: fullName ?? null,
      email: email ?? null,
      reason: reason ?? null,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: "An account or request with that username already exists." });
      return;
    }
    throw e;
  }

  await writeAudit({ action: "auth.signup.request", detail: { username }, ip: clientIp(req) });

  res.status(201).json({ ok: true, status: "pending", message: "Sign-up request submitted. An admin will review it." });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const userId = req.session?.userId ?? null;
  const ip = clientIp(req);
  req.session.destroy(() => {
    void writeAudit({ userId, action: "auth.logout", ip });
    res.json({ ok: true });
  });
});

router.get("/auth/me", async (req: Request, res: Response) => {
  if (req.session.authenticated && req.session.username) {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId ?? 0))
      .limit(1);
    res.json({
      authenticated: true,
      id: req.session.userId ?? u?.id ?? null,
      username: req.session.username,
      fullName: u?.fullName ?? null,
      email: u?.email ?? null,
      role: req.session.role ?? "user",
      canAdminAccess: req.session.canAdminAccess ?? false,
      status: u?.status ?? "active",
    });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

export default router;
