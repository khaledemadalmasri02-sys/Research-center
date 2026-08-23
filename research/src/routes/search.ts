import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, writeAudit } from "../lib/security";

// Allow-listed filter key chars so json_extract paths can never be injected.
function safeKey(k: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k);
}

export interface SearchResult {
  id: number;
  definitionId: number;
  data: Record<string, any>;
  createdAt: string;
}

export const searchApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/search — search records (auth). Free-text over JSON + allow-listed
// field filters. All values are bound parameters (no string interpolation).
searchApp.post("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const userId = auth.user.id;
  const q = typeof body?.q === "string" ? body.q.trim() : "";
  const definitionId = body?.definitionId != null ? parseInt(body.definitionId, 10) : null;
  const filters: Record<string, any> = body?.filters && typeof body.filters === "object" ? body.filters : {};

  const where: string[] = ["user_id = ?"];
  const binds: any[] = [userId];
  if (definitionId != null) {
    where.push("definition_id = ?");
    binds.push(definitionId);
  }
  if (q) {
    where.push("data LIKE ?");
    binds.push(`%${q}%`);
  }
  for (const [key, value] of Object.entries(filters)) {
    if (!safeKey(key) || value == null || value === "") continue;
    where.push(`json_extract(data, ?) = ?`);
    binds.push(`$.${key}`, String(value));
  }

  const rows = await c.env.DB
    .prepare(`SELECT * FROM records WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 200`)
    .bind(...binds)
    .all<any>();
  const results: SearchResult[] = (rows.results || []).map((r: any) => ({
    id: r.id,
    definitionId: r.definition_id,
    data: typeof r.data === "string" ? safeJson(r.data) : r.data,
    createdAt: r.created_at,
  }));
  return c.json({ count: results.length, results });
});

export const savedViewsApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/saved-views — list own saved views (auth)
savedViewsApp.get("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const rows = await c.env.DB
    .prepare("SELECT * FROM saved_views WHERE user_id = ? ORDER BY id DESC")
    .bind(auth.user.id)
    .all<any>();
  return c.json({
    views: (rows.results || []).map((v: any) => ({
      id: v.id,
      name: v.name,
      definitionId: v.definition_id,
      filters: safeJson(v.filters),
      sort: safeJson(v.sort),
    })),
  });
});

// POST /api/saved-views — create a saved view (auth)
savedViewsApp.post("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required." }, 400);
  const definitionId = body?.definitionId != null ? parseInt(body.definitionId, 10) : 0;
  const result = (await c.env.DB
    .prepare("INSERT INTO saved_views (user_id, definition_id, name, filters, sort) VALUES (?, ?, ?, ?, ?)")
    .bind(auth.user.id, definitionId, name, JSON.stringify(body?.filters ?? {}), JSON.stringify(body?.sort ?? {}))
    .run()) as any;
  await writeAudit(c, { userId: auth.user.id, action: "saved_view.create", entity: "saved_view", entityId: result?.meta?.last_row_id });
  return c.json({ ok: true, id: result?.meta?.last_row_id }, 201);
});

// DELETE /api/saved-views/:id — delete own saved view (auth)
savedViewsApp.delete("/:id", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM saved_views WHERE id = ? AND user_id = ?").bind(id, auth.user.id).run();
  return c.json({ ok: true });
});

function safeJson(v: any) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
