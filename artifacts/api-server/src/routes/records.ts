import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  db,
  recordDefinitionsTable,
  recordsTable,
  recordImagesTable,
  RECORD_FIELD_TYPES,
  type FieldDef,
  type RecordFieldType,
} from "@workspace/db";
import { requireAuth } from "./auth";
import { ensureUserPatientsDefinition, syncPatientsToCollection } from "../lib/patientsCollection";
import { requireEdit } from "../middlewares/requireEdit";
import { writeAudit, clientIp } from "../lib/audit";

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

function validateFields(input: unknown): { ok: boolean; error?: string; fields?: FieldDef[] } {
  if (!Array.isArray(input)) return { ok: false, error: "fields must be an array" };
  const fields: FieldDef[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Each field must be an object" };
    const f = raw as Record<string, unknown>;
    const key = f.key as unknown;
    const label = f.label as unknown;
    const type = f.type as unknown;
    if (typeof key !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key as string)) {
      return { ok: false, error: `Invalid field key: ${String(key)}` };
    }
    if (typeof label !== "string" || !label) return { ok: false, error: "Field label is required" };
    if (typeof type !== "string" || !(RECORD_FIELD_TYPES as readonly string[]).includes(type)) {
      return { ok: false, error: `Invalid field type: ${String(type)}` };
    }
    if (type === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        return { ok: false, error: `Select field "${key}" requires options` };
      }
    }
    fields.push({
      key: key as string,
      label: label as string,
      type: type as RecordFieldType,
      options: type === "select" ? (f.options as string[]) : undefined,
      required: Boolean(f.required),
    });
  }
  const seen = new Set(fields.map((f) => f.key));
  if (seen.size !== fields.length) return { ok: false, error: "Duplicate field keys are not allowed" };
  return { ok: true, fields };
}

function coerceData(fields: FieldDef[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data[f.key];
    if (f.type === "number") {
      if (v === "" || v === null || v === undefined) out[f.key] = null;
      else {
        const n = Number(v);
        out[f.key] = Number.isNaN(n) ? null : n;
      }
    } else if (f.type === "image") {
      out[f.key] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } else {
      out[f.key] = v ?? null;
    }
  }
  return out;
}

async function reconcileImages(fields: FieldDef[], recordId: number, data: Record<string, unknown>) {
  const imageKeys = fields.filter((f) => f.type === "image").map((f) => f.key);

  await db.delete(recordImagesTable).where(eq(recordImagesTable.recordId, recordId));
  for (const k of imageKeys) {
    const keys = Array.isArray(data[k]) ? (data[k] as string[]) : [];
    for (const objectKey of keys) {
      await db.insert(recordImagesTable).values({ recordId, fieldKey: k, objectKey });
    }
  }
}

async function canAccessDefinition(req: Request, id: number, write: boolean) {
  const [def] = await db.select().from(recordDefinitionsTable).where(eq(recordDefinitionsTable.id, id)).limit(1);
  if (!def) return { def: null as null, status: 404 as const };
  const s = scopeOf(req);
  // Collections are private to their owner.
  if (def.userId !== s.userId) {
    return { def: null as null, status: 403 as const };
  }
  return { def, status: 200 as const };
}

// ---- Definitions ----------------------------------------------------------
router.get("/records/definitions", async (req: Request, res: Response) => {
  const s = scopeOf(req);
  // Collections are private: only the current user's own collections are returned.
  const defs = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.userId, s.userId))
    .orderBy(desc(recordDefinitionsTable.createdAt));
  res.json({ definitions: defs });
});

// Returns the current user's own "Patients" collection (a private mirror of the
// patients they own) along with its records. Each call re-syncs the collection
// from the user's patients so the directory always reflects their data.
router.get("/records/patients", requireAuth, async (req: Request, res: Response) => {
  const defId = await syncPatientsToCollection(req.session.userId ?? 0);
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, defId))
    .limit(1);
  const records = await db
    .select()
    .from(recordsTable)
    .where(eq(recordsTable.definitionId, defId))
    .orderBy(desc(recordsTable.createdAt));
  res.json({ definition: def ?? null, records });
});

router.post("/records/definitions", requireEdit, async (req: Request, res: Response) => {
  const { name, fields } = req.body as { name?: string; fields?: unknown };
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const v = validateFields(fields);
  if (!v.ok) {
    res.status(400).json({ error: v.error });
    return;
  }

  const [def] = await db
    .insert(recordDefinitionsTable)
    .values({ userId: req.session.userId ?? 0, name, fields: v.fields })
    .returning();

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.definition.create",
    entity: "record_definition",
    entityId: def.id,
    detail: { name },
    ip: clientIp(req),
  });

  res.status(201).json({ definition: def });
});

router.get("/records/definitions/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { def, status } = await canAccessDefinition(req, id, false);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Not found" });
    return;
  }
  res.json({ definition: def });
});

