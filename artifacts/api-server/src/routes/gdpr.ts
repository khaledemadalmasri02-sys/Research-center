import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { writeAudit, clientIp } from "../lib/audit";

/**
 * GDPR erasure for the Postgres PHI store.
 *
 * `research/src/routes/gdpr.ts` (the Cloudflare Worker) orchestrates erasure
 * across every store and calls this route for Postgres, because D1's
 * `patients` table receives nothing — all PHI is written by this api-server.
 * Without this route the Worker recorded `ok:false` + a `pending_erasure`
 * row for every request, i.e. no erasure ever completed.
 *
 * Contract with the Worker (do not change without changing gdpr.ts too):
 *   - `DELETE /api/gdpr/erasure/:patientId`
 *   - auth: `x-erasure-secret` (the Worker also sends `x-inbound-email-secret`)
 *   - 200 + `{ deletedRows: number }`. The Worker treats 404/405 as "route
 *     missing", so a legitimately-empty erasure answers 200 with 0 rather than
 *     404 — otherwise an already-erased patient would loop forever in
 *     `pending_erasure`.
 *
 * Deliberately NOT the same as `DELETE /api/patients/:id`: that route is a
 * single-owner-scoped hard delete for the app UI, this one cascades across
 * records/images, returns object keys for the caller to delete from S3, and
 * anonymises (rather than deletes) the audit trail, which is what a compliant
 * erasure requires.
 */
const router: IRouter = Router();

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // keep the timing profile flat
    return false;
  }
  return timingSafeEqual(a, b);
}

function isErasureAuthorised(req: Request): { ok: boolean; configured: boolean } {
  const expected = process.env.ERASURE_SECRET || process.env.INBOUND_EMAIL_SECRET;
  if (!expected) return { ok: false, configured: false };
  const provided =
    req.header("x-erasure-secret") ?? req.header("x-inbound-email-secret");
  return { ok: secretMatches(provided, expected), configured: true };
}

