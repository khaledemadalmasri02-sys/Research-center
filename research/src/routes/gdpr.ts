import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, isAdmin, writeAudit } from "../lib/security";
import { getS3Config, deleteObject } from "../lib/s3";

export const gdprApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// ---------------------------------------------------------------------------
// WHAT AN ERASURE REQUEST ACTUALLY HAS TO REACH IN THIS PLATFORM
// ---------------------------------------------------------------------------
// Before this fix, `DELETE /api/gdpr/erasure/:patientId` deleted rows from four
// D1 tables and returned `{ok:true, deletedRows:n}`. An admin therefore saw a
// success response, the request was filed as complete, and a DPO signed off —
// while ALL of the patient's data survived, because:
//
//   1. POSTGRES (the live PHI store). Patients are created and updated by
//      artifacts/research-data via the `/api/*` proxy, which lands on the
//      Express api-server, which writes Postgres tables `patients`, `records`,
//      `record_images`, `notifications` and `audit_log.detail`. The Worker's D1
//      `patients` table receives nothing (see the KNOWN ISSUE block in
//      src/index.ts). Erasing D1 erases nothing.
//   2. OBJECT STORAGE. Every radiology image lives at an S3/MinIO/R2 key under
//      `radiology/`. `dicom_images.object_key`, `radiology_images.object_key`,
//      `consents.document_object_key` and the `patients.radiology_images` JSON
//      array all point at them.
//   3. AUDIT LOG. Legal/regulatory practice is to retain the audit trail, so it
//      is anonymised (scrubbed of the patient's identifiers) rather than
//      deleted — see anonymiseAuditTrail().
//
// The previous implementation also dropped the `pseudonyms` row FIRST, which
// destroyed the only linkage that maps a patient's S3 object keys back to them.
// Object keys are now collected BEFORE anything is deleted.
//
// `ok` is now a computed verdict across all three stores, and a partial run
// leaves a row in `pending_erasure` so it is visible and retryable rather than
// silently reported as complete.
// ---------------------------------------------------------------------------

interface ErasureOutcome {
  store: string;
  ok: boolean;
  expected?: number;
  deleted: number;
  note?: string;
}

interface R2Like {
  get(key: string): Promise<Response>;
  put(key: string, body: BodyInit, options?: Record<string, any>): Promise<void>;
  delete(key: string): Promise<void>;
}

// Collect every object-storage key that references this patient. MUST run before
// any DELETE, because the `pseudonyms` / `dicom_images` / `radiology_images`
// rows that hold the keys are themselves erased.
export async function collectObjectKeys(
  c: AppContext,
  patientId: number
): Promise<string[]> {
  const db = c.env.DB;
  const keys = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    // Ignore blanks and non-keys (http(s) URLs to an external PACS, "null",
    // "undefined" written by a broken uploader, etc.).
    if (!s || /^(https?:)?\/\//i.test(s) || s === "null" || s === "undefined") return;
    keys.add(s);
  };
  // `radiology_images` / `radiology_image_file_path_or_link` are JSON arrays of
  // object keys (written by the upload flow in lib/object-storage-web and
  // artifacts/api-server/src/routes/storage.ts), but tolerate a bare string too.
  const addJsonArray = (v: unknown) => {
    if (typeof v !== "string" || !v) return;
    const t = v.trim();
    if (t.startsWith("[")) {
      try {
        for (const item of JSON.parse(t)) add(item);
        return;
      } catch {
        /* fall through to single-value handling */
      }
    }
    add(t);
  };

  const patient = (await db
    .prepare(
      "SELECT radiology_images, radiology_image_file_path_or_link FROM patients WHERE id = ?"
    )
    .bind(patientId)
    .first<any>()) as any;
  addJsonArray(patient?.radiology_images);
  addJsonArray(patient?.radiology_image_file_path_or_link);

  for (const sql of [
    "SELECT object_key FROM dicom_images WHERE patient_id = ?",
    "SELECT object_key FROM radiology_images WHERE patient_id = ?",
    "SELECT document_object_key FROM consents WHERE patient_id = ?",
  ]) {
    const rows = await db.prepare(sql).bind(patientId).all<any>();
    for (const r of rows.results || []) {
      add(r.object_key);
      add(r.document_object_key);
    }
  }
  return [...keys];
}

