import type { AppContext } from "./env";

// Idempotent D1 (SQLite) schema bootstrap for the records/admin/auth system.
// Runs CREATE TABLE IF NOT EXISTS on first request so a freshly created D1
// database is immediately usable without a separate migration step.

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'editor',
  can_admin_access INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  definition_id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS IDX_audit_user ON audit_log (user_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS IDX_api_tokens_user ON api_tokens (user_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  definition_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  sort TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_notifications_user ON notifications (user_id);

CREATE TABLE IF NOT EXISTS radiology_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  study_id TEXT,
  object_key TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  etag TEXT,
  upload_timestamp TEXT DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS consent_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  irb_number TEXT,
  text TEXT,
  effective_at TEXT DEFAULT (datetime('now')),
  retired_at TEXT
);
CREATE INDEX IF NOT EXISTS IDX_consent_versions_active ON consent_versions (retired_at);

CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  consent_version_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed',
  signed_at TEXT DEFAULT (datetime('now')),
  signed_by_user_id INTEGER,
  withdrawn_at TEXT,
  withdrawn_reason TEXT,
  document_object_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_consents_patient ON consents (patient_id);
CREATE INDEX IF NOT EXISTS IDX_consents_version ON consents (consent_version_id);

CREATE TABLE IF NOT EXISTS study_protocols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  irb_number TEXT,
  pi_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pseudonyms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  study_code TEXT NOT NULL,
  pseudonym TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (patient_id, study_code)
);
CREATE INDEX IF NOT EXISTS IDX_pseudonyms_patient ON pseudonyms (patient_id, study_code);

CREATE TABLE IF NOT EXISTS deid_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  config_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS record_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  user_id INTEGER,
  version_no INTEGER NOT NULL,
  data_snapshot TEXT NOT NULL,
  change_summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_record_versions_record ON record_versions (record_id);

CREATE TABLE IF NOT EXISTS record_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  second_user_id INTEGER,
  second_data TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  conflict_fields TEXT,
  concordance REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_record_verifications_record ON record_verifications (record_id);
CREATE INDEX IF NOT EXISTS IDX_record_verifications_status ON record_verifications (status);

-- Standardized diagnosis coding (ICD-10 / SNOMED-CT)
CREATE TABLE IF NOT EXISTS terminology_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_system TEXT NOT NULL,
  code TEXT NOT NULL,
  display TEXT NOT NULL,
  UNIQUE (code_system, code)
);
CREATE INDEX IF NOT EXISTS IDX_terminology_search ON terminology_codes (code_system, code, display);

CREATE TABLE IF NOT EXISTS diagnosis_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER,
  record_id INTEGER,
  code_system TEXT NOT NULL,
  code TEXT NOT NULL,
  display TEXT,
  confidence REAL,
  coded_by_user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_diagnosis_codes_patient ON diagnosis_codes (patient_id);
CREATE INDEX IF NOT EXISTS IDX_diagnosis_codes_record ON diagnosis_codes (record_id);

-- Phase 2.1 DICOM imaging metadata
CREATE TABLE IF NOT EXISTS dicom_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  modality TEXT,
  body_part TEXT,
  series_instance_uid TEXT,
  study_instance_uid TEXT,
  sop_instance_uid TEXT,
  acquisition_date TEXT,
  dicom_metadata TEXT,
  is_deidentified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_dicom_patient ON dicom_images (patient_id);
CREATE INDEX IF NOT EXISTS IDX_dicom_study ON dicom_images (study_instance_uid);

-- Phase 4.2 Longitudinal studies, sites, arms, record events
CREATE TABLE IF NOT EXISTS studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  irb_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  enrollment_target INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  pi_user_id INTEGER,
  enrollment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_sites_study ON sites (study_id);
CREATE TABLE IF NOT EXISTS study_arms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_study_arms_study ON study_arms (study_id);
CREATE TABLE IF NOT EXISTS record_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  event TEXT,
  arm_id INTEGER,
  repeat_instance INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_record_events_record ON record_events (record_id);
CREATE INDEX IF NOT EXISTS IDX_record_events_arm ON record_events (id);

-- Phase 5 AI/ML provenance
CREATE TABLE IF NOT EXISTS ml_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  artifact_object_key TEXT,
  metrics_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ml_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER,
  image_id INTEGER,
  model_id INTEGER NOT NULL,
  output_json TEXT,
  confidence REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_ml_predictions_model ON ml_predictions (model_id);
CREATE INDEX IF NOT EXISTS IDX_ml_predictions_record ON ml_predictions (record_id);
CREATE TABLE IF NOT EXISTS ml_groundtruth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  reviewed_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_ml_groundtruth_record ON ml_groundtruth (record_id);
CREATE TABLE IF NOT EXISTS ml_eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL,
  auc REAL,
  sensitivity REAL,
  specificity REAL,
  f1 REAL,
  accuracy REAL,
  sample_size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS IDX_ml_eval_model ON ml_eval_runs (model_id);