router.patch("/records/definitions/:id", requireEdit, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { def, status } = await canAccessDefinition(req, id, true);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Not found" });
    return;
  }

  const { name, fields } = req.body as { name?: string; fields?: unknown };
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (fields !== undefined) {
    const v = validateFields(fields);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
    update.fields = v.fields;
  }

  const [updated] = await db
    .update(recordDefinitionsTable)
    .set(update)
    .where(eq(recordDefinitionsTable.id, id))
    .returning();

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.definition.update",
    entity: "record_definition",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ definition: updated });
});

router.delete("/records/definitions/:id", requireEdit, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { def, status } = await canAccessDefinition(req, id, true);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Not found" });
    return;
  }

  await db.delete(recordsTable).where(eq(recordsTable.definitionId, id));
  await db.delete(recordDefinitionsTable).where(eq(recordDefinitionsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.definition.delete",
    entity: "record_definition",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

// ---- Records ---------------------------------------------------------------
router.get("/records", async (req: Request, res: Response) => {
  const s = scopeOf(req);
  const definitionId = req.query.definitionId ? Number(req.query.definitionId) : undefined;
  const definitionIdValid = Number.isInteger(definitionId) ? (definitionId as number) : undefined;

  const conditions = [eq(recordsTable.userId, s.userId)];
  if (definitionIdValid) {
    conditions.push(eq(recordsTable.definitionId, definitionIdValid));
  }

  const rows = await db
    .select()
    .from(recordsTable)
    .where(and(...conditions))
    .orderBy(desc(recordsTable.createdAt));

  res.json({ records: rows });
});

router.post("/records", requireEdit, async (req: Request, res: Response) => {
  const { definitionId, data } = req.body as { definitionId?: number; data?: Record<string, unknown> };
  if (!definitionId || !Number.isInteger(definitionId)) {
    res.status(400).json({ error: "definitionId is required" });
    return;
  }

  const { def, status } = await canAccessDefinition(req, definitionId, false);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Definition not found" });
    return;
  }

  const fields = (def.fields as FieldDef[]) ?? [];
  const coerced = coerceData(fields, data ?? {});

  const [record] = await db
    .insert(recordsTable)
    .values({ userId: req.session.userId ?? 0, definitionId, data: coerced })
    .returning();

  await reconcileImages(def.fields as FieldDef[], record.id, coerced);

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.create",
    entity: "record",
    entityId: record.id,
    detail: { definitionId },
    ip: clientIp(req),
  });

  res.status(201).json({ record });
});

router.get("/records/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const s = scopeOf(req);
  const [record] = await db.select().from(recordsTable).where(eq(recordsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (record.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, record.definitionId))
    .limit(1);

  res.json({ record, definition: def ?? null });
});

router.patch("/records/:id", requireEdit, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const s = scopeOf(req);
  const [record] = await db.select().from(recordsTable).where(eq(recordsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (record.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, record.definitionId))
    .limit(1);
  if (!def) {
    res.status(404).json({ error: "Definition not found" });
    return;
  }

  const { data } = req.body as { data?: Record<string, unknown> };
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "data object is required" });
    return;
  }
  const coerced = coerceData(def.fields as FieldDef[], data);
  const [updated] = await db
    .update(recordsTable)
    .set({ data: coerced })
    .where(eq(recordsTable.id, id))
    .returning();

  await reconcileImages(def.fields as FieldDef[], id, coerced);

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.update",
    entity: "record",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ record: updated });
});

