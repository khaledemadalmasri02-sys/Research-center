# Security Policy

## Reporting a vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Email `security@research-center.fit` (or `khaledemadalmasri02-sys` via GitHub private disclosure) with:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- The commit hash / branch where you observed it.

We will acknowledge within 2 business days and aim to triage within 5.

## Supported versions

Only the latest commit on `main` receives security updates. Older commits may contain issues already addressed.

## Data handling

This repository powers a **medical research data platform**. The following are enforced:

1. **No PHI in git.** Files under `attached_assets/` other than synthetic fixtures under `attached_assets/fixtures/` are blocked by `.gitignore`. Real patient data, medical images, or any non-public files must NEVER be committed. See `attached_assets/README.md`.
2. **No real secrets in git.** `.env`, `.env.*` (except `.env.example`), `*.replit`, `*.dev.vars`, and `research/.env` are git-ignored. `gitleaks` (see `.gitleaks.toml`) runs on every CI push and weekly on full history.
3. **Pre-commit hook.** Install with `git config core.hooksPath .githooks` to scan staged changes before commit.
4. **Rotate on exposure.** If a real secret leaks, rotate it at the provider **first**, then scrub history.

## PHI field inventory

The system stores data on two Postgres databases and one object store. The fields below carry Protected Health Information (PHI) or personally identifying information (PII); treat each as confidential.

### Postgres — `api-server` (Drizzle, see `lib/db/src/schema/`)

| Table | PHI / PII fields | Notes |
| --- | --- | --- |
| `patients` | `patientId` (medical record number, not the national ID), `patientName`, `age`, `sex`, `dateOfVisit`, `chiefComplaint`, `vitalSigns`, `historyTrauma`, `mechanismOfInjuryAndLocalisation`, `signsAndSymptomsTrauma`, `historyMedical`, `signsAndSymptomsMedical`, `riskFactors`, `provisionalDiagnosis`, `finalConfirmedDiagnosis`, `finalConfirmedDiagnosisAr`, `radiologyImageFilePathOrLink`, `radiologyImages` (JSON list of stored object paths), `emergencyReport`, `aiPredictionOutput`, `notes` | Linked to `userId` (FK to `users`); every query must filter on `userId` so users only see their own patients. The `users` row is the data controller for the patient's records. |
| `records` + `record_definitions` | all per-record user fields (e.g. custom columns) | Schema is admin-defined; treat all column values as PHI once a real schema is deployed. |
| `record_images` | `studyId`, `objectKey` (S3 path), `metadata` JSON | Object keys themselves reveal patient context. |
| `feedback` | `message` (free-text user input), `rating`, `type` | The free-text field is the riskiest — may contain anything the user typed, including PHI they paste in by mistake. |
| `users` | `email`, `username`, `fullName`, `passwordHash` (bcrypt) | `email` + `username` are the contact PII. `passwordHash` is a credential, not PHI, but is still sensitive. |
| `signup_requests` | `email`, `username`, `fullName`, `phone` (if collected) | Holds unverified-request data until an admin approves or rejects. |
| `notifications` | `title`, `body`, `link` | Not PHI by itself, but can reference patient IDs in the link. |
| `audit_log` | `detail` JSON, `action`, `entityId` | Logs every mutating action. The `detail` field is the riskiest — it can include patient IDs, IP addresses, and any metadata passed to `writeAudit`. Treat as PHI. |
| `inbound_emails` | `sender`, `recipient`, `subject`, `body_text`, `body_html`, `message_id`, `in_reply_to` | Free-form email content from Cloudflare Email Routing. `body_html` is the largest exposure (up to 500 KB per the validate() schema in P2.5). |
| `api_tokens` | `name` (user-supplied), `tokenHash` | `tokenHash` is a credential. |
| `session` (Postgres-backed `connect-pg-simple`) | `sess` JSON (userId, username, csrf secret, etc.) | The session store itself is not PHI, but the `sess` JSON is the live auth state. |

### Postgres — Worker (`research/`, D1)

| Table | Fields | Notes |
| --- | --- | --- |
| `consent` | `patient_hash`, `patient_name`, `version`, `signed_at`, `withdrawn_at` | The Worker does not store raw patient identifiers — it stores a hash. `patient_name` is the exception. |
| `cohort`, `studies`, `reports`, `validation_results`, `deidentify_jobs`, `ml_provenance`, `audit` | various | See `research/schema.sql` for column-by-column detail. Anything keyed off `patient_hash` is still PHI-adjacent. |

### Object store (MinIO / R2)

| Prefix | Contents | Notes |
| --- | --- | --- |
| `radiology/<patientId>/...` | User-uploaded DICOM / JPG / PNG | The key itself contains the patient ID. Never expose the bucket to the public internet. |
| `radiology-public/...` | Public, cacheable assets | No PHI expected; review uploads if you store anything here. |
| `radiology-objects/uploads/...` | Legacy user uploads | Same PHI risk as the `radiology/<patientId>/` prefix. |

## Retention policy

There is no automatic purge today — the data lifetime is "as long as the database lives". The rules below describe what *should* happen and the manual controls available.

