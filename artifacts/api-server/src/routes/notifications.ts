import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth } from "./auth";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

const NotificationIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

router.get("/notifications", requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.session.userId ?? 0))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.session.userId ?? 0));

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.session.userId ?? 0), eq(notificationsTable.read, false)));

  res.json({ notifications: rows, total: Number(count), unread: Number(unread) });
});

router.post(
  "/notifications/:id/read",
  requireAuth,
  validate({ params: NotificationIdParams }),
  async (req: Request, res: Response) => {
    const { id } = req.validated!.params as z.infer<typeof NotificationIdParams>;
    const [updated] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.session.userId ?? 0)))
      .returning({ id: notificationsTable.id });

    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  },
);

router.post("/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.userId, req.session.userId ?? 0));
  res.json({ ok: true });
});

export default router;