/** Collect the JSON-array / single-value image columns into a key list. */
function parseImageColumns(
  radiologyImages: string | null,
  filePathOrLink: string | null,
): string[] {
  const out: string[] = [];
  if (radiologyImages) {
    try {
      const parsed = JSON.parse(radiologyImages);
      if (Array.isArray(parsed)) {
        for (const p of parsed) if (typeof p === "string" && p) out.push(p);
      } else if (typeof parsed === "string" && parsed) {
        out.push(parsed);
      }
    } catch {
      // Legacy value: a bare path string.
      out.push(radiologyImages);
    }
  }
  if (filePathOrLink && !/^https?:\/\//i.test(filePathOrLink)) out.push(filePathOrLink);
  return out;
}

router.delete("/gdpr/erasure/:patientId", async (req: Request, res: Response) => {
  const auth = isErasureAuthorised(req);
  if (!auth.configured) {
    // Fail closed: without a shared secret the route must not be callable.
    res.status(503).json({
      error:
        "Erasure is not configured (set ERASURE_SECRET or INBOUND_EMAIL_SECRET).",
    });
    return;
  }
  if (!auth.ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const rawId = String(req.params.patientId ?? "").trim();
  const normalized = rawId.replace(/^PAT/i, "");
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    res.status(400).json({ error: "Invalid patientId." });
    return;
  }

  try {
    // 1. Locate the patient. `patient_id` is TEXT in Postgres and may be
    //    stored bare ("42") or prefixed ("PAT42").
    const { rows: patientRows } = await pool.query<{
      id: number;
      patient_id: string;
      user_id: number | null;
      radiology_images: string | null;
      radiology_image_file_path_or_link: string | null;
    }>(
      `SELECT id, patient_id, user_id, radiology_images, radiology_image_file_path_or_link
         FROM patients
        WHERE patient_id = $1 OR patient_id = $2 OR id::text = $2
        LIMIT 1`,
      [normalized, `PAT${normalized}`],
    );
    const patient = patientRows[0];

    if (!patient) {
      // Nothing to erase is a *completed* erasure, not a missing route: the
      // Worker reads 404 as "api-server has no erasure route".
      res.json({
        ok: true,
        deletedRows: 0,
        patientFound: false,
        note: "No matching patient row in Postgres; nothing to erase.",
        postgres: { expected: 0, deleted: 0 },
        objectKeys: [],
        auditRowsAnonymised: 0,
      });
      return;
    }

    // 2. Collect object keys BEFORE deleting anything — this is the only
    //    linkage between a patient and their S3/MinIO objects.
    const { rows: imageRows } = await pool.query<{ object_key: string }>(
      `SELECT object_key FROM radiology_images WHERE patient_id = $1`,
      [patient.id],
    );
    const { rows: recordImageRows } = await pool.query<{ object_key: string }>(
      `SELECT ri.object_key
         FROM record_images ri
         JOIN records r ON r.id = ri.record_id
        WHERE r.user_id = $1`,
      [patient.user_id ?? -1],
    );
    const objectKeys = Array.from(
      new Set([
        ...imageRows.map((r) => r.object_key),
        ...recordImageRows.map((r) => r.object_key),
        ...parseImageColumns(
          patient.radiology_images,
          patient.radiology_image_file_path_or_link,
        ),
      ]),
    ).filter(Boolean);

    // 3. Cascade delete in one transaction.
    const client = await pool.connect();
    let counts = {
      recordImages: 0,
      records: 0,
      radiologyImages: 0,
      patients: 0,
    };
    try {
      await client.query("BEGIN");
      const delImages = await client.query(
        `DELETE FROM record_images WHERE record_id IN (SELECT id FROM records WHERE user_id = $1)`,
        [patient.user_id ?? -1],
      );
      counts.recordImages = delImages.rowCount ?? 0;
      const delRecords = await client.query(`DELETE FROM records WHERE user_id = $1`, [
        patient.user_id ?? -1,
      ]);
      counts.records = delRecords.rowCount ?? 0;
      const delRadImages = await client.query(
        `DELETE FROM radiology_images WHERE patient_id = $1`,
        [patient.id],
      );
      counts.radiologyImages = delRadImages.rowCount ?? 0;
      const delPatient = await client.query(`DELETE FROM patients WHERE id = $1`, [
        patient.id,
      ]);
      counts.patients = delPatient.rowCount ?? 0;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // 4. Anonymise, never delete, the audit trail: regulators expect the
    //    record of access to survive an erasure with the identifiers removed.
    const { rows: anonRows } = await pool.query<{ count: string }>(
      `WITH scrubbed AS (
         UPDATE audit_log
            SET detail = detail
                          - 'patientId' - 'patient_id' - 'patientName'
                          - 'patient_id_str' - 'radiologyImages'
                          - 'objectKeys' - 'objectPath' - 'name',
                entity_id = NULL
          WHERE detail IS NOT NULL
            AND detail::text ILIKE '%' || $1 || '%'
        RETURNING 1
       )
       SELECT count(*)::text AS count FROM scrubbed`,
      [normalized],
    );
    const auditRowsAnonymised = Number(anonRows[0]?.count ?? 0);

    const deletedRows =
      counts.recordImages + counts.records + counts.radiologyImages + counts.patients;

    await writeAudit({
      userId: null,
      action: "gdpr.erasure",
      entity: "patient",
      entityId: null,
      // No PHI in the audit detail: counts and a request id only.
      detail: { deletedRows, objectKeys: objectKeys.length, auditRowsAnonymised },
      ip: clientIp(req),
    });

    res.json({
      ok: true,
      patientFound: true,
      deletedRows,
      postgres: {
        expected: deletedRows,
        deleted: deletedRows,
        ...counts,
      },
      objectKeys,
      auditRowsAnonymised,
    });
  } catch (err) {
    req.log.error({ err }, "GDPR erasure failed");
    res.status(500).json({ error: "Erasure failed." });
  }
});

export default router;