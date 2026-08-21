import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and, or, sql } from "drizzle-orm";
import { db, recordsTable, recordDefinitionsTable } from "@workspace/db";
import { requireAuth } from "./auth";

const router: IRouter = Router();

interface Scope {
  isAdmin: boolean;
  userId: number;
  scopeAll: boolean;
}

function scopeOf(req: Request): Scope {
  const isAdmin = req.session.canAdminAccess === true;
  return {
    isAdmin,
    userId: req.session.userId ?? 0,
    scopeAll: isAdmin && req.query.scope === "all",
  };
}

async function canReadDefinition(req: Request, id: number): Promise<boolean> {
  const [def] = await db.select().from(recordDefinitionsTable).where(eq(recordDefinitionsTable.id, id)).limit(1);
  if (!def) return false;
  const s = scopeOf(req);
  if (def.shared) return true;
  if (def.userId === s.userId || s.isAdmin) return true;
  return false;
}

function buildFilters(filters: Record<string, unknown> | null) {
  if (!filters || typeof filters !== "object") return [];
  return Object.entries(filters).map(([key, value]) =>
    sql`"data"->>${key} = ${String(value)}`,
  );
}

function buildSort(sort: { key?: string; dir?: string } | null) {
  if (sort && sort.key && typeof sort.key === "string") {
    const dir = sort.dir === "asc" ? "asc" : "desc";
    if (dir === "asc") return sql`"data"->>${sort.key} asc`;
    return sql`"data"->>${sort.key} desc`;
  }
  return desc(recordsTable.createdAt);
}

// Full-text + field-filtered search within one definition.
router.get("/records/:definitionId/search", requireAuth, async (req: Request, res: Response) => {
  const definitionId = Number(req.params.definitionId);
  if (!Number.isInteger(definitionId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!(await canReadDefinition(req, definitionId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, definitionId))
    .limit(1);
  if (!def) {
    res.status(404).json({ error: "Definition not found" });
    return;
  }
  const s = scopeOf(req);
  if (!def.shared && !s.isAdmin && def.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filters = parseJson(req.query.filters);
  const sort = parseJson(req.query.sort) as { key?: string; dir?: string } | null;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const conditions = [];
  conditions.push(eq(recordsTable.definitionId, definitionId));
  if (!s.scopeAll && !def.shared) conditions.push(eq(recordsTable.userId, s.userId));
  if (q) conditions.push(sql`"search_tsv" @@ plainto_tsquery('english', ${q})`);
  for (const f of buildFilters(filters)) conditions.push(f);

  const rows = await db
    .select()
    .from(recordsTable)
    .where(and(...conditions))
    .orderBy(buildSort(sort))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recordsTable)
    .where(and(...conditions));

  res.json({ records: rows, total: Number(count) });
});

// Global search across all readable definitions.
router.get("/search/global", requireAuth, async (req: Request, res: Response) => {
  const s = scopeOf(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ error: "Query is required." });
    return;
  }
  const filters = parseJson(req.query.filters);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const conditions = [];
  if (!s.scopeAll) {
    conditions.push(
      or(
        eq(recordsTable.userId, s.userId),
        // shared definitions are readable by everyone
        sql`"definition_id" IN (SELECT "id" FROM "record_definitions" WHERE "shared" = true)`,
      ),
    );
  }
  if (q) conditions.push(sql`"search_tsv" @@ plainto_tsquery('english', ${q})`);
  for (const f of buildFilters(filters)) conditions.push(f);

  const rows = await db
    .select({
      id: recordsTable.id,
      userId: recordsTable.userId,
      definitionId: recordsTable.definitionId,
      data: recordsTable.data,
      createdAt: recordsTable.createdAt,
      updatedAt: recordsTable.updatedAt,
    })
    .from(recordsTable)
    .where(and(...conditions))
    .orderBy(desc(recordsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recordsTable)
    .where(and(...conditions));

  res.json({ records: rows, total: Number(count) });
});

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default router;
