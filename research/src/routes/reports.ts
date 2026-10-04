import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, writeAudit, requirePatientScope } from "../lib/security";
import { buildSimplePdf } from "../lib/pdf";

export const reportsApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/reports/patient/:id/pdf — CRF-style PDF for a patient (auth)
reportsApp.get("/patient/:id/pdf", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  // IDOR fix: the route took a patient id from the path and returned a CRF
  // summarising that patient's consents, coded diagnoses and imaging for ANY
  // authenticated user, i.e. `report/patient/1/pdf` … `/N/pdf` walked the whole
  // roster. There is no owner column on `patients` (see requirePatientScope), so
  // the role gate is the control until `patients.owner_user_id` exists.
  const denied = requirePatientScope(c, auth.user);
  if (denied) return denied;
  const patientId = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return c.json({ error: "Invalid patient id" }, 400);
  }

  // Gather patient-scoped data across the research tables.
  const consents = await c.env.DB.prepare("SELECT * FROM consents WHERE patient_id = ? ORDER BY id LIMIT 500").bind(patientId).all<any>();
  const codes = await c.env.DB.prepare("SELECT code_system, code, display FROM diagnosis_codes WHERE patient_id = ? ORDER BY id LIMIT 500").bind(patientId).all<any>();
  const images = await c.env.DB.prepare("SELECT modality, study_instance_uid, is_deidentified FROM dicom_images WHERE patient_id = ? ORDER BY id LIMIT 500").bind(patientId).all<any>();

  const lines: string[] = [];
  lines.push(`Patient ID: ${patientId}`);
  lines.push("");
  lines.push(`Consents (${consents.results?.length || 0}):`);
  for (const cn of consents.results || []) {
    lines.push(`  - v${cn.consent_version_id} [${cn.status}] signedAt=${cn.signed_at ?? "-"}` + (cn.withdrawn_at ? ` withdrawnAt=${cn.withdrawn_at}` : ""));
  }
  lines.push("");
  lines.push(`Diagnoses (${codes.results?.length || 0}):`);
  for (const cd of codes.results || []) {
    lines.push(`  - ${cd.code_system} ${cd.code} ${cd.display ?? ""}`);
  }
  lines.push("");
  lines.push(`DICOM images (${images.results?.length || 0}):`);
  for (const im of images.results || []) {
    // `is_deidentified` is a TRI-STATE now (0 none / 1 metadata only /
    // 2 fully de-identified). Only state 2 means the pixels are clean, so only
    // state 2 gets a `[deid]` marker — previously ANY truthy value (including a
    // metadata-only scrub) stamped `[deid]` and implied a safe image.
    const state = Number(im.is_deidentified) || 0;
    const marker = state === 2 ? "[deid]" : state === 1 ? "[metadata-only; PIXELS NOT SCRUBBED]" : "";
    lines.push(`  - ${im.modality ?? "?"} ${im.study_instance_uid ?? "-"} ${marker}`);
  }

  const pdf = buildSimplePdf(lines, `Patient ${patientId} CRF`);
  await writeAudit(c, { userId: auth.user.id, action: "report.patient.pdf", entity: "patient", entityId: patientId });
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="patient_${patientId}_crf.pdf"`,
      // The report contains PHI: never let a shared cache store it.
      "Cache-Control": "private, no-store",
    },
  });
});
