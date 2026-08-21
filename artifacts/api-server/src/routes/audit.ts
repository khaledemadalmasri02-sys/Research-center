import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { requireAuth } from "./auth";

const router: IRouter = Router();

const PAGE = 50;

// Personal activity timeline (any authenticated user).
router.get("/audit/me", requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || PAGE, 200);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.userId, req.session.userId ?? 0))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.userId, req.session.userId ?? 0));

  res.json({ events: rows, total: Number(count) });
});

// Global activity timeline (admin only).
router.get("/audit", requireAuth, async (req: Request, res: Response) => {
  if (!req.session.canAdminAccess) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || PAGE, 200);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const conditions = [];
  if (req.query.action) conditions.push(eq(auditLogsTable.action, String(req.query.action)));
  if (req.query.userId) conditions.push(eq(auditLogsTable.userId, Number(req.query.userId)));

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(auditLogsTable).where(where);

  res.json({ events: rows, total: Number(count) });
});

export default router;