router.delete("/records/:id", requireEdit, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const s = scopeOf(req);
  const [record] = await db.select().from(recordsTable).where(eq(recordsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (record.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(recordImagesTable).where(eq(recordImagesTable.recordId, id));
  await db.delete(recordsTable).where(eq(recordsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.delete",
    entity: "record",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

// ---- Activate (mark a collection as the active one) -------------------------
router.patch("/records/definitions/:id/activate", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, id))
    .limit(1);
  if (!def) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Only one collection may be active per user: clear the active flag on the
  // current user's other collections before activating this one.
  const s = scopeOf(req);
  await db.execute(sql`UPDATE "record_definitions" SET "isActive" = false WHERE "user_id" = ${s.userId}`);
  await db
    .update(recordDefinitionsTable)
    .set({ isActive: true, deactivated: false })
    .where(eq(recordDefinitionsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.definition.activate",
    entity: "record_definition",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

// ---- Deactivate (clear a collection's active flag) -------------------------
router.patch("/records/definitions/:id/deactivate", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, id))
    .limit(1);
  if (!def) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .update(recordDefinitionsTable)
    .set({ isActive: false, deactivated: true })
    .where(eq(recordDefinitionsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.definition.deactivate",
    entity: "record_definition",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

// ---- Set / clear the default collection (used for new records) --------------
router.patch("/records/definitions/:id/default", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { isDefault } = (req.body ?? {}) as { isDefault?: boolean };
  if (typeof isDefault !== "boolean") {
    res.status(400).json({ error: "isDefault boolean is required" });
    return;
  }
  const [def] = await db
    .select()
    .from(recordDefinitionsTable)
    .where(eq(recordDefinitionsTable.id, id))
    .limit(1);
  if (!def) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Only one collection can be the default per user; clear it on the current
  // user's other collections first.
  const s = scopeOf(req);
  if (isDefault) {
    await db.execute(sql`UPDATE "record_definitions" SET "isDefault" = false WHERE "user_id" = ${s.userId}`);
  }
  await db
    .update(recordDefinitionsTable)
    .set({ isDefault })
    .where(eq(recordDefinitionsTable.id, id));

  await writeAudit({
    userId: req.session.userId ?? null,
    action: isDefault ? "record.definition.setDefault" : "record.definition.clearDefault",
    entity: "record_definition",
    entityId: id,
    ip: clientIp(req),
  });

  res.json({ ok: true });
});

// ---- Bulk import (create many records at once, e.g. from an uploaded file) -
router.post("/records/:definitionId/import", requireEdit, async (req: Request, res: Response) => {
  const definitionId = Number(req.params.definitionId);
  if (!Number.isInteger(definitionId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { def, status } = await canAccessDefinition(req, definitionId, false);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Definition not found" });
    return;
  }

  const { rows } = req.body as { rows?: Record<string, unknown>[] };
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows array is required" });
    return;
  }

  const fields = (def.fields as FieldDef[]) ?? [];
  let inserted = 0;
  for (const row of rows) {
    const coerced = coerceData(fields, row ?? {});
    await db.insert(recordsTable).values({
      userId: req.session.userId ?? 0,
      definitionId,
      data: coerced,
    });
    inserted++;
  }

  await writeAudit({
    userId: req.session.userId ?? null,
    action: "record.import",
    entity: "record_definition",
    entityId: definitionId,
    detail: { count: inserted },
    ip: clientIp(req),
  });

  res.status(201).json({ inserted });
});

// ---- Export (CSV / Excel) --------------------------------------------------
router.get("/records/:definitionId/export", requireAuth, async (req: Request, res: Response) => {
  const definitionId = Number(req.params.definitionId);
  if (!Number.isInteger(definitionId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { def, status } = await canAccessDefinition(req, definitionId, false);
  if (!def) {
    res.status(status).json({ error: status === 403 ? "Forbidden" : "Definition not found" });
    return;
  }
  if (req.session.role === "viewer") {
    res.status(403).json({ error: "Export requires edit access." });
    return;
  }

  const s = scopeOf(req);
  // Export is always scoped to the current user's own records in the collection.
  const conditions = [eq(recordsTable.definitionId, definitionId), eq(recordsTable.userId, s.userId)];

  const rows = await db
    .select()
    .from(recordsTable)
    .where(and(...conditions))
    .orderBy(desc(recordsTable.createdAt));

  const fields = (def.fields as FieldDef[]) ?? [];
  const columns = fields.map((f) => ({ key: f.key, label: f.label }));

  const format = req.query.format === "excel" ? "excel" : "csv";
  const safeName = def.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "records";

  if (format === "excel") {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(def.name);
    sheet.columns = [
      { header: "ID", key: "id" },
      ...columns.map((c) => ({ header: c.label, key: c.key })),
      { header: "Created At", key: "createdAt" },
      { header: "Updated At", key: "updatedAt" },
    ];
    for (const r of rows) {
      const data = (r.data as Record<string, unknown>) ?? {};
      const row: Record<string, unknown> = { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt };
      for (const c of columns) row[c.key] = formatValue(data[c.key]);
      sheet.addRow(row);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
    res.send(Buffer.from(buffer));
    return;
  }

  const esc = (v: unknown) => {
    const s = String(formatValue(v) ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["id", ...columns.map((c) => c.label), "createdAt", "updatedAt"];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    const data = (r.data as Record<string, unknown>) ?? {};
    const cells = [r.id, ...columns.map((c) => formatValue(data[c.key])), r.createdAt, r.updatedAt];
    lines.push(cells.map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
  res.send(lines.join("\n"));
});

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---- Images ----------------------------------------------------------------
router.get("/records/:id/images", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const s = scopeOf(req);
  const [record] = await db.select().from(recordsTable).where(eq(recordsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (record.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const images = await db
    .select()
    .from(recordImagesTable)
    .where(eq(recordImagesTable.recordId, id));
  res.json({ images });
});

router.post("/records/:id/images", requireEdit, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { fieldKey, objectKey } = req.body as { fieldKey?: string; objectKey?: string };
  if (typeof fieldKey !== "string" || typeof objectKey !== "string") {
    res.status(400).json({ error: "fieldKey and objectKey are required" });
    return;
  }
  const s = scopeOf(req);
  const [record] = await db.select().from(recordsTable).where(eq(recordsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (record.userId !== s.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.insert(recordImagesTable).values({ recordId: id, fieldKey, objectKey });

  const current = (record.data as Record<string, unknown>) ?? {};
  const arr = Array.isArray(current[fieldKey]) ? (current[fieldKey] as string[]) : [];
  if (!arr.includes(objectKey)) arr.push(objectKey);
  const newData = { ...current, [fieldKey]: arr };
  await db.update(recordsTable).set({ data: newData }).where(eq(recordsTable.id, id));

  res.status(201).json({ ok: true });
});

export default router;
