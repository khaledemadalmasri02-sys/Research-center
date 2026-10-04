import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, apiTokensTable, usersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { plaintext: string; hash: string } {
  const secret = crypto.randomBytes(24).toString("hex");
  const plaintext = `mr_${secret}`;
  return { plaintext, hash: hashToken(plaintext) };
}

export async function issueToken(
  userId: number,
  name: string,
  scopes: string[],
): Promise<{ id: number; name: string; scopes: string[]; plaintext: string; createdAt: Date }> {
  const { plaintext, hash } = generateToken();
  const [row] = await db
    .insert(apiTokensTable)
    .values({ userId, name, tokenHash: hash, scopes })
    .returning({ id: apiTokensTable.id, name: apiTokensTable.name, scopes: apiTokensTable.scopes, createdAt: apiTokensTable.createdAt });
  return { ...row, plaintext };
}

// Resolves a Bearer token into a synthetic session so every downstream
// route (which reads req.session.*) works unchanged for API clients.
//
// Defence in depth (A1): the token's scopes can only ever *narrow* the
// owner's own privileges. See the `canAdmin` computation below.

/**
 * Build the session object that stands in for a browser session.
 *
 * This used to be a bare object literal (`{ authenticated, userId, ... }`),
 * which broke express-session: when the response ends, express-session calls
 * `req.session.touch()` unconditionally, so every single Bearer-token request
 * threw `req.session.touch is not a function` and never completed.
 *
 * So the synthetic session:
 *   - inherits from the real session object (prototype chain), which keeps
 *     `touch`/`save`/`regenerate`/`id`/`cookie` resolvable, and
 *   - overrides the persistence methods with no-ops, because a Bearer token
 *     is stateless: there is nothing to store server-side and no cookie to
 *     refresh. Overriding them also avoids a `session` table write per API
 *     request.
 */
function createTokenSession(
  base: Request["session"],
  fields: Record<string, unknown>,
): Request["session"] {
  const session = Object.create(base) as Record<string, unknown>;
  Object.assign(session, fields);
  session.touch = () => session;
  session.save = (cb?: (err?: unknown) => void) => cb?.();
  session.regenerate = (cb?: (err?: unknown) => void) => cb?.();
  session.destroy = (cb?: (err?: unknown) => void) => cb?.();
  return session as unknown as Request["session"];
}
export async function authenticateApiToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    next();
    return;
  }

  try {
    const [tok] = await db
      .select()
      .from(apiTokensTable)
      .where(and(eq(apiTokensTable.tokenHash, hashToken(token)), isNull(apiTokensTable.revokedAt)))
      .limit(1);
    if (!tok) {
      next();
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, tok.userId)).limit(1);
    if (!user || user.status !== "active") {
      next();
      return;
    }

    await db
      .update(apiTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokensTable.id, tok.id));

    // A token must never out-privilege its owner. The `admin` scope alone is
    // NOT sufficient: it requires the owner's own `can_admin_access` too.
    // Otherwise any user who could mint an admin-scoped token (which
    // routes/tokens.ts now blocks for non-admins) would hold admin rights
    // through the API even after being demoted.
    const hasAdminScope = (tok.scopes as string[]).includes("admin");
    const canAdmin = hasAdminScope && user.canAdminAccess === true;
    const canEdit = canAdmin || (tok.scopes as string[]).some((s) => s.endsWith(":write") || s === "write");
    req.session = createTokenSession(req.session, {
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: canAdmin ? "admin" : canEdit ? "editor" : "viewer",
      canAdminAccess: canAdmin,
    });
  } catch {
    // On any token error, fall through to cookie auth.
  }
  next();
}
