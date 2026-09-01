import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, usersTable, signupRequestsTable, recordDefinitionsTable, recordsTable } from "@workspace/db";
import { hashPassword, isValidPassword } from "../lib/security";
import { requireAdmin } from "../middlewares/requireAdmin";
import { writeAudit, clientIp } from "../lib/audit";
import { notify } from "../lib/notifications";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

const ALLOWED_ROLES = new Set(["admin", "editor", "viewer"]);
const ALLOWED_STATUSES = new Set(["active", "pending", "suspended"]);

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

// List sign-up requests awaiting admin approval (admin only). Only requests whose
// email has been verified via OTP ("pending") are shown; unverified ("unverified")
// rows are not yet real approval requests.
router.get("/signups", requireAdmin, async (_req: Request, res: Response) => {
  const requests = await db
    .select()
    .from(signupRequestsTable)
    .where(eq(signupRequestsTable.status, "pending"))
    .orderBy(desc(signupRequestsTable.createdAt));
  res.json({ requests });
});

// Approve a sign-up request -> creates a website-only user account
router.post("/signups/:id/approve", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [request] = await db.select().from(signupRequestsTable).where(eq(signupRequestsTable.id, id)).limit(1);
  if (!request) {
    res.status(404).json({ error: "Sign-up request not found." });
    return;
  }
  if (request.status !== "pending") {
    res.status(409).json({ error: `Request already ${request.status}.` });
    return;
  }

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, request.username)).limit(1);
  if (existingUser) {
    res.status(409).json({ error: "A user with this username already exists." });
    return;
  }

  let created: {
    id: number;
    username: string;
    role: string;
    canAdminAccess: boolean;
    status: string;
  };
  try {
    [created] = await db
      .insert(usersTable)
      .values({
        username: request.username,
        passwordHash: request.passwordHash,
        fullName: request.fullName,
        email: request.email,
        role: "editor",
        canAdminAccess: false,
        status: "active",
        createdBy: req.session.userId ?? null,
      })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        role: usersTable.role,
        canAdminAccess: usersTable.canAdminAccess,
        status: usersTable.status,
      });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: "A user with this username already exists." });
      return;
    }
    throw e;
  }

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "admin.signup.approve",
    entity: "signup_request",
    entityId: request.id,
    detail: { username: request.username },
    ip: clientIp(req),
  });

  await db
    .update(signupRequestsTable)
    .set({ status: "approved", reviewedBy: req.session.userId ?? null, reviewedAt: new Date() })
    .where(eq(signupRequestsTable.id, id));

  await notify(
    created.id,
    {
      type: "signup.approved",
      title: "Your account was approved",
      body: `Welcome ${request.username}! You can now sign in and start using MedResearch.`,
      link: "/",
    },
    request.email,
  );

  res.json({ ok: true, user: created });
});

// Reject a sign-up request
router.post("/signups/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [request] = await db.select().from(signupRequestsTable).where(eq(signupRequestsTable.id, id)).limit(1);
  if (!request) {
    res.status(404).json({ error: "Sign-up request not found." });
    return;
  }
  if (request.status !== "pending") {
    res.status(409).json({ error: `Request already ${request.status}.` });
    return;
  }

  await db
    .update(signupRequestsTable)
    .set({ status: "rejected", reviewedBy: req.session.userId ?? null, reviewedAt: new Date() })
    .where(eq(signupRequestsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "admin.signup.reject",
    entity: "signup_request",
    entityId: id,
    ip: clientIp(req),
  });

  if (request.email) {
    await sendEmail({
      to: request.email,
      subject: "Your MedResearch sign-up request",
      text: `Hi ${request.username}, your sign-up request was reviewed and unfortunately was not approved at this time.`,
    }).catch(() => {});
  }

  res.json({ ok: true });
});

// List users (admin only)
router.get("/users", requireAdmin, async (_req: Request, res: Response) => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      email: usersTable.email,
      role: usersTable.role,
      canAdminAccess: usersTable.canAdminAccess,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));
  res.json({ users });
});

