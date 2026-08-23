import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, isAdmin, writeAudit } from "../lib/security";
import { buildSimplePdf } from "../lib/pdf";

export const reportsApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/reports/patient/:id/pdf — CRF-style PDF for a patient (auth)
reportsApp.get("/patient/:id/pdf", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const patientId = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(patientId)) return c.json({ error: "Invalid patient id" }, 400);

  // Gather patient-scoped data across the research tables.
  const consents = await c.env.DB.prepare("SELECT * FROM consents WHERE patient_id = ? ORDER BY id").bind(patientId).all<any>();
  const codes = await c.env.DB.prepare("SELECT code_system, code, display FROM diagnosis_codes WHERE patient_id = ? ORDER BY id").bind(patientId).all<any>();
  const images = await c.env.DB.prepare("SELECT modality, study_instance_uid, is_deidentified FROM dicom_images WHERE patient_id = ? ORDER BY id").bind(patientId).all<any>();

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
    lines.push(`  - ${im.modality ?? "?"} ${im.study_instance_uid ?? "-"} ${im.is_deidentified ? "[deid]" : ""}`);
  }

  const pdf = buildSimplePdf(lines, `Patient ${patientId} CRF`);
  await writeAudit(c, { userId: auth.user.id, action: "report.patient.pdf", entity: "patient", entityId: patientId });
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="patient_${patientId}_crf.pdf"`,
    },
  });
});
