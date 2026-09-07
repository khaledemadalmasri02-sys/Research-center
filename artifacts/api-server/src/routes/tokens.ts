import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, apiTokensTable, API_TOKEN_SCOPES } from "@workspace/db";
import { requireAuth } from "./auth";
import { issueToken } from "../lib/apiToken";
import { writeAudit, clientIp } from "../lib/audit";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

const IssueTokenBody = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.string())
    .min(1)
    .max(API_TOKEN_SCOPES.length)
    .refine(
      (arr) => arr.every((s) => (API_TOKEN_SCOPES as readonly string[]).includes(s)),
      { message: "One or more scopes are not in the allowed list" },
    ),
});

const TokenIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

router.post(
  "/tokens",
  requireAuth,
  validate({ body: IssueTokenBody }),
  async (req: Request, res: Response) => {
    const { name, scopes } = req.validated!.body as z.infer<typeof IssueTokenBody>;
    const issued = await issueToken(req.session.userId ?? 0, name, scopes);
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
  },
);

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

router.delete(
  "/tokens/:id",
  requireAuth,
  validate({ params: TokenIdParams }),
  async (req: Request, res: Response) => {
    const { id } = req.validated!.params as z.infer<typeof TokenIdParams>;
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
  },
);

export default router;
