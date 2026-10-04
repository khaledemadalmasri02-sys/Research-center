import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import {
  getAuthUser,
  writeAudit,
  loadScopedRecord,
  type AuthUser,
} from "../lib/security";

// ---- Pure FHIR / HL7 builders (exported for unit tests) ----

// Map our record-data sex field to a FHIR administrative gender.
export function fhirGender(sex?: string): string {
  const s = (sex || "").toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  if (s === "other") return "other";
  return "unknown";
}

export interface FhirInput {
  id: number;
  data: Record<string, any>;
  codes?: Array<{ code_system: string; code: string; display?: string }>;
}

// Build a FHIR R4 Bundle (collection) from a record + its coded diagnoses.
export function buildFhirBundle(rec: FhirInput): any {
  const data = rec.data || {};
  const entry: any[] = [];

  const patient: any = {
    resourceType: "Patient",
    id: String(data.patientId ?? rec.id),
    name: data.patientName ? [{ text: String(data.patientName) }] : undefined,
    gender: fhirGender(data.sex),
  };
  if (data.age != null) patient.extension = [{ url: "age", valueInteger: Number(data.age) }];
  entry.push({ resource: patient });

  const SKIP = new Set(["patientId", "patientName", "sex", "age", "diagnosis"]);
  for (const [key, value] of Object.entries(data)) {
    if (SKIP.has(key) || value == null || value === "") continue;
    entry.push({
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { text: key },
        subject: { reference: `Patient/${patient.id}` },
        valueString: String(value),
      },
    });
  }

  const resultRefs: any[] = [];
  for (const c of rec.codes || []) {
    const ref = `DiagnosticReport/${rec.id}-${c.code_system}-${c.code}`;
    resultRefs.push({ reference: ref });
    entry.push({
      resource: {
        resourceType: "DiagnosticReport",
        id: `${rec.id}-${c.code_system}-${c.code}`,
        status: "final",
        code: { coding: [{ system: c.code_system, code: c.code, display: c.display }] },
        subject: { reference: `Patient/${patient.id}` },
      },
    });
  }

  if (resultRefs.length > 0) {
    entry[0].resource = patient; // ensure first
  }

  return { resourceType: "Bundle", type: "collection", entry };
}

// Escape a string for safe inclusion inside an HL7 v2 field.
export function hl7Escape(value: any): string {
  return String(value ?? "")
    .replace(/\\/g, "\\E\\")
    .replace(/\|/g, "\\F\\")
    .replace(/\^/g, "\\S\\")
    .replace(/&/g, "\\T\\")
    .replace(/~/g, "\\R\\")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}

// Build a minimal HL7 v2 ORU^R01 message (MSH / PID / OBX) from a record.
export function buildHl7V2(rec: FhirInput, msgId = "1"): string {
  const data = rec.data || {};
  const ts = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const segs: string[] = [];
  segs.push(
    [
      "MSH",
      "^~\\&",
      "MedResearch",
      "Site",
      "Receiver",
      "App",
      ts,
      "",
      "ORU^R01",
      msgId,
      "P",
      "2.5",
    ].join("|")
  );
  segs.push(
    [
      "PID",
      "1",
      "",
      hl7Escape(data.patientId ?? rec.id),
      "",
      hl7Escape(data.patientName),
      "",
      hl7Escape(data.age ?? ""),
      hl7Escape(data.sex ?? ""),
    ].join("|")
  );
  let obx = 1;
  const SKIP = new Set(["patientId", "patientName", "sex", "age", "diagnosis"]);
  for (const [key, value] of Object.entries(data)) {
    if (SKIP.has(key) || value == null || value === "") continue;
    segs.push(
      [
        "OBX",
        String(obx++),
        "ST",
        hl7Escape(key),
        "",
        hl7Escape(value),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        hl7Escape(rec.id),
      ].join("|")
    );
  }
  return segs.join("\r");
}

// ---- Route ----

export const exportApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// IDOR FIX: this used to be `SELECT * FROM records WHERE id = ?` with no owner
// check, then `buildFhirBundle` emitted `Patient.name[].text = data.patientName`
// and `buildHl7V2` wrote PID-5 — i.e. `GET /api/export/fhir?recordId=1..N` walked
// the whole `records` table and exported any authenticated user's patient names
// and demographics as standards-compliant FHIR/HL7. Contrast the Postgres
// api-server's `records.ts`, which does check ownership.
//
// `loadScopedRecord` binds `user_id = ?` in SQL for non-admins, so an
// unauthorised record is simply not found (404, not 403 — no existence oracle).
async function loadRecord(c: AppContext, recordId: number, user: AuthUser) {
  const rec = await loadScopedRecord(c, recordId, user);
  if (!rec) return null;
  const codesRows = await c.env.DB
    .prepare("SELECT code_system, code, display FROM diagnosis_codes WHERE record_id = ?")
    .bind(recordId)
    .all<any>();
  const codes = (codesRows.results || []).map((r: any) => ({
    code_system: r.code_system,
    code: r.code,
    display: r.display,
  }));
  return { id: rec.id, data: rec.data, codes };
}

exportApp.get("/fhir", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const recordId = parseInt(c.req.query("recordId") ?? "", 10);
  if (!Number.isInteger(recordId)) return c.json({ error: "recordId is required." }, 400);
  const rec = await loadRecord(c, recordId, auth.user);
  if (!rec) return c.json({ error: "Not found" }, 404);
  const bundle = buildFhirBundle(rec);
  await writeAudit(c, { userId: auth.user.id, action: "export.fhir", entity: "record", entityId: recordId });
  return c.json(bundle, 200, { "Cache-Control": "private, no-store" });
});

exportApp.get("/hl7", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const recordId = parseInt(c.req.query("recordId") ?? "", 10);
  if (!Number.isInteger(recordId)) return c.json({ error: "recordId is required." }, 400);
  const rec = await loadRecord(c, recordId, auth.user);
  if (!rec) return c.json({ error: "Not found" }, 404);
  const msg = buildHl7V2(rec);
  await writeAudit(c, { userId: auth.user.id, action: "export.hl7", entity: "record", entityId: recordId });
  return c.text(msg, 200, {
    "Content-Type": "application/hl7-v2",
    "Cache-Control": "private, no-store",
  });
});
