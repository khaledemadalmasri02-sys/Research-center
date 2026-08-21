import type { AppContext } from "../lib/env";
import { parseJsonArray, parseJsonObject, writeAudit, isAdmin, canEdit, hasScope } from "../lib/security";

function canWrite(auth: any): boolean {
  return !!auth && canEdit(auth.user) && hasScope(auth.scopes, "records:write");
}

function sanitizeField(key: string): string | null {
  return /^[a-zA-Z0-9_]+$/.test(key) ? key : null;
}

function recordRow(row: any): any {
  return {
    id: row.id,
    userId: row.user_id,
    definitionId: row.definition_id,
    data: parseJsonObject(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function definitionRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    fields: parseJsonArray(row.fields),
    shared: !!row.shared,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildWhere(
  filters: Record<string, any>,
  q?: string
): { clause: string; binds: any[] } {
  const clauses: string[] = [];
  const binds: any[] = [];
  if (q && q.trim()) {
    clauses.push("data LIKE ?");
    binds.push(`%${q.trim()}%`);
  }
  for (const [rawKey, value] of Object.entries(filters)) {
    const key = sanitizeField(rawKey);
    if (!key || value === undefined || value === null || value === "") continue;
    clauses.push(`json_extract(data, '$.${key}') = ?`);
    binds.push(String(value));
  }
  return { clause: clauses.length ? `AND ${clauses.join(" AND ")}` : "", binds };
}

function buildOrder(sort?: Record<string, any>): string {
  if (!sort || !sort.field) return "ORDER BY created_at DESC";
  const field = sanitizeField(String(sort.field));
  if (!field) return "ORDER BY created_at DESC";
  const dir = String(sort.dir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  return `ORDER BY json_extract(data, '$.${field}') ${dir}`;
}

async function listRecords(
  c: AppContext,
  definitionId: number,
  user: any,
  opts: { all?: boolean } = {}
) {
  const db = c.env.DB;
  const q = c.req.query("q");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 500);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
  const filters = parseJsonObject(c.req.query("filters"));
  const sort = parseJsonObject(c.req.query("sort"));
  const { clause, binds } = buildWhere(filters, q);

  const userScope = opts.all && isAdmin(user) ? "" : "AND user_id = ?";
  const scopeBinds = opts.all && isAdmin(user) ? [] : [user.id];

  const countRes = await db
    .prepare(
      `SELECT COUNT(*) as count FROM records WHERE definition_id = ? ${userScope} ${clause}`
    )
    .bind(definitionId, ...scopeBinds, ...binds)
    .first<any>();

  const rows = await db
    .prepare(
      `SELECT * FROM records WHERE definition_id = ? ${userScope} ${clause}
       ${buildOrder(sort)} LIMIT ? OFFSET ?`
    )
    .bind(definitionId, ...scopeBinds, ...binds, limit, offset)
    .all<any>();

  return {
    records: (rows.results || []).map(recordRow),
    total: countRes?.count ?? 0,
  };
}

export const recordsHandlers = {
  // ---- Record definitions ----
  LIST_DEFINITIONS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const rows = await c.env.DB.prepare(
      "SELECT * FROM record_definitions WHERE user_id = ? OR shared = 1 ORDER BY created_at DESC"
    )
      .bind(auth!.user.id)
      .all<any>();
    return c.json({ definitions: (rows.results || []).map(definitionRow) });
  },

  CREATE_DEFINITION: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      fields?: any[];
      shared?: boolean;
    };
    if (!body.name || !body.name.trim()) {
      return c.json({ error: "Name is required." }, 400);
    }
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const res = await c.env.DB.prepare(
      `INSERT INTO record_definitions (user_id, name, fields, shared) VALUES (?, ?, ?, ?)`
    )
      .bind(auth!.user.id, body.name.trim(), JSON.stringify(fields), body.shared ? 1 : 0)
      .run();
    const id = (res as any).meta?.last_row_id;
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.definition.create",
      entity: "record_definition",
      entityId: id,
      detail: { name: body.name },
    });
    return c.json({ id, ok: true }, 201);
  },

  GET_DEFINITION: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM record_definitions WHERE id = ?")
      .bind(id)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !row.shared) {
      return c.json({ error: "Forbidden." }, 403);
    }
    return c.json(definitionRow(row));
  },

  UPDATE_DEFINITION: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM record_definitions WHERE id = ?")
      .bind(id)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id) return c.json({ error: "Forbidden." }, 403);

    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      fields?: any[];
      shared?: boolean;
    };
    const updates: string[] = [];
    const binds: any[] = [];
    if (body.name !== undefined) {
      updates.push("name = ?");
      binds.push(body.name);
    }
    if (body.fields !== undefined) {
      updates.push("fields = ?");
      binds.push(JSON.stringify(Array.isArray(body.fields) ? body.fields : []));
    }
    if (body.shared !== undefined) {
      updates.push("shared = ?");
      binds.push(body.shared ? 1 : 0);
    }
    if (updates.length === 0) return c.json({ error: "No updates." }, 400);
    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE record_definitions SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.definition.update",
      entity: "record_definition",
      entityId: id,
    });
    return c.json({ ok: true });
  },

  DELETE_DEFINITION: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM record_definitions WHERE id = ?")
      .bind(id)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id) return c.json({ error: "Forbidden." }, 403);
    await c.env.DB.prepare("DELETE FROM records WHERE definition_id = ?").bind(id).run();
    await c.env.DB.prepare("DELETE FROM record_definitions WHERE id = ?").bind(id).run();
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.definition.delete",
      entity: "record_definition",
      entityId: id,
    });
    return c.json({ ok: true });
  },

  // ---- Records ----
  LIST_RECORDS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    if (isNaN(definitionId)) return c.json({ error: "Invalid definition id" }, 400);
    const all = c.req.query("all") === "true";
    const result = await listRecords(c, definitionId, auth!.user, { all });
    // attach images
    for (const rec of result.records) {
      const imgs = await c.env.DB.prepare(
        "SELECT * FROM record_images WHERE record_id = ?"
      )
        .bind(rec.id)
        .all<any>();
      rec.images = (imgs.results || []).map((i: any) => ({
        id: i.id,
        fieldKey: i.field_key,
        objectKey: i.object_key,
        url: `/api/storage/objects/${i.object_key}`,
      }));
    }
    return c.json(result);
  },

  SEARCH_RECORDS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    if (isNaN(definitionId)) return c.json({ error: "Invalid definition id" }, 400);
    const result = await listRecords(c, definitionId, auth!.user, { all: false });
    return c.json(result);
  },

  CREATE_RECORD: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    if (isNaN(definitionId)) return c.json({ error: "Invalid definition id" }, 400);
    const def = await c.env.DB.prepare("SELECT * FROM record_definitions WHERE id = ?")
      .bind(definitionId)
      .first<any>();
    if (!def) return c.json({ error: "Definition not found." }, 404);
    if (def.user_id !== auth!.user.id && !def.shared) {
      return c.json({ error: "Forbidden." }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as { data?: Record<string, any> };
    const data = body.data && typeof body.data === "object" ? body.data : {};

    // light required-field validation
    const fields = parseJsonArray(def.fields);
    for (const f of fields) {
      if (f.required && (data[f.key] === undefined || data[f.key] === null || data[f.key] === "")) {
        return c.json({ error: `Field "${f.label || f.key}" is required.` }, 400);
      }
    }

    const res = await c.env.DB.prepare(
      "INSERT INTO records (user_id, definition_id, data) VALUES (?, ?, ?)"
    )
      .bind(auth!.user.id, definitionId, JSON.stringify(data))
      .run();
    const id = (res as any).meta?.last_row_id;
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.create",
      entity: "record",
      entityId: id,
      detail: { definitionId },
    });
    return c.json({ id, ok: true }, 201);
  },

  GET_RECORD: async (c: AppContext) => {
    const auth = c.get("authUser");
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    const recordId = parseInt(c.req.param("recordId") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM records WHERE id = ? AND definition_id = ?")
      .bind(recordId, definitionId)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !isAdmin(auth!.user)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const rec = recordRow(row);
    const imgs = await c.env.DB.prepare("SELECT * FROM record_images WHERE record_id = ?")
      .bind(recordId)
      .all<any>();
    rec.images = (imgs.results || []).map((i: any) => ({
      id: i.id,
      fieldKey: i.field_key,
      objectKey: i.object_key,
      url: `/api/storage/objects/${i.object_key}`,
    }));
    return c.json(rec);
  },

  UPDATE_RECORD: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    const recordId = parseInt(c.req.param("recordId") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM records WHERE id = ? AND definition_id = ?")
      .bind(recordId, definitionId)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !isAdmin(auth!.user)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { data?: Record<string, any> };
    if (!body.data || typeof body.data !== "object") {
      return c.json({ error: "data object required." }, 400);
    }
    await c.env.DB.prepare(
      "UPDATE records SET data = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(JSON.stringify(body.data), recordId)
      .run();
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.update",
      entity: "record",
      entityId: recordId,
    });
    return c.json({ ok: true });
  },

  DELETE_RECORD: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    const recordId = parseInt(c.req.param("recordId") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM records WHERE id = ? AND definition_id = ?")
      .bind(recordId, definitionId)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !isAdmin(auth!.user)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    await c.env.DB.prepare("DELETE FROM record_images WHERE record_id = ?").bind(recordId).run();
    await c.env.DB.prepare("DELETE FROM records WHERE id = ?").bind(recordId).run();
    await writeAudit(c, {
      userId: auth!.user.id,
      action: "records.delete",
      entity: "record",
      entityId: recordId,
    });
    return c.json({ ok: true });
  },

  // ---- Record images ----
  ATTACH_IMAGE: async (c: AppContext) => {
    const auth = c.get("authUser");
    if (!canWrite(auth)) return c.json({ error: "Forbidden" }, 403);
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    const recordId = parseInt(c.req.param("recordId") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM records WHERE id = ? AND definition_id = ?")
      .bind(recordId, definitionId)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !isAdmin(auth!.user)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { objectKey?: string; fieldKey?: string };
    if (!body.objectKey) return c.json({ error: "objectKey required." }, 400);
    const res = await c.env.DB.prepare(
      "INSERT INTO record_images (record_id, field_key, object_key) VALUES (?, ?, ?)"
    )
      .bind(recordId, body.fieldKey || "image", body.objectKey)
      .run();
    const id = (res as any).meta?.last_row_id;
    return c.json({ id, ok: true, url: `/api/storage/objects/${body.objectKey}` }, 201);
  },

  LIST_IMAGES: async (c: AppContext) => {
    const auth = c.get("authUser");
    const recordId = parseInt(c.req.param("recordId") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM records WHERE id = ?")
      .bind(recordId)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    if (row.user_id !== auth!.user.id && !isAdmin(auth!.user)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const imgs = await c.env.DB.prepare("SELECT * FROM record_images WHERE record_id = ?")
      .bind(recordId)
      .all<any>();
    return c.json({
      images: (imgs.results || []).map((i: any) => ({
        id: i.id,
        fieldKey: i.field_key,
        objectKey: i.object_key,
        url: `/api/storage/objects/${i.object_key}`,
      })),
    });
  },

  // ---- Export ----
  EXPORT: async (c: AppContext) => {
    const auth = c.get("authUser");
    const definitionId = parseInt(c.req.param("definitionId") ?? "", 10);
    if (isNaN(definitionId)) return c.json({ error: "Invalid definition id" }, 400);
    const def = await c.env.DB.prepare("SELECT * FROM record_definitions WHERE id = ?")
      .bind(definitionId)
      .first<any>();
    if (!def) return c.json({ error: "Definition not found." }, 404);

    const all = c.req.query("all") === "true";
    const result = await listRecords(c, definitionId, auth!.user, { all });
    const fields = parseJsonArray(def.fields);
    const cols = fields.map((f: any) => f.label || f.key);

    const escapeCsv = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines: string[] = [];
    lines.push(escapeCsv("id") + "," + cols.map(escapeCsv).join(",") + ",createdAt");
    for (const rec of result.records) {
      const cells = [rec.id, ...fields.map((f: any) => escapeCsv(rec.data[f.key])), rec.createdAt];
      lines.push(cells.map(escapeCsv).join(","));
    }
    const csv = "﻿" + lines.join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="records-${definitionId}.csv"`,
      },
    });
  },

  // ---- Saved views ----
  LIST_VIEWS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const definitionId = c.req.query("definitionId");
    const sql = definitionId
      ? "SELECT * FROM saved_views WHERE user_id = ? AND definition_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM saved_views WHERE user_id = ? ORDER BY created_at DESC";
    const binds = definitionId ? [auth!.user.id, parseInt(definitionId, 10)] : [auth!.user.id];
    const rows = await c.env.DB.prepare(sql).bind(...binds).all<any>();
    return c.json({
      views: (rows.results || []).map((v) => ({
        id: v.id,
        userId: v.user_id,
        definitionId: v.definition_id,
        name: v.name,
        filters: parseJsonObject(v.filters),
        sort: parseJsonObject(v.sort),
        createdAt: v.created_at,
      })),
    });
  },

  CREATE_VIEW: async (c: AppContext) => {
    const auth = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      definitionId?: number;
      filters?: any;
      sort?: any;
    };
    if (!body.name || !body.definitionId) {
      return c.json({ error: "name and definitionId required." }, 400);
    }
    const res = await c.env.DB.prepare(
      `INSERT INTO saved_views (user_id, definition_id, name, filters, sort) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        auth!.user.id,
        body.definitionId,
        body.name,
        JSON.stringify(body.filters || {}),
        JSON.stringify(body.sort || {})
      )
      .run();
    return c.json({ id: (res as any).meta?.last_row_id, ok: true }, 201);
  },

  UPDATE_VIEW: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; filters?: any; sort?: any };
    const row = await c.env.DB.prepare("SELECT * FROM saved_views WHERE id = ?").bind(id).first<any>();
    if (!row || row.user_id !== auth!.user.id) return c.json({ error: "Not found." }, 404);
    const updates: string[] = [];
    const binds: any[] = [];
    if (body.name !== undefined) { updates.push("name = ?"); binds.push(body.name); }
    if (body.filters !== undefined) { updates.push("filters = ?"); binds.push(JSON.stringify(body.filters)); }
    if (body.sort !== undefined) { updates.push("sort = ?"); binds.push(JSON.stringify(body.sort)); }
    if (!updates.length) return c.json({ error: "No updates." }, 400);
    binds.push(id);
    await c.env.DB.prepare(`UPDATE saved_views SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true });
  },

  DELETE_VIEW: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM saved_views WHERE id = ?").bind(id).first<any>();
    if (!row || row.user_id !== auth!.user.id) return c.json({ error: "Not found." }, 404);
    await c.env.DB.prepare("DELETE FROM saved_views WHERE id = ?").bind(id).run();
    return c.json({ ok: true });
  },

  // ---- Global search ----
  GLOBAL_SEARCH: async (c: AppContext) => {
    const auth = c.get("authUser");
    const q = c.req.query("q") || "";
    if (!q.trim()) return c.json({ records: [], definitions: [] });
    const rows = await c.env.DB.prepare(
      `SELECT r.* FROM records r
       JOIN record_definitions d ON d.id = r.definition_id
       WHERE (r.user_id = ? OR d.shared = 1) AND r.data LIKE ?
       ORDER BY r.created_at DESC LIMIT 100`
    )
      .bind(auth!.user.id, `%${q.trim()}%`)
      .all<any>();
    return c.json({
      records: (rows.results || []).map(recordRow),
    });
  },
};
