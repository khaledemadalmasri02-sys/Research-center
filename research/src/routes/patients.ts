import type { Context } from "hono";
import { getS3Config, putObject } from "../lib/s3";
import { resolvePatient, parseRadiologyImages, parseRadiologyLinks } from "../lib/patients";
import { ssrfCheck } from "../lib/security";

const COLUMN_ALIASES: Record<string, string> = {
  collectionName: "collection_name",
  collectionDate: "collection_date",
  collectionType: "collection_type",
  patientId: "patient_id",
  patientName: "patient_name",
  age: "age",
  sex: "sex",
  dateOfVisit: "date_of_visit",
  chiefComplaint: "chief_complaint",
  vitalSigns: "vital_signs",
  historyTrauma: "history_trauma",
  mechanismOfInjuryAndLocalisation: "mechanism_of_injury_and_localisation",
  signsAndSymptomsTrauma: "signs_and_symptoms_trauma",
  historyMedical: "history_medical",
  signsAndSymptomsMedical: "signs_and_symptoms_medical",
  riskFactors: "risk_factors",
  provisionalDiagnosis: "provisional_diagnosis",
  radiologyImageFilePathOrLink: "radiology_image_file_path_or_link",
  radiologyImages: "radiology_images",
  emergencyReport: "emergency_report",
  aiPredictionOutput: "ai_prediction_output",
  finalConfirmedDiagnosisAr: "final_confirmed_diagnosis_ar",
  finalConfirmedDiagnosis: "final_confirmed_diagnosis",
  notes: "notes",
};

function toDbColumns(record: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [rawKey, value] of Object.entries(record)) {
    const key = String(rawKey);
    if (key === "id") continue;
    const column = COLUMN_ALIASES[key] || (key in COLUMN_ALIASES ? COLUMN_ALIASES[key] : null);
    if (column) {
      out[column] = value;
    } else if (/^[a-z_]+$/.test(key) && key in LEGAL_COLUMNS) {
      // accept snake_case columns directly
      out[key] = value;
    }
  }
  return out;
}

const LEGAL_COLUMNS: Record<string, boolean> = Object.values(COLUMN_ALIASES).reduce(
  (acc, col) => {
    acc[col] = true;
    return acc;
  },
  {} as Record<string, boolean>
);

// Reverse map (snake_case DB column -> camelCase API field) so reads from the
// worker return the same shape the generated frontend client expects.
const DB_TO_CAMEL: Record<string, string> = {
  id: "id",
  ...Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([camel, snake]) => [snake, camel])
  ),
  created_at: "createdAt",
  updated_at: "updatedAt",
};

function rowToCamel(row: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!row) return row as any;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[DB_TO_CAMEL[k] ?? k] = v;
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Parse column definitions out of a CREATE TABLE statement. D1 does not allow
// PRAGMA, so this is how we surface column metadata from sqlite_master.sql.
function parseColumns(sql?: string | null): any[] {
  if (!sql) return [];
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < 0) return [];
  const defs = splitTopLevel(sql.slice(open + 1, close));
  const columns: any[] = [];
  for (const raw of defs) {
    const t = raw.trim();
    if (!t) continue;
    const upper = t.toUpperCase();
    if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT|KEY)\b/.test(upper)) continue;
    const m = t.match(/^["`]?([^\s"`(]+)["`]?\s*([\s\S]*)$/);
    if (!m) continue;
    const name = m[1];
    const rest = m[2].trim();
    const notNull = /\bNOT\s+NULL\b/i.test(rest);
    const primaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);
    const defMatch = rest.match(/\bDEFAULT\s+([^\s,]+)/i);
    const type = rest
      .replace(/\b(?:NOT\s+NULL|PRIMARY\s+KEY|DEFAULT\s+\S+|UNIQUE|AUTOINCREMENT)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    columns.push({
      name,
      type: type || null,
      nullable: !notNull,
      default: defMatch ? defMatch[1].replace(/^'(.*)'$/, "$1") : null,
      primaryKey,
    });
  }
  return columns;
}