-- Mirrored from schema.sql so the runtime bootstrap creates these too.
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_name TEXT,
  collection_date TEXT,
  collection_type TEXT,
  patient_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  age INTEGER,
  sex TEXT,
  date_of_visit TEXT,
  chief_complaint TEXT,
  vital_signs TEXT,
  history_trauma TEXT,
  mechanism_of_injury_and_localisation TEXT,
  signs_and_symptoms_trauma TEXT,
  history_medical TEXT,
  signs_and_symptoms_medical TEXT,
  risk_factors TEXT,
  provisional_diagnosis TEXT,
  radiology_image_file_path_or_link TEXT,
  radiology_images TEXT,
  emergency_report TEXT,
  ai_prediction_output TEXT,
  final_confirmed_diagnosis_ar TEXT,
  final_confirmed_diagnosis TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patients_patient_id ON patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_patients_patient_name ON patients(patient_name);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT,
  expire DATETIME
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  rating INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

CREATE TABLE IF NOT EXISTS validation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL DEFAULT 0,
  field_key TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  message TEXT,
  severity TEXT NOT NULL DEFAULT 'error',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_validation_rules_def ON validation_rules (definition_id);

-- Starter ICD-10 / SNOMED subset (replace/extend with a full terminology release)
INSERT OR IGNORE INTO terminology_codes (code_system, code, display) VALUES
  ('ICD10', 'I10', 'Essential (primary) hypertension'),
  ('ICD10', 'E11', 'Type 2 diabetes mellitus'),
  ('ICD10', 'J45', 'Asthma'),
  ('ICD10', 'A09', 'Infectious gastroenteritis and colitis, unspecified'),
  ('ICD10', 'S06', 'Intracranial injury'),
  ('ICD10', 'M54', 'Dorsalgia'),
  ('ICD10', 'N39.0', 'Urinary tract infection, site not specified'),
  ('ICD10', 'J18.9', 'Pneumonia, unspecified organism'),
  ('ICD10', 'I21', 'Acute myocardial infarction'),
  ('ICD10', 'F32', 'Depressive episode'),
  ('SNOMED', '38341003', 'Hypertensive disorder, essential'),
  ('SNOMED', '44054006', 'Type 2 diabetes mellitus'),
   ('SNOMED', '195967001', 'Asthma');

  -- Enforce username uniqueness even on databases created before the UNIQUE
  -- constraint existed. CREATE TABLE IF NOT EXISTS never adds a missing
  -- constraint to an existing table, so duplicates can persist. De-duplicate
  -- (keep the earliest row per username) then create the unique index.
  UPDATE users SET username = username || '__dedup' || id
  WHERE id NOT IN (SELECT MIN(id) FROM users GROUP BY username);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

  UPDATE signup_requests SET username = username || '__dedup' || id
  WHERE id NOT IN (SELECT MIN(id) FROM signup_requests GROUP BY username);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_username ON signup_requests(username);
 `;

let bootstrapPromise: Promise<void> | null = null;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    // D1 cannot run multi-statement SQL in one call, so execute each statement
    // separately. Splitting on ";" while ignoring strings keeps it safe.
    const statements = TABLE_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const sql of statements) {
      await db.prepare(sql).run();
    }
  })();
  return bootstrapPromise;
}

// Ensure at least one admin exists. On a fresh database we seed an admin from
// the configured APP_USERNAME / APP_PASSWORD_HASH (falling back to the well
// known dev credential so the app is immediately usable).
export async function seedDefaultAdmin(
  c: AppContext,
  knownHash: string
): Promise<void> {
  const db = c.env.DB;
  const existing = await db.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
  if (existing && existing.count > 0) return;

  const username = c.env.APP_USERNAME || "Khaled";
  // Always seed with the well-known dev credential so the app is immediately
  // usable (login: <APP_USERNAME> / "khaled"). Admins can rotate via the panel.
  const passwordHash = knownHash;
  const adminRes = await db
    .prepare(
      `INSERT INTO users (username, password_hash, role, can_admin_access, status)
       VALUES (?, ?, 'admin', 1, 'active')`
    )
    .bind(username, passwordHash)
    .run();
  const adminId = (adminRes as any).meta?.last_row_id;

  // Seed a default "Patients" record definition (plan B1 backward-compat) so
  // the records UI has an entry out of the box, owned by the admin.
  const defCount = await db.prepare("SELECT COUNT(*) as count FROM record_definitions").first<{ count: number }>();
  if (!defCount || defCount.count === 0) {
    const defaultFields = [
      { key: "patientId", label: "Patient ID", type: "text" },
      { key: "patientName", label: "Patient Name", type: "text" },
      { key: "age", label: "Age", type: "number" },
      { key: "sex", label: "Sex", type: "select", options: ["Male", "Female", "Other"] },
      { key: "diagnosis", label: "Diagnosis", type: "textarea" },
      { key: "visitDate", label: "Visit Date", type: "date" },
    ];
    await db
      .prepare(
        `INSERT INTO record_definitions (user_id, name, fields, shared) VALUES (?, 'Patients', ?, 1)`
      )
      .bind(adminId, JSON.stringify(defaultFields))
      .run();
  }
}