// Admin directly creates a user (e.g. another admin)
router.post("/users", requireAdmin, async (req: Request, res: Response) => {
  const { username, password, fullName, email, role, canAdminAccess } = req.body as {
    username?: string;
    password?: string;
    fullName?: string;
    email?: string;
    role?: string;
    canAdminAccess?: boolean;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const pwCheck = isValidPassword(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.reason });
    return;
  }
  const safeRole = ALLOWED_ROLES.has(role ?? "") ? (role as string) : "editor";
  const safeCanAdmin = safeRole === "admin" ? Boolean(canAdminAccess) : false;

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Username already taken." });
    return;
  }

  const passwordHash = await hashPassword(password);
  let created: {
    id: number;
    username: string;
    role: string;
    canAdminAccess: boolean;
    status: string;
  };
  try {
    [created] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash,
        fullName: fullName ?? null,
        email: email ?? null,
        role: safeRole,
        canAdminAccess: safeCanAdmin,
        status: "active",
        createdBy: req.session.userId ?? null,
      })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        role: usersTable.role,
        canAdminAccess: usersTable.canAdminAccess,
        status: usersTable.status,
      });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: "Username already taken." });
      return;
    }
    throw e;
  }

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "admin.user.create",
    entity: "user",
    entityId: created.id,
    detail: { username, role: safeRole, canAdminAccess: safeCanAdmin },
    ip: clientIp(req),
  });

  res.status(201).json({ ok: true, user: created });
});

// Update a user (role, admin access, status)
router.patch("/users/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { role, canAdminAccess, status } = req.body as {
    role?: string;
    canAdminAccess?: boolean;
    status?: string;
  };

  if (role !== undefined && !ALLOWED_ROLES.has(role)) {
    res.status(400).json({ error: "Invalid role." });
    return;
  }
  if (status !== undefined && !ALLOWED_STATUSES.has(status)) {
    res.status(400).json({ error: "Invalid status." });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  // Prevent self-lockout / privilege loss for the acting admin.
  if (target.id === req.session.userId) {
    if (status && status !== "active") {
      res.status(400).json({ error: "You cannot suspend or disable your own account." });
      return;
    }
    if (role && role !== "admin") {
      res.status(400).json({ error: "You cannot remove your own admin role." });
      return;
    }
    if (canAdminAccess === false) {
      res.status(400).json({ error: "You cannot revoke your own admin access." });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (role !== undefined) updateData.role = role;
  if (canAdminAccess !== undefined) updateData.canAdminAccess = role === "admin" ? canAdminAccess : false;
  if (status !== undefined) updateData.status = status;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
      canAdminAccess: usersTable.canAdminAccess,
      status: usersTable.status,
    });

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "admin.user.update",
    entity: "user",
    entityId: id,
    detail: { changes: updateData },
    ip: clientIp(req),
  });

  res.json({ ok: true, user: updated });
});

// Delete a user (cannot delete self or the last admin)
router.delete("/users/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (id === req.session.userId) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  if (target.role === "admin" && target.canAdminAccess) {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.canAdminAccess, true));
    if (admins.length <= 1) {
      res.status(400).json({ error: "Cannot delete the last administrator." });
      return;
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  await writeAudit({
    userId: req.session.userId ?? null,
    action: "admin.user.delete",
    entity: "user",
    entityId: id,
    ip: clientIp(req),
  });
  res.json({ ok: true });
});

// User data drill-down (admin only): the user's profile, the collections they
// own/created, and a sample of their records.
router.get("/users/:id/data", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const definitions = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.userId, id))
    .orderBy(desc(recordDefinitionsTable.createdAt));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordsTable)
    .where(eq(recordsTable.userId, id));

  const records = await db
    .select()
    .from(recordsTable)
    .where(eq(recordsTable.userId, id))
    .orderBy(desc(recordsTable.createdAt))
    .limit(50);

  res.json({ user, definitions, records, recordCount: count });
});

export default router;