| Data class | Default lifetime | Trigger / delete mechanism | Status |
| --- | --- | --- | --- |
| Sessions (`session` table) | **7 days** | `express-session` cookie `maxAge = 7d`; the `session` row's `expire` column is checked by `connect-pg-simple` and stale rows are GC'd. | Automated. |
| Sign-in OTP codes (`users.otp_code_hash`, `signup_requests.otp_code_hash`) | **10 minutes** (signup), **5 minutes** (login) | `OTP_TTL_MS = 10 * 60 * 1000`, `LOGIN_OTP_TTL_MS = 5 * 60 * 1000`. Expired rows are overwritten on the next OTP send; not actively deleted. | Automated overwrite. |
| Login challenges (`login_challenges.token_hash`) | **5 minutes** | `LOGIN_OTP_TTL_MS = 5 * 60 * 1000`. Same overwrite pattern. | Automated overwrite. |
| Audit log (`audit_log`) | **Indefinite** (default) | Manual: `DELETE FROM "audit_log" WHERE "created_at" < now() - interval '2 years'` (or whichever retention period your DPO mandates). | Manual only. |
| Inbound emails (`inbound_emails`) | **Indefinite** (default) | Manual purge via the admin inbox. | Manual only. |
| Feedback (`feedback`) | **Indefinite** (default) | Admin can delete via `/api/feedback/:id` (no automatic GC). | Manual only. |
| Patients, records, images | **Until the user deletes them or their account is deleted** | Cascade deletes on `users.id`; manual DELETE on patient/record IDs otherwise. | User-driven. |
| Crash reports (`/api/crash-report`) | **Logged only, not stored** | The api-server logs to pino (`logger.error` with `crash:` context). Pino's default is stdout; a `pino-roll` or file transport controls log retention. Crash reports never include user IDs or PHI. | Log-driven. |

### Recommended additions (not yet shipped)

The following are **known gaps** in the retention story. Track them as separate work items.

- A nightly `pg_cron` or Node cron job that hard-deletes audit log rows older than the configured retention window (e.g. 2 years for HIPAA, 1 year for GDPR data minimisation).
- A "right to be forgotten" flow that:
  1. Marks the user as `pending_erasure` and disables login.
  2. Hard-deletes their `patients`, `records`, `feedback`, `notifications`, `audit_log.detail` rows.
  3. Tombstones the `users` row (`status = 'erased'`, `email = NULL`, `username = 'erased-<id>'`).
  4. Deletes the corresponding `radiology/<patientId>/` and `radiology-objects/uploads/<patientId>/` prefixes from the object store.
- A D1 equivalent for the Worker (currently no D1-side purge).
- Document destruction: when a patient is deleted, the JSON in `radiologyImages` should be parsed and each `objectKey` should be deleted from the bucket. Today the row delete is silent on the S3 side.

### Local development retention

Synthetic data under `attached_assets/fixtures/` is **not** PHI and has no retention requirement. Anything else in `attached_assets/` must be wiped before any commit (`.gitignore` blocks it; `gitleaks` scans for it). Test suites use Testcontainers Postgres + MinIO; both are destroyed at the end of the test run, so no test data persists beyond the CI job.

## Cryptographic defaults

- Passwords hashed with **bcrypt** (cost ≥ 10).
- Sessions signed with `SESSION_SECRET` (≥ 32 random bytes in production).
- CSRF: double-submit cookie at the Worker + Origin guard at the api-server.
- Cookies: `HttpOnly`, `SameSite=Lax` for same-origin flows (Strict for admin routes), `Secure` in production.

## Threat-model notes

- **OTP length (P1.4):** default is **6 digits** (1 000 000 codes) with
  a 5-attempt lockout and a 5-minute TTL. Brute-force probability per
  session: 5 / 1 000 000 = **0.0005%** for login 2FA; the same math
  applies to signup email verification (10-minute TTL, 5 attempts).
  Override via `OTP_LENGTH` env (range 4-8). Don't set this below 6
  in production without a documented threat-model exception.

  For reference, the previous 4-digit default gave 5 / 10 000 = 0.05%
  per session — borderline acceptable for low-risk flows but
  insufficient for medical data, which is why 6 digits is the new
  default. NIST 800-63B recommends ≥6 digits for one-time
  authentication codes.

- **CORS**: api-server defaults to a closed allowlist
  (`ALLOWED_ORIGINS` must be set). The previous "reflect any origin"
  fallback is removed.
- **Object keys**: prefixed by patient/record ID; never accept
  free-form keys that could collide across patients.
- **Body size**: JSON capped at 1 MB (overridable via
  `JSON_BODY_LIMIT`); large uploads go through multer with per-IP
  rate limits.
- **Per-IP rate limits**: login 10/15min, signup 10/15min, OTP
  send 8/15min, login-OTP verify 8/15min, presigned URL request
  60/15min, upload-file 30/15min, image import 30/15min, dataset
  upload 20/15min, analyze 30/15min, from-query 30/15min. All return
  429 with a `Retry-After` header.

## Dependencies

- `pnpm` enforces `minimumReleaseAge: 1440` (1 day) for supply-chain defense.
- Dependabot is configured at `.github/dependabot.yml`: weekly scan of
  the pnpm workspace and GitHub Actions, grouped PRs (patch+minor
  together, major separate), one open PR per ecosystem.
- `.github/workflows/audit.yml` runs `pnpm audit --prod
  --audit-level=high` weekly and opens an issue with the report on
  failure. The issue is deduped by title over a 30-day window so
  the same finding doesn't produce many tickets.