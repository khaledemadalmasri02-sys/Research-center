import type { AppContext } from "../lib/env";
import { getAuthUser, isAdmin, writeAudit } from "../lib/security";

const ALLOWED_TYPES = new Set(["general", "bug", "feature", "complaint", "praise"]);
const MAX_MESSAGE = 5000;

export const feedbackHandlers = {
  // POST /api/feedback — any authenticated user submits feedback
  CREATE: async (c: AppContext) => {
    const auth = await getAuthUser(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const { type, message, rating } = body as { type?: string; message?: string; rating?: number };

    if (typeof message !== "string" || !message.trim()) {
      return c.json({ error: "Message is required." }, 400);
    }
    if (message.length > MAX_MESSAGE) {
      return c.json({ error: `Message must be at most ${MAX_MESSAGE} characters.` }, 400);
    }
    const safeType = ALLOWED_TYPES.has(type ?? "") ? (type as string) : "general";

    let safeRating: number | null = null;
    if (rating !== undefined && rating !== null) {
      const n = Number(rating);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return c.json({ error: "Rating must be an integer between 1 and 5." }, 400);
      }
      safeRating = n;
    }

    const db = c.env.DB;
    const result = (await db
      .prepare(
        `INSERT INTO feedback (user_id, type, message, rating, status, created_at)
         VALUES (?, ?, ?, ?, 'new', CURRENT_TIMESTAMP)`
      )
      .bind(auth.user.id, safeType, message.trim(), safeRating)
      .run()) as any;

    await writeAudit(c, { userId: auth.user.id, action: "feedback.submit", entity: "feedback", entityId: result?.meta?.last_row_id });

    return c.json({ ok: true, id: result?.meta?.last_row_id ?? null }, 201);
  },

  // GET /api/feedback — admin only
  LIST: async (c: AppContext) => {
    const auth = await getAuthUser(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(auth.user)) return c.json({ error: "Admin access required." }, 403);

    const db = c.env.DB;
    const res = (await db
      .prepare(
        `SELECT f.id, f.user_id as userId, f.type, f.message, f.rating, f.status,
                f.created_at as createdAt, u.username as username
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         ORDER BY f.created_at DESC`
      )
      .all()) as any;

    return c.json({ feedback: res.results || [] });
  },

  // PATCH /api/feedback/:id/review — admin only; notifies the author
  REVIEW: async (c: AppContext) => {
    const auth = await getAuthUser(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(auth.user)) return c.json({ error: "Admin access required." }, 403);

    const idStr = c.req.param("id");
    if (!idStr) return c.json({ error: "Feedback ID required" }, 400);
    const id = parseInt(idStr ?? "", 10);
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

    const db = c.env.DB;
    const existing = (await db.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first()) as any;
    if (!existing) return c.json({ error: "Feedback not found." }, 404);

    await db.prepare("UPDATE feedback SET status = 'reviewed' WHERE id = ?").bind(id).run();
    await writeAudit(c, { userId: auth.user.id, action: "feedback.review", entity: "feedback", entityId: id });

    if (existing.user_id) {
      try {
        await db.prepare(
          "INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'feedback.reviewed', 'Feedback reviewed', ?, '/feedback')"
        )
          .bind(existing.user_id, existing.message?.slice(0, 120) || "Your feedback was reviewed.")
          .run();
      } catch {
        /* ignore */
      }
    }

    return c.json({ ok: true, feedback: { id, status: "reviewed" } });
  },
};
