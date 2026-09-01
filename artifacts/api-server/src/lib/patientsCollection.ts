import { pool, db, patientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// The "Patients" collection is now a per-user record definition: each user gets
// their own Patients collection that mirrors the patients they own. This keeps
// the patient directory private per admin instead of a single shared collection.

export const PATIENTS_DEFINITION_NAME = "Patients";

export const PATIENTS_DEFINITION_FIELDS = [
  { key: "collectionName", label: "Collection Name", type: "text" },
  { key: "collectionDate", label: "Collection Date", type: "date" },
  { key: "collectionType", label: "Collection Type", type: "select", options: ["Normal", "Abnormal", "Suspicious"] },
  { key: "patientId", label: "Patient ID", type: "text", required: true },
  { key: "patientName", label: "Patient Name", type: "text", required: true },
  { key: "age", label: "Age", type: "number" },
  { key: "sex", label: "Sex", type: "select", options: ["Male", "Female", "Other"] },
  { key: "dateOfVisit", label: "Date of Visit", type: "date" },
  { key: "chiefComplaint", label: "Chief Complaint", type: "textarea" },
  { key: "vitalSigns", label: "Vital Signs", type: "textarea" },
  { key: "historyTrauma", label: "History of Trauma", type: "textarea" },
  { key: "mechanismOfInjuryAndLocalisation", label: "Mechanism of Injury", type: "textarea" },
  { key: "signsAndSymptomsTrauma", label: "Signs & Symptoms (Trauma)", type: "textarea" },
  { key: "historyMedical", label: "Medical History", type: "textarea" },
  { key: "signsAndSymptomsMedical", label: "Signs & Symptoms (Medical)", type: "textarea" },
  { key: "riskFactors", label: "Risk Factors", type: "textarea" },
  { key: "provisionalDiagnosis", label: "Provisional Diagnosis", type: "textarea" },
  { key: "radiologyImages", label: "Radiology Images", type: "image" },
  { key: "emergencyReport", label: "Emergency Report", type: "textarea" },
  { key: "aiPredictionOutput", label: "AI Prediction Output", type: "textarea" },
  { key: "finalConfirmedDiagnosisAr", label: "Final Diagnosis (AR)", type: "textarea" },
  { key: "finalConfirmedDiagnosis", label: "Final Diagnosis", type: "textarea" },
  { key: "notes", label: "Notes", type: "textarea" },
];

// Map physical patients columns -> Patients field keys.
export const PATIENT_COLUMN_MAP: Array<[string, string]> = [
  ["collection_name", "collectionName"],
  ["collection_date", "collectionDate"],
  ["collection_type", "collectionType"],
  ["patient_id", "patientId"],
  ["patient_name", "patientName"],
  ["age", "age"],
  ["sex", "sex"],
  ["date_of_visit", "dateOfVisit"],
  ["chief_complaint", "chiefComplaint"],
  ["vital_signs", "vitalSigns"],
  ["history_trauma", "historyTrauma"],
  ["mechanism_of_injury_and_localisation", "mechanismOfInjuryAndLocalisation"],
  ["signs_and_symptoms_trauma", "signsAndSymptomsTrauma"],
  ["history_medical", "historyMedical"],
  ["signs_and_symptoms_medical", "signsAndSymptomsMedical"],
  ["risk_factors", "riskFactors"],
  ["provisional_diagnosis", "provisionalDiagnosis"],
  ["radiology_image_file_path_or_link", "radiologyImageFilePathOrLink"],
  ["radiology_images", "radiologyImages"],
  ["emergency_report", "emergencyReport"],
  ["ai_prediction_output", "aiPredictionOutput"],
  ["final_confirmed_diagnosis_ar", "finalConfirmedDiagnosisAr"],
  ["final_confirmed_diagnosis", "finalConfirmedDiagnosis"],
  ["notes", "notes"],
];

function patientRowToData(p: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [col, key] of PATIENT_COLUMN_MAP) {
    if (p[col] === undefined || p[col] === null) continue;
    data[key] = p[col];
  }
  return data;
}

// Returns the id of the current user's Patients collection, creating and seeding
// it from their own patients on first use.
export async function ensureUserPatientsDefinition(userId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT "id" FROM "record_definitions" WHERE "name" = $1 AND "user_id" = $2 LIMIT 1`,
    [PATIENTS_DEFINITION_NAME, userId],
  );
  if (rows.length > 0) return Number(rows[0].id);

  const ins = await pool.query(
    `INSERT INTO "record_definitions" ("user_id","name","fields","shared","isActive","isDefault","created_at","updated_at")
     VALUES ($1,$2,$3,false,true,true,now(),now()) RETURNING "id"`,
    [userId, PATIENTS_DEFINITION_NAME, JSON.stringify(PATIENTS_DEFINITION_FIELDS)],
  );
  const defId = Number(ins.rows[0].id);

  const { rows: patients } = await pool.query(
    `SELECT * FROM "patients" WHERE "user_id" = $1 ORDER BY "id"`,
    [userId],
  );
  for (const p of patients) {
    await pool.query(
      `INSERT INTO "records" ("user_id","definition_id","data","created_at","updated_at")
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, defId, JSON.stringify(patientRowToData(p)), p.created_at ?? new Date(), p.updated_at ?? new Date()],
    );
  }
  return defId;
}

// Keeps the user's Patients collection in sync with the patients they own by
// upserting (matching on patientId) on every read, so newly created/updated
// patients always show up in the directory.
export async function syncPatientsToCollection(userId: number): Promise<number> {
  const defId = await ensureUserPatientsDefinition(userId);
  const { rows: patients } = await pool.query(
    `SELECT * FROM "patients" WHERE "user_id" = $1 ORDER BY "id"`,
    [userId],
  );
  for (const p of patients) {
    const data = patientRowToData(p);
    const pid = (p.patient_id as string) ?? (data.patientId as string);
    const existing = await pool.query(
      `SELECT "id" FROM "records" WHERE "definition_id" = $1 AND "data"->>'patientId' = $2 LIMIT 1`,
      [defId, pid],
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE "records" SET "data" = $1, "updated_at" = now() WHERE "id" = $2`,
        [JSON.stringify(data), existing.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO "records" ("user_id","definition_id","data","created_at","updated_at")
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, defId, JSON.stringify(data), p.created_at ?? new Date(), p.updated_at ?? new Date()],
      );
    }
  }
  return defId;
}
