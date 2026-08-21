import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, usersTable, recordsTable, feedbackTable, signupRequestsTable, notificationsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/metrics", requireAdmin, async (_req: Request, res: Response) => {
  const [{ users }] = await db.select({ users: sql<number>`count(*)` }).from(usersTable);
  const [{ records }] = await db.select({ records: sql<number>`count(*)` }).from(recordsTable);
  const [{ feedback }] = await db.select({ feedback: sql<number>`count(*)` }).from(feedbackTable);
  const [{ signups }] = await db.select({ signups: sql<number>`count(*)` }).from(signupRequestsTable);
  const [{ notifications }] = await db.select({ notifications: sql<number>`count(*)` }).from(notificationsTable);
  const [{ sessions }] = await db.select({ sessions: sql<number>`count(*)` }).from(sql`"session"`);

  res.json({
    uptime: process.uptime(),
    counts: {
      users: Number(users),
      records: Number(records),
      feedback: Number(feedback),
      signups: Number(signups),
      notifications: Number(notifications),
      sessions: Number(sessions),
    },
  });
});

export default router;