// Delete collected keys from R2 (preferred) or S3/MinIO. Reports per-key results
// so the caller can tell "deleted" from "the backend was unreachable".
export async function eraseObjects(
  c: AppContext,
  keys: string[]
): Promise<{ deleted: number; failures: string[] }> {
  const bindings = c.env as unknown as Record<string, any>;
  const r2 = bindings.R2_BUCKET as R2Like | undefined;
  const s3 = getS3Config(bindings);
  if ((!r2 || typeof r2.delete !== "function") && !s3) {
    return {
      deleted: 0,
      failures: keys.map((k) => `${k}: no object-store binding configured`),
    };
  }
  let deleted = 0;
  const failures: string[] = [];
  for (const key of keys) {
    try {
      if (r2 && typeof r2.delete === "function") {
        await r2.delete(key);
        deleted++;
      } else if (s3) {
        const res = await deleteObject(s3, key);
        if (res.deleted) deleted++;
        else failures.push(`${key}: S3 DELETE returned ${res.status}`);
      }
    } catch (err) {
      failures.push(`${key}: ${(err as Error).message}`);
    }
  }
  return { deleted, failures };
}

// Anonymise (never delete) audit-trail entries that reference this patient.
// Retaining the trail is required; retaining the patient's name in it is not.
// Nulls the user FK and replaces entity_id/detail so the entry still proves the
// event happened without proving who the patient was.
export async function anonymiseAuditTrail(
  c: AppContext,
  patientId: number
): Promise<number> {
  const result = (await c.env.DB
    .prepare(
      `UPDATE audit_log
          SET user_id = NULL,
              entity = 'erased_patient',
              entity_id = NULL,
              detail = NULL
        WHERE entity = 'patient' AND entity_id = ?`
    )
    .bind(patientId)
    .run()) as any;
  return result?.meta?.changes ?? 0;
}

