import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  db,
  recordDefinitionsTable,
  recordsTable,
  type FieldDef,
} from "@workspace/db";
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

// Definitions the current user may read: their own + any shared collection,
// or every collection when an admin requests scope=all.
function accessibleDefinitionsWhere(s: Scope) {
  if (s.scopeAll) return undefined;
  return or(
    eq(recordDefinitionsTable.userId, s.userId),
    eq(recordDefinitionsTable.shared, true),
  );
}

router.get("/collections/stats", requireAuth, async (req: Request, res: Response) => {
  const s = scopeOf(req);
  const where = accessibleDefinitionsWhere(s);

  const defs = await db
    .select()
    .from(recordDefinitionsTable)
    .where(where)
    .orderBy(desc(recordDefinitionsTable.createdAt));

  const defIds = defs.map((d) => d.id);

  // Record counts (total + last-30-days) per definition in a single pass.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const totalCounts = defIds.length
    ? await db
        .select({
          definitionId: recordsTable.definitionId,
          count: sql<number>`count(*)::int`,
        })
        .from(recordsTable)
        .where(inArray(recordsTable.definitionId, defIds))
        .groupBy(recordsTable.definitionId)
    : [];

  const recentCounts = defIds.length
    ? await db
        .select({
          definitionId: recordsTable.definitionId,
          count: sql<number>`count(*)::int`,
        })
        .from(recordsTable)
        .where(and(inArray(recordsTable.definitionId, defIds), gte(recordsTable.createdAt, thirtyDaysAgo)))
        .groupBy(recordsTable.definitionId)
    : [];

  const totalMap = new Map(totalCounts.map((c) => [c.definitionId, c.count]));
  const recentMap = new Map(recentCounts.map((c) => [c.definitionId, c.count]));

  const overview = defs.map((d) => ({
    id: d.id,
    name: d.name,
    isActive: Boolean(d.isActive),
    isDefault: Boolean(d.isDefault),
    shared: Boolean(d.shared),
    deactivated: Boolean(d.deactivated),
    recordCount: totalMap.get(d.id) ?? 0,
    recentCount: recentMap.get(d.id) ?? 0,
    updatedAt: d.updatedAt,
  }));

  // Resolve which collections the dashboard drills into.
  const idsParam = req.query.definitionIds as string | undefined;
  const requested = idsParam
    ? idsParam
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n))
    : [];
  const accessibleSet = new Set(defIds);
  const selectedIds = requested.filter((id) => accessibleSet.has(id));

  let targetDefs = defs.filter((d) => selectedIds.includes(d.id));
  if (targetDefs.length === 0) {
    // No explicit selection: default to the marked-default collection, else the
    // first non-deactivated one. Falls back to "all" only when there is nothing.
    const fallback =
      defs.find((d) => d.isDefault && !d.deactivated) ?? defs.find((d) => !d.deactivated);
    targetDefs = fallback ? [fallback] : [];
  }
  const targetIds = targetDefs.map((d) => d.id);

  const records = targetIds.length
    ? await db
        .select()
        .from(recordsTable)
        .where(inArray(recordsTable.definitionId, targetIds))
    : [];

  const total = records.length;
  const recentCount = records.filter((r) => new Date(r.createdAt) > thirtyDaysAgo).length;

  const perCollection = targetDefs.map((d) => ({
    id: d.id,
    name: d.name,
    total: records.filter((r) => r.definitionId === d.id).length,
    recentCount: records.filter(
      (r) => r.definitionId === d.id && new Date(r.createdAt) > thirtyDaysAgo,
    ).length,
  }));

  // Generic field statistics across the merged schema of the selected collections.
  const fieldMap = new Map<string, FieldDef>();
  for (const d of targetDefs) {
    for (const f of (d.fields as FieldDef[]) ?? []) {
      if (f.type !== "image" && !fieldMap.has(f.key)) fieldMap.set(f.key, f);
    }
  }

  const fieldStats = [];
  for (const f of fieldMap.values()) {
    const freq = new Map<string, number>();
    let numericSum = 0;
    let numericCount = 0;
    let numericMin = Infinity;
    let numericMax = -Infinity;

    for (const r of records) {
      const v = (r.data as Record<string, unknown>)?.[f.key];
      if (v === null || v === undefined || v === "") continue;
      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          numericSum += n;
          numericCount += 1;
          numericMin = Math.min(numericMin, n);
          numericMax = Math.max(numericMax, n);
        }
        continue;
      }
      const key = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : String(v);
      if (!key) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }

    if (f.type === "number") {
      if (numericCount === 0) continue;
      fieldStats.push({
        key: f.key,
        label: f.label,
        type: f.type,
        numeric: {
          count: numericCount,
          min: numericMin,
          max: numericMax,
          avg: numericCount ? Math.round((numericSum / numericCount) * 100) / 100 : 0,
        },
      });
      continue;
    }

    if (freq.size === 0) continue;
    const values = Array.from(freq.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    fieldStats.push({ key: f.key, label: f.label, type: f.type, values });
  }

  res.json({
    overview,
    summary: {
      total,
      recentCount,
      collectionCount: targetIds.length,
      selectedIds: targetIds,
    },
    perCollection,
    fieldStats,
  });
});

export default router;
