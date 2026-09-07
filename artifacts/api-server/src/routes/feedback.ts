import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, feedbackTable, usersTable } from "@workspace/db";
import { writeAudit, clientIp } from "../lib/audit";
import { notify } from "../lib/notifications";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

const MAX_MESSAGE = 5000;

const SubmitFeedbackBody = z.object({
  type: z.enum(["general", "bug", "feature", "complaint", "praise"]).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

const ReviewFeedbackParams = z.object({
  id: z.coerce.number().int().positive(),
});

// Submit feedback (any authenticated user)
router.post(
  "/feedback",
  validate({ body: SubmitFeedbackBody }),
  async (req: Request, res: Response) => {
    const { type, message, rating } = req.validated!.body as z.infer<typeof SubmitFeedbackBody>;
    // The schema already whitelists the type, so no fallback needed; default
    // to "general" when the client omits it.
    const safeType = type ?? "general";
    const safeRating = rating ?? null;

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
router.patch(
  "/feedback/:id/review",
  validate({ params: ReviewFeedbackParams }),
  async (req: Request, res: Response) => {
    if (!req.session.canAdminAccess) {
      res.status(403).json({ error: "Admin access required." });
      return;
    }

    const { id } = req.validated!.params as z.infer<typeof ReviewFeedbackParams>;

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
  },
);

export default router;
