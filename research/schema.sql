-- D1 Database Schema for research
-- Run with: wrangler d1 execute research --sql-file=schema.sql

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

-- Session table (for fallback if KV is not available)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT,
  expire DATETIME
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- Feedback submissions (mirrors the Postgres `feedback` table)
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

-- ============================================================================
-- Tables mirroring the Postgres backend (users / records / RBAC / #8 features).
-- These let the worker run standalone on D1 when API_BACKEND_URL is not set.
-- (When the proxy is enabled, the Postgres backend owns this data instead.)
-- SQLite has no BOOLEAN/jsonb, so those map to INTEGER (0/1) and TEXT.
-- ============================================================================

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
  locked_until DATETIME,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS record_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',
  shared INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_record_defs_user ON record_definitions(user_id);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  definition_id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_def ON records(definition_id);

CREATE TABLE IF NOT EXISTS record_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_record_images_record ON record_images(record_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  definition_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  sort TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);

-- Insert a test patient
INSERT OR IGNORE INTO patients (patient_id, patient_name, age, sex) VALUES 
  ('P001', 'Test Patient', 30, 'Male');