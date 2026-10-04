import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, apiTokensTable, API_TOKEN_SCOPES } from "@workspace/db";
import { requireAuth } from "./auth";
import { issueToken } from "../lib/apiToken";
import { writeAudit, clientIp } from "../lib/audit";
import { rateLimit } from "../lib/security";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

// Per-session + per-IP budget on token issuance. A token is a bearer
// credential that can read/write PHI; an approved (non-admin) user must not
// be able to mint unlimited long-lived credentials.
const TOKEN_ISSUE_LIMIT = 10; // per IP per 15 min
const TOKEN_ISSUE_WINDOW_MS = 15 * 60 * 1000;
const TOKEN_ISSUE_USER_LIMIT = 5; // per user per 15 min

// "admin" is in API_TOKEN_SCOPES because it is part of the *stored*
// vocabulary (tokens issued before the self-service escalation fix may
// still hold it), but it is not self-service requestable: only a caller who
// is already an admin may ask for it.
const ADMIN_SCOPE = "admin";
const REQUESTABLE_TOKEN_SCOPES = API_TOKEN_SCOPES.filter((scope) => scope !== ADMIN_SCOPE);

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
    const ipLimit = rateLimit(
      `token-issue:${clientIp(req)}`,
      TOKEN_ISSUE_LIMIT,
      TOKEN_ISSUE_WINDOW_MS,
    );
    if (!ipLimit.success) {
      res
        .status(429)
        .json({ error: `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.` });
      return;
    }

    const userId = req.session.userId ?? 0;
    const userLimit = rateLimit(
      `token-issue:user:${userId}`,
      TOKEN_ISSUE_USER_LIMIT,
      TOKEN_ISSUE_WINDOW_MS,
    );
    if (!userLimit.success) {
      res
        .status(429)
        .json({ error: `Too many tokens issued. Try again in ${userLimit.retryAfterSec}s.` });
      return;
    }

    const { name, scopes } = req.validated!.body as z.infer<typeof IssueTokenBody>;

    // Privilege-escalation guard: a self-service signup + admin approval
    // grants role "editor". Only an existing admin may mint an admin-scoped
    // token; anyone else is rejected *before* any row is written.
    const requesterIsAdmin = req.session?.canAdminAccess === true;
    const requestedAdmin = scopes.includes(ADMIN_SCOPE);
    if (requestedAdmin && !requesterIsAdmin) {
      await writeAudit({
        userId: req.session.userId ?? null,
        action: "api_token.create.denied",
        detail: { name, requestedScopes: scopes, reason: "non-admin requested admin scope" },
        ip: clientIp(req),
      });
      res.status(403).json({
        error: "Only administrators may create a token with the admin scope.",
      });
      return;
    }

    const issued = await issueToken(userId, name, scopes);
    await writeAudit({
      userId: req.session.userId ?? null,
      action: "api_token.create",
      entity: "api_token",
      entityId: issued.id,
      // The requested (and stored) scopes are audited so a leaked admin
      // token is attributable from the audit trail alone.
      detail: { name, scopes },
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

/** Scopes a non-admin caller may request (exported for the OpenAPI doc + tests). */
export const requestableTokenScopes: readonly string[] = REQUESTABLE_TOKEN_SCOPES;

export default router;