import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and, isNull } from "drizzle-orm";
import { db, apiTokensTable, API_TOKEN_SCOPES } from "@workspace/db";
import { requireAuth } from "./auth";
import { issueToken } from "../lib/apiToken";
import { writeAudit, clientIp } from "../lib/audit";

const router: IRouter = Router();

router.post("/tokens", requireAuth, async (req: Request, res: Response) => {
  const { name, scopes } = req.body as { name?: string; scopes?: string[] };
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Token name is required." });
    return;
  }
  const safeScopes = Array.isArray(scopes)
    ? scopes.filter((s) => (API_TOKEN_SCOPES as readonly string[]).includes(s))
    : [];
  if (safeScopes.length === 0) {
    res.status(400).json({ error: "At least one valid scope is required." });
    return;
  }

  const issued = await issueToken(req.session.userId ?? 0, name, safeScopes);
  await writeAudit({
    userId: req.session.userId ?? null,
    action: "api_token.create",
    detail: { name },
    ip: clientIp(req),
  });

  // Plaintext secret is returned exactly once.
  res.status(201).json({
    id: issued.id,
    name: issued.name,
    scopes: issued.scopes,
    token: issued.plaintext,
    createdAt: issued.createdAt,
  });
});

router.get("/tokens", requireAuth, async (req: Request, res: Response) => {
  const tokens = await db
    .select({
      id: apiTokensTable.id,
      name: apiTokensTable.name,
      scopes: apiTokensTable.scopes,
      lastUsedAt: apiTokensTable.lastUsedAt,
      createdAt: apiTokensTable.createdAt,
      revokedAt: apiTokensTable.revokedAt,
    })
    .from(apiTokensTable)
    .where(eq(apiTokensTable.userId, req.session.userId ?? 0))
    .orderBy(desc(apiTokensTable.createdAt));

  res.json({ tokens });
});

router.delete("/tokens/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [tok] = await db
    .select({ id: apiTokensTable.id })
    .from(apiTokensTable)
    .where(and(eq(apiTokensTable.id, id), eq(apiTokensTable.userId, req.session.userId ?? 0)))
    .limit(1);
  if (!tok) {
    res.status(404).json({ error: "Token not found." });
    return;
  }

  await db
    .update(apiTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokensTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "api_token.revoke",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

export default router;
