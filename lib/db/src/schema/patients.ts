import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  collectionName: text("collection_name"),
  collectionDate: text("collection_date"),
  collectionType: text("collection_type"), // Normal | Abnormal | Suspicious
  patientId: text("patient_id").notNull(),
  patientName: text("patient_name").notNull(),
  age: integer("age"),
  sex: text("sex"),
  dateOfVisit: text("date_of_visit"),
  chiefComplaint: text("chief_complaint"),
  vitalSigns: text("vital_signs"),
  historyTrauma: text("history_trauma"),
  mechanismOfInjuryAndLocalisation: text("mechanism_of_injury_and_localisation"),
  signsAndSymptomsTrauma: text("signs_and_symptoms_trauma"),
  historyMedical: text("history_medical"),
  signsAndSymptomsMedical: text("signs_and_symptoms_medical"),
  riskFactors: text("risk_factors"),
  provisionalDiagnosis: text("provisional_diagnosis"),
  radiologyImageFilePathOrLink: text("radiology_image_file_path_or_link"),
  radiologyImages: text("radiology_images"), // JSON array of stored object paths
  emergencyReport: text("emergency_report"),
  aiPredictionOutput: text("ai_prediction_output"),
  finalConfirmedDiagnosisAr: text("final_confirmed_diagnosis_ar"),
  finalConfirmedDiagnosis: text("final_confirmed_diagnosis"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