// Ask the Postgres api-server to erase its copy. The Worker cannot reach
// Postgres directly; the api-server owns those tables. Authenticated with the
// same shared secret the Worker already uses for internal calls
// (`INBOUND_EMAIL_SECRET`), preferring a dedicated `ERASURE_SECRET` if set.
//
// If the api-server has no such route yet (it does not — see the report), this
// returns ok:false, which propagates to a non-ok overall verdict and a
// `pending_erasure` marker. That is the intended behaviour: a half-finished
// erasure must be visible, not reported as a success.
async function eraseInPostgres(
  c: AppContext,
  patientId: number
): Promise<{ ok: boolean; deleted: number; note: string }> {
  const base = (c.env.API_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      deleted: 0,
      note: "API_BACKEND_URL is not configured; Postgres store was not reached.",
    };
  }
  const secret = (c.env as unknown as Record<string, any>).ERASURE_SECRET
    ?? c.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    return {
      ok: false,
      deleted: 0,
      note:
        "No internal erasure secret configured (ERASURE_SECRET or " +
        "INBOUND_EMAIL_SECRET); refusing to call the Postgres store unauthenticated.",
    };
  }
  try {
    const res = await fetch(`${base}/api/gdpr/erasure/${patientId}`, {
      method: "DELETE",
      headers: {
        "x-inbound-email-secret": String(secret),
        "x-erasure-secret": String(secret),
        Accept: "application/json",
      },
    });
    if (res.status === 404 || res.status === 405) {
      return {
        ok: false,
        deleted: 0,
        note:
          `The api-server has no erasure route (HTTP ${res.status}). The Postgres ` +
          "store (patients, records, record_images, notifications, audit_log.detail) " +
          "MUST be erased there manually; see the report.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        deleted: 0,
        note: `api-server erasure returned HTTP ${res.status}.`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    const deleted = Number(body?.deletedRows ?? body?.deleted ?? 0);
    // The api-server reports what it removed. If it reported nothing while
    // claiming success we cannot verify the erasure, so treat it as unverified.
    if (!Number.isFinite(deleted)) {
      return { ok: false, deleted: 0, note: "api-server returned no delete count." };
    }
    return { ok: true, deleted, note: "Postgres store erased." };
  } catch (err) {
    return {
      ok: false,
      deleted: 0,
      note: `api-server unreachable: ${(err as Error).message}`,
    };
  }
}

async function markPending(
  c: AppContext,
  patientId: number,
  requestedBy: number,
  stores: ErasureOutcome[],
  detail: unknown
): Promise<void> {
  const failed = stores.filter((s) => !s.ok);
  try {
    // Upsert by hand rather than `ON CONFLICT(patient_id)`: the table is also
    // created by schema.sql, which is owned by another agent and does not
    // declare a UNIQUE constraint on patient_id, so an ON CONFLICT target would
    // fail at runtime with "ON CONFLICT clause does not match any PRIMARY KEY
    // or UNIQUE constraint".
    const existing = (await c.env.DB
      .prepare("SELECT id, attempts FROM pending_erasure WHERE patient_id = ? LIMIT 1")
      .bind(patientId)
      .first<any>()) as any;
    const storesJson = JSON.stringify(
      failed.map((s) => ({ store: s.store, note: s.note }))
    );
    const detailJson = JSON.stringify(detail);
    if (existing?.id) {
      await c.env.DB
        .prepare(
          `UPDATE pending_erasure
              SET requested_by = ?, status = 'pending', stores = ?, detail = ?,
                  attempts = ?, updated_at = datetime('now')
            WHERE id = ?`
        )
        .bind(requestedBy, storesJson, detailJson, Number(existing.attempts ?? 1) + 1, existing.id)
        .run();
    } else {
      await c.env.DB
        .prepare(
          `INSERT INTO pending_erasure (patient_id, requested_by, status, stores, detail)
           VALUES (?, ?, 'pending', ?, ?)`
        )
        .bind(patientId, requestedBy, storesJson, detailJson)
        .run();
    }
  } catch {
    // Never let marker bookkeeping mask the original failure.
  }
}

// DELETE /api/gdpr/erasure/:patientId — admin-only cascade erasure across
// D1 + object storage + Postgres, with a per-store verdict.
gdprApp.delete("/erasure/:patientId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const patientId = parseInt(c.req.param("patientId") ?? "", 10);
  if (!Number.isInteger(patientId)) return c.json({ error: "Invalid patient id" }, 400);

  // (1) Collect object keys BEFORE dropping the pseudonym linkage.
  const objectKeys = await collectObjectKeys(c, patientId);

  // (2) D1 cascade. Counts are per-table so a partial failure is visible.
  // `pending_erasure` is included so that a re-run does not leave a stale
  // "pending" marker behind after a successful retry.
  const tables = [
    "consents",
    "diagnosis_codes",
    "dicom_images",
    "pseudonyms",
    "pending_erasure",
  ];
  const d1Counts: Record<string, number> = {};
  const d1Expected: Record<string, number> = {};
  for (const t of tables) {
    const row = (await c.env.DB
      .prepare(`SELECT COUNT(*) as n FROM ${t} WHERE patient_id = ?`)
      .bind(patientId)
      .first<any>()) as any;
    d1Expected[t] = Number(row?.n ?? 0);
  }
  for (const t of tables) {
    const r = (await c.env.DB
      .prepare(`DELETE FROM ${t} WHERE patient_id = ?`)
      .bind(patientId)
      .run()) as any;
    d1Counts[t] = r?.meta?.changes ?? 0;
  }
  const d1Deleted = Object.values(d1Counts).reduce((a, b) => a + b, 0);
  const d1ExpectedTotal = Object.values(d1Expected).reduce((a, b) => a + b, 0);
  // A DELETE that removed fewer rows than SELECT counted is a real anomaly
  // (concurrent write, trigger, D1 partial failure) and must not be reported
  // as a clean erasure.
  const d1Ok = d1Deleted === d1ExpectedTotal;

  // (3) Object storage.
  const objects = await eraseObjects(c, objectKeys);
  const objectsOk = objects.failures.length === 0;

  // (4) Postgres (via the api-server).
  const postgres = await eraseInPostgres(c, patientId);

  // (5) Audit trail: anonymised, retained.
  const auditRows = await anonymiseAuditTrail(c, patientId);

  const outcomes: ErasureOutcome[] = [
    {
      store: "d1",
      ok: d1Ok,
      expected: d1ExpectedTotal,
      deleted: d1Deleted,
      note: d1Ok ? undefined : "D1 delete count did not match the pre-delete count.",
    },
    {
      store: "object_storage",
      ok: objectsOk,
      expected: objectKeys.length,
      deleted: objects.deleted,
      note: objectsOk ? undefined : objects.failures.slice(0, 10).join("; "),
    },
    {
      store: "postgres",
      ok: postgres.ok,
      deleted: postgres.deleted,
      note: postgres.note,
    },
    {
      store: "audit_log",
      ok: true,
      deleted: auditRows,
      note: `${auditRows} audit entr${
        auditRows === 1 ? "y" : "ies"
      } anonymised (retained, identifiers scrubbed).`,
    },
  ];

  const ok = outcomes.every((o) => o.ok);
  if (!ok) {
    await markPending(c, patientId, auth.user.id, outcomes, {
      objectKeys,
      d1Counts,
      d1Expected,
    });
  } else {
    // Fully verified: clear any stale marker so /pending does not keep
    // reporting a resolved case.
    try {
      await c.env.DB
        .prepare("DELETE FROM pending_erasure WHERE patient_id = ?")
        .bind(patientId)
        .run();
    } catch {
      /* ignore */
    }
  }

  await writeAudit(c, {
    userId: auth.user.id,
    action: ok ? "gdpr.erasure" : "gdpr.erasure.partial",
    entity: "patient",
    entityId: patientId,
    detail: { ok, stores: outcomes, objectKeysFound: objectKeys.length },
  });

  return c.json(
    {
      ok,
      patientId,
      counts: {
        d1: d1Counts,
        d1Total: d1Deleted,
        d1ExpectedTotal,
        objectStorage: objects.deleted,
        objectStorageExpected: objectKeys.length,
        objectStorageFailures: objects.failures,
        postgres: postgres.deleted,
        auditRowsAnonymised: auditRows,
      },
      stores: outcomes,
      ...(ok
        ? {}
        : {
            error:
              "Partial erasure: at least one store was not cleared. A " +
              "pending_erasure marker was written; re-run " +
              "DELETE /api/gdpr/erasure/:patientId after fixing the cause. " +
              "Do NOT report this erasure to the data subject as complete.",
          }),
    },
    ok ? 200 : 500
  );
});

