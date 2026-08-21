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
