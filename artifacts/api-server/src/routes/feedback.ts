import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, feedbackTable, usersTable } from "@workspace/db";
import { writeAudit, clientIp } from "../lib/audit";
import { notify } from "../lib/notifications";

const router: IRouter = Router();

const ALLOWED_TYPES = new Set(["general", "bug", "feature", "complaint", "praise"]);
const MAX_MESSAGE = 5000;

// Submit feedback (any authenticated user)
router.post("/feedback", async (req: Request, res: Response) => {
  const { type, message, rating } = req.body as {
    type?: string;
    message?: string;
    rating?: number;
  };

  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message is required." });
    return;
  }
  if (message.length > MAX_MESSAGE) {
    res.status(400).json({ error: `Message must be at most ${MAX_MESSAGE} characters.` });
    return;
  }
  const safeType = ALLOWED_TYPES.has(type ?? "") ? (type as string) : "general";

  let safeRating: number | null = null;
  if (rating !== undefined && rating !== null) {
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      res.status(400).json({ error: "Rating must be an integer between 1 and 5." });
      return;
    }
    safeRating = n;
  }

  const [created] = await db
    .insert(feedbackTable)
    .values({
      userId: req.session.userId ?? 0,
      type: safeType,
      message: message.trim(),
      rating: safeRating,
    })
    .returning({ id: feedbackTable.id });

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "feedback.submit",
    entity: "feedback",
    entityId: created.id,
    detail: { type: safeType, rating: safeRating },
    ip: clientIp(req),
  });

  res.status(201).json({ ok: true, id: created.id });
});

// List feedback (admin only)
router.get("/feedback", async (req: Request, res: Response) => {
  if (!req.session.canAdminAccess) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const feedback = await db
    .select({
      id: feedbackTable.id,
      userId: feedbackTable.userId,
      username: usersTable.username,
      type: feedbackTable.type,
      message: feedbackTable.message,
      rating: feedbackTable.rating,
      status: feedbackTable.status,
      createdAt: feedbackTable.createdAt,
    })
    .from(feedbackTable)
    .leftJoin(usersTable, eq(feedbackTable.userId, usersTable.id))
    .orderBy(desc(feedbackTable.createdAt));

  res.json({ feedback });
});

// Mark feedback as reviewed (admin only)
router.patch("/feedback/:id/review", async (req: Request, res: Response) => {
  if (!req.session.canAdminAccess) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db.select().from(feedbackTable).where(eq(feedbackTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Feedback not found." });
    return;
  }

  const [updated] = await db
    .update(feedbackTable)
    .set({ status: "reviewed" })
    .where(eq(feedbackTable.id, id))
    .returning({ id: feedbackTable.id, status: feedbackTable.status });

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "feedback.review",
    entity: "feedback",
    entityId: id,
    ip: clientIp(req),
  });

  if (existing.userId) {
    const [author] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, existing.userId))
      .limit(1);
    await notify(
      existing.userId,
      {
        type: "feedback.reviewed",
        title: "Your feedback was reviewed",
        body: "An admin has reviewed the feedback you submitted. Thank you!",
        link: "/feedback",
      },
      author?.email,
    );
  }

  res.json({ ok: true, feedback: updated });
});

export default router;
