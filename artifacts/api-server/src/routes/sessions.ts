import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "./auth";

const router: IRouter = Router();

router.get("/sessions", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId ?? 0;
  const { rows } = await pool.query<{ sid: string; username: string | null; expire: Date }>(
    `SELECT "sid", "sess"->>'username' AS "username", "expire"
     FROM "session" WHERE "sess"->>'userId' = $1 ORDER BY "expire" DESC`,
    [String(userId)],
  );

  const currentSid = (req as Request & { sessionID: string }).sessionID;
  const sessions = rows.map((r) => ({
    sid: r.sid,
    username: r.username,
    current: r.sid === currentSid,
    expiresAt: r.expire,
  }));

  res.json({ sessions });
});

router.delete("/sessions/:sid", requireAuth, async (req: Request, res: Response) => {
  const sid = req.params.sid;
  const currentSid = (req as Request & { sessionID: string }).sessionID;
  if (sid === currentSid) {
    res.status(400).json({ error: "Cannot revoke the current session." });
    return;
  }
  await pool.query(`DELETE FROM "session" WHERE "sid" = $1 AND "sess"->>'userId' = $2`, [
    sid,
    String(req.session.userId ?? 0),
  ]);
  res.json({ ok: true });
});

router.delete("/sessions", requireAuth, async (req: Request, res: Response) => {
  const currentSid = (req as Request & { sessionID: string }).sessionID;
  await pool.query(`DELETE FROM "session" WHERE "sess"->>'userId' = $1 AND "sid" <> $2`, [
    String(req.session.userId ?? 0),
    currentSid,
  ]);
  res.json({ ok: true });
});

export default router;