function coerceValue(key: string, value: any): any {
  if (value === null || value === undefined) return null;
  if (key === "age") {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    return Number.isNaN(n) ? null : Math.round(n);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const patientsHandlers = {
  GET_ALL: async (c: Context) => {
    try {
      const db = c.env.DB;
      const search = (c.req.query("search") || "").trim();
      const sex = c.req.query("sex");
      const collectionType = c.req.query("collectionType");
      const limitRaw = parseInt(c.req.query("limit") || "", 10);
      const limit = Number.isNaN(limitRaw) || limitRaw <= 0 ? 1000 : Math.min(limitRaw, 5000);

      const clauses: string[] = [];
      const binds: any[] = [];

      if (search) {
        clauses.push("(patient_id LIKE ? OR patient_name LIKE ? OR notes LIKE ? OR chief_complaint LIKE ?)");
        const like = `%${search}%`;
        binds.push(like, like, like, like);
      }
      if (sex) {
        clauses.push("sex = ?");
        binds.push(sex);
      }
      if (collectionType) {
        clauses.push("collection_type = ?");
        binds.push(collectionType);
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const result = await db
        .prepare(`SELECT * FROM patients ${where} ORDER BY created_at DESC LIMIT ${limit}`)
        .bind(...binds)
        .all();
      const patients = ((result as any).results || []).map(rowToCamel);
      return c.json({ patients, total: patients.length });
    } catch (error) {
      console.error("Error fetching patients:", error);
      return c.json({ error: "Failed to fetch patients" }, 500);
    }
  },

  CREATE: async (c: Context) => {
    try {
      const payload = await c.req.json();
      const record = toDbColumns(payload);
      const db = c.env.DB;

      if (!record.patient_id || !record.patient_name) {
        return c.json({ error: "patient_id and patient_name are required" }, 400);
      }

      const columns = Object.keys(record);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((col) => coerceValue(col, record[col]));

      await db
        .prepare(
          `INSERT INTO patients (${columns.join(", ")}) VALUES (${placeholders})`
        )
        .bind(...values)
        .run();

      const newPatient = await db
        .prepare("SELECT * FROM patients WHERE id = last_insert_rowid()")
        .first();
      return c.json(rowToCamel(newPatient as any), 201);
    } catch (error) {
      console.error("Error creating patient:", error);
      return c.json({ error: "Failed to create patient" }, 500);
    }
  },

  GET_BY_ID: async (c: Context) => {
    try {
      const idStr = c.req.param("id");
      if (!idStr) return c.json({ error: "Patient ID required" }, 400);
      const id = parseInt(idStr, 10);
      if (isNaN(id)) return c.json({ error: "Invalid patient ID" }, 400);

      const db = c.env.DB;
      const patient = await db.prepare("SELECT * FROM patients WHERE id = ?").bind(id).first();
      if (!patient) {
        return c.json({ error: "Patient not found" }, 404);
      }
      return c.json(rowToCamel(patient as any));
    } catch (error) {
      console.error("Error fetching patient:", error);
      return c.json({ error: "Failed to fetch patient" }, 500);
    }
  },

  PATCH: async (c: Context) => {
    try {
      const idStr = c.req.param("id");
      if (!idStr) return c.json({ error: "Patient ID required" }, 400);
      const id = parseInt(idStr, 10);
      if (isNaN(id)) return c.json({ error: "Invalid patient ID" }, 400);

      const updates = await c.req.json();
      const db = c.env.DB;

      const setClause: string[] = [];
      const values: any[] = [];

      for (const [key, value] of Object.entries(updates)) {
        if (key === "id") continue;
        const column = COLUMN_ALIASES[key] || (key in LEGAL_COLUMNS ? key : null);
        if (!column) continue;
        setClause.push(`${column} = ?`);
        values.push(coerceValue(column, value));
      }

      if (setClause.length === 0) {
        return c.json({ error: "No updates provided" }, 400);
      }

      values.push(id);

      await db
        .prepare(`UPDATE patients SET ${setClause.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values)
        .run();

      const updatedPatient = await db.prepare("SELECT * FROM patients WHERE id = ?").bind(id).first();
      return c.json(rowToCamel(updatedPatient as any));
    } catch (error) {
      console.error("Error updating patient:", error);
      return c.json({ error: "Failed to update patient" }, 500);
    }
  },

  DELETE: async (c: Context) => {
    try {
      const idStr = c.req.param("id");
      if (!idStr) return c.json({ error: "Patient ID required" }, 400);
      const id = parseInt(idStr, 10);
      if (isNaN(id)) return c.json({ error: "Invalid patient ID" }, 400);

      const db = c.env.DB;
      await db.prepare("DELETE FROM patients WHERE id = ?").bind(id).run();
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("Error deleting patient:", error);
      return c.json({ error: "Failed to delete patient" }, 500);
    }
  },

  BATCH: async (c: Context) => {
    try {
      const db = c.env.DB;
      const patients = await db.prepare("SELECT * FROM patients WHERE 1=1").all();
      return c.json(((patients as any).results || []).map(rowToCamel));
    } catch (error) {
      console.error("Error fetching patients batch:", error);
      return c.json({ error: "Failed to fetch patients" }, 500);
    }
  },

  BATCH_IMPORT: async (c: Context) => {
    try {
      const body = (await c.req.json()) as { patients?: Record<string, any>[] };
      const incoming = body.patients;
      if (!Array.isArray(incoming)) {
        return c.json({ error: "patients array is required" }, 400);
      }

      const db = c.env.DB;
      const results: { success: boolean; error?: string; errors?: string[] }[] = [];
      let processed = 0;
      let failed = 0;

      for (const raw of incoming) {
        const record = toDbColumns(raw);
        if (!record.patient_id || !record.patient_name) {
          failed++;
          results.push({ success: false, errors: ["patient_id and patient_name are required"] });
          continue;
        }
        try {
          const columns = Object.keys(record);
          const placeholders = columns.map(() => "?").join(", ");
          const values = columns.map((col) => coerceValue(col, record[col]));
          await db
            .prepare(`INSERT INTO patients (${columns.join(", ")}) VALUES (${placeholders})`)
            .bind(...values)
            .run();
          processed++;
          results.push({ success: true });
        } catch (e: any) {
          failed++;
          results.push({ success: false, errors: [e?.message || "Insert failed"] });
        }
      }

      return c.json({ processed, failed, results }, 200);
    } catch (error) {
      console.error("Error importing patients:", error);
      return c.json({ error: "Failed to import patients" }, 500);
    }
  },

  BATCH_IMPORT_IMAGES: async (c: Context) => {
    try {
      const session = c.get("session") as { authenticated: boolean } | null;
      if (!session?.authenticated) return c.json({ error: "Unauthorized" }, 401);

      const body = (await c.req.json()) as { patientId?: string | number; imageUrls?: string[] };
      const urls = Array.isArray(body.imageUrls)
        ? body.imageUrls.map((u) => String(u).trim()).filter((u) => u && /^https?:\/\//.test(u))
        : [];

      if (urls.length === 0) {
        return c.json({ uploaded: 0, errors: ["No valid image URLs provided"] }, 400);
      }

      const bindings = c.env as any;
      const db = bindings.DB;
      const s3 = getS3Config(bindings);
      if (!s3 && !(bindings.R2_BUCKET && typeof bindings.R2_BUCKET.put === "function")) {
        return c.json({ error: "Storage not configured." }, 500);
      }

      let uploaded = 0;
      const errors: string[] = [];
      const results: { url: string; patientId?: string; status: "linked" | "orphaned" | "error" }[] = [];

      // Pull candidate patient identifiers out of a URL's filename so a bulk
      // import (no explicit patientId) can still be linked per-record.
      const candidatesFromUrl = (url: string): string[] => {
        const name = url.split("?")[0].split("/").pop() || "";
        const out: string[] = [];
        for (const p of [/PAT(\d+)/i, /patient[_-]?(\d+)/i, /id[_-]?(\d+)/i, /(\d{4,})/]) {
          const m = name.match(p);
          if (m?.[1]) out.push(m[1]);
        }
        return out;
      };

      for (const url of urls) {
        try {
          const ssrf = ssrfCheck(url);
          if (!ssrf.ok) {
            errors.push(`Blocked ${url}: ${ssrf.reason}`);
            results.push({ url, status: "error" });
            continue;
          }
          const res = await fetch(url);
          if (!res.ok) {
            errors.push(`Failed to download ${url}: HTTP ${res.status}`);
            results.push({ url, status: "error" });
            continue;
          }
          const buffer = await res.arrayBuffer();
          const contentType = res.headers.get("content-type") || "image/jpeg";
          const urlObj = new URL(url);
          const originalName = urlObj.pathname.split("/").pop() || "image.jpg";
          const safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");

          // Resolve the patient: explicit hint first, else parse the filename.
          let detected = body.patientId ? await resolvePatient(db, body.patientId) : null;
          if (!detected) {
            for (const cand of candidatesFromUrl(url)) {
              const r = await resolvePatient(db, cand);
              if (r) {
                detected = r;
                break;
              }
            }
          }

          const key = `radiology/${detected?.patientId ?? "unknown"}/${Date.now()}-${safeName}`;

          if (bindings.R2_BUCKET && typeof bindings.R2_BUCKET.put === "function") {
            await bindings.R2_BUCKET.put(key, buffer as BodyInit, {
              httpMetadata: { contentType },
            });
          } else {
            await putObject(s3!, key, new Uint8Array(buffer), contentType);
          }

          if (detected) {
            const existing = (await db
              .prepare(
                "SELECT radiology_images, radiology_image_file_path_or_link FROM patients WHERE id = ?"
              )
              .bind(detected.id)
              .first()) as any;
            const images = parseRadiologyImages(existing?.radiology_images);
            images.push(key);
            const links = parseRadiologyLinks(existing?.radiology_image_file_path_or_link);
            links.push(key);
            await db
              .prepare(
                "UPDATE patients SET radiology_images = ?, radiology_image_file_path_or_link = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
              )
              .bind(JSON.stringify(images), JSON.stringify(links), detected.id)
              .run();
            uploaded++;
            results.push({ url, patientId: detected.patientId, status: "linked" });
          } else {
            // Uploaded but could not be linked to any patient record.
            results.push({ url, status: "orphaned" });
          }
        } catch (e: any) {
          errors.push(`Error processing ${url}: ${e?.message || "unknown error"}`);
          results.push({ url, status: "error" });
        }
      }

      return c.json(
        { uploaded, errors: errors.length ? errors : undefined, results },
        200
      );
    } catch (error) {
      console.error("Error importing images:", error);
      return c.json({ error: "Failed to import images" }, 500);
    }
  },

  STATS: async (c: Context) => {
    try {
      const db = c.env.DB;
      const all = (await db.prepare("SELECT * FROM patients").all()) as any;
      const rows: any[] = all.results || [];

      const total = rows.length;
      const maleCount = rows.filter((p) => p.sex === "Male").length;
      const femaleCount = rows.filter((p) => p.sex === "Female").length;

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentCount = rows.filter((p) => {
        const t = p.created_at ? new Date(p.created_at).getTime() : NaN;
        return !isNaN(t) && t > thirtyDaysAgo;
      }).length;

      const diagnosisMap: Record<string, number> = {};
      for (const p of rows) {
        const diag = p.final_confirmed_diagnosis || p.provisional_diagnosis;
        if (diag) diagnosisMap[diag] = (diagnosisMap[diag] || 0) + 1;
      }
      const diagnosisCounts = Object.entries(diagnosisMap)
        .map(([diagnosis, count]) => ({ diagnosis, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const ageBrackets = [
        { bracket: "0-17", count: 0 },
        { bracket: "18-29", count: 0 },
        { bracket: "30-44", count: 0 },
        { bracket: "45-59", count: 0 },
        { bracket: "60-74", count: 0 },
        { bracket: "75+", count: 0 },
      ];
      for (const p of rows) {
        const age = typeof p.age === "number" ? p.age : parseInt(p.age, 10);
        if (!isNaN(age)) {
          if (age <= 17) ageBrackets[0].count++;
          else if (age <= 29) ageBrackets[1].count++;
          else if (age <= 44) ageBrackets[2].count++;
          else if (age <= 59) ageBrackets[3].count++;
          else if (age <= 74) ageBrackets[4].count++;
          else ageBrackets[5].count++;
        }
      }

      const collectionTypeMap: Record<string, number> = {};
      for (const p of rows) {
        const t = p.collection_type || "Unspecified";
        collectionTypeMap[t] = (collectionTypeMap[t] || 0) + 1;
      }
      const collectionTypeCounts = Object.entries(collectionTypeMap)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      return c.json({
        total,
        maleCount,
        femaleCount,
        recentCount,
        diagnosisCounts,
        ageBrackets,
        collectionTypeCounts,
      });
    } catch (error) {
      console.error("Error fetching patient stats:", error);
      return c.json({ error: "Failed to fetch patient stats" }, 500);
    }
  },

  COLLECTION_STATS: async (c: Context) => {
    try {
      const db = c.env.DB;
      const results = await db.prepare(
        "SELECT collection_type as type, COUNT(*) as count FROM patients WHERE collection_type IS NOT NULL GROUP BY collection_type"
      ).all();
      const counts = (results as any).results?.map((row: any) => ({
        type: row.type,
        count: row.count,
      })) || [];
      return c.json({ collectionTypeCounts: counts });
    } catch (error) {
      console.error("Error fetching collection stats:", error);
      return c.json({ collectionTypeCounts: [] });
    }
  },

  TABLES: async (c: Context) => {
    try {
      const db = c.env.DB;
      // Note: D1 rejects both `PRAGMA table_info(...)` and the
      // `pragma_table_info(...)` table-valued function with SQLITE_AUTH, so we
      // derive column info by parsing the CREATE TABLE statement stored in
      // sqlite_master (a plain, allowed SELECT).
      const tablesRes = await db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
        )
        .all();
      const rows: any[] = (tablesRes as any).results || [];
      const tables: Record<string, { columns: any[] }> = {};
      for (const r of rows) {
        tables[r.name] = { columns: parseColumns(r.sql) };
      }
      return c.json({ tables });
    } catch (error) {
      console.error("Error fetching tables:", error);
      return c.json({ error: "Failed to fetch tables" }, 500);
    }
  },

  TABLE_DATA: async (c: Context) => {
    try {
      const db = c.env.DB;
      const table = c.req.param("table");
      if (!table) return c.json({ error: "Table name required" }, 400);

      // Only allow real user tables (prevents SQL injection via table name and
      // blocks Cloudflare system tables like _cf_KV that can't be queried).
      if (/^(_cf_|sqlite_)/.test(table)) {
        return c.json({ error: "Unknown table" }, 404);
      }
      const allowed = (await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .bind(table)
        .first()) as any;
      if (!allowed) return c.json({ error: "Unknown table" }, 404);

      const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 1000);
      const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

      const countRes = (await db
        .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
        .first()) as any;
      const count = countRes?.count || 0;

      const rows = (await db
        .prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
        .bind(limit, offset)
        .all()) as any;

      return c.json({ table, count, rows: rows.results || [] });
    } catch (error) {
      console.error("Error fetching table data:", error);
      return c.json({ error: "Failed to fetch table data" }, 500);
    }
  },
};