// GET /api/gdpr/pending — admin-only list of incomplete/retried erasures
gdprApp.get("/pending", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const rows = await c.env.DB
    .prepare(
      `SELECT patient_id, requested_by, status, stores, detail, attempts,
              created_at, updated_at
         FROM pending_erasure WHERE status = 'pending'
        ORDER BY updated_at DESC LIMIT 200`
    )
    .all<any>();
  return c.json({
    pending: (rows.results || []).map((r: any) => ({
      patientId: r.patient_id,
      requestedBy: r.requested_by,
      status: r.status,
      attempts: r.attempts,
      failedStores: safeJson(r.stores),
      detail: safeJson(r.detail),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// GET /api/gdpr/retention — admin-only list of erasure candidates
// (withdrawn consents past the retention window, in days).
gdprApp.get("/retention", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const days = parseInt(c.req.query("days") ?? "365", 10) || 365;
  const rows = await c.env.DB
    .prepare(
      `SELECT patient_id, COUNT(*) as cnt, MIN(withdrawn_at) as earliest
       FROM consents WHERE status = 'withdrawn' AND withdrawn_at IS NOT NULL
       AND datetime(withdrawn_at) < datetime('now', ?) GROUP BY patient_id`
    )
    .bind(`-${days} days`)
    .all<any>();
  return c.json({
    retentionDays: days,
    candidates: (rows.results || []).map((r: any) => ({
      patientId: r.patient_id,
      consentCount: r.cnt,
      earliestWithdrawal: r.earliest,
    })),
  });
});

function safeJson(v: any): any {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}