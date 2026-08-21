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

    const canAdmin = (tok.scopes as string[]).includes("admin");
    const canEdit = canAdmin || (tok.scopes as string[]).some((s) => s.endsWith(":write") || s === "write");
    (req as Request & { session: any }).session = {
      authenticated: true,
      userId: user.id,
      username: user.username,
      role: canAdmin ? "admin" : canEdit ? "editor" : "viewer",
      canAdminAccess: canAdmin,
    };
  } catch {
    // On any token error, fall through to cookie auth.
  }
  next();
}
