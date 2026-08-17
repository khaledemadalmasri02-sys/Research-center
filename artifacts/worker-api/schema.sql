-- D1 Database Schema for mednexus-research
-- Run with: wrangler d1 execute mednexus-research --sql-file=schema.sql

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

-- Insert a test patient
INSERT OR IGNORE INTO patients (patient_id, patient_name, age, sex) VALUES 
  ('P001', 'Test Patient', 30, 'Male');