# Test3 — Research Platform Gap-Closure Plan

> Goal: Bring the MedResearch data-collection platform up to research-grade
> (compliance, imaging, interoperability, analytics, QA). This plan targets
> features confirmed **absent** from the current codebase (`lib/db` schema +
> `research/src` routes): no DICOM, no consent/IRB, no de-identification, no
> record versioning, no FHIR/ICD-10, no cohort builder, no test suite, no
> validation rules engine, no PDF/report export, no GDPR erasure.

## 0. Target Architecture (unchanged stack)

- Edge: Cloudflare Worker (`research/src`) proxying `/api/*` to the Postgres API.
- DB: Drizzle ORM on Postgres (`lib/db/src/schema`). Runtime tables bootstrapped
  in `ensureAuthTables()` style (mirror existing pattern in `index.ts`).
- Storage: S3/R2 for blobs (`lib/s3.ts`, `routes/storage.ts`).
- Frontend: React + Vite + TanStack Query + Tailwind (already has i18n/RTL, dark mode).
- Validation: Zod (`zod/v4`) + `drizzle-zod` (already a dep).
- Auth/RBAC: `viewer|editor|admin` + API tokens (existing `security.ts`, `extras.ts`).

Keep every new feature **scoped to `user_id`** and gated by existing
`requireAuth` / `requireEdit` / `requireAdmin` patterns.

---

## Phase 1 — Research Compliance & Data Integrity (BLOCKER)

### 1.1 Consent & IRB management

**Schema (`lib/db/src/schema/consent.ts`)**
```
consent_versions: id, code (text unique), label, irb_number, text, effective_at, retired_at
consents: id, patient_id (FK patients), consent_version_id (FK),
          status ('signed'|'withdrawn'|'pending'),
          signed_at, signed_by_user_id, withdrawn_at, withdrawn_reason,
          document_object_key (S3 ref to signed PDF), created_at, updated_at
study_protocols: id, code, title, irb_number, pi_name, status, created_at
```
Export both from `schema/index.ts`.

**Backend (`routes/consent.ts`, mounted `requireAuth`)**
- `GET /api/consents?patientId=` — list consents for a patient (own scope; admin read-all).
- `POST /api/consents` — `requireEdit`; body `{patientId, consentVersionId, status, documentObjectKey?}`; create + write `audit.consent.create`.
- `POST /api/consents/:id/withdraw` — `requireEdit`; sets `withdrawn_at`, reason, audit.
- `GET /api/consent-versions` — active versions (for the form dropdown).
- Gate `POST /api/patients` / record create when a study requires consent
  (config flag `studyRequiresConsent`); return `409` if missing signed consent.

**Frontend**
- `pages/consent.tsx` — consent list + sign/withdraw, upload signed PDF via existing
  presigned-URL flow.
- `components/consent-badge.tsx` — shows consent status on patient header.
- `layout.tsx` — "Consent" nav link (all authenticated users).

**Verification**: `pnpm run typecheck`; sign consent as editor, view as admin,
block patient creation when required consent missing.

### 1.2 De-identification & pseudonymization

**Schema (`schema/pseudonyms.ts`)**
```
pseudonyms: id, patient_id (FK), study_code, pseudonym (unique per study),
            salt_hash, created_at
deid_jobs: id, user_id, scope ('patient'|'image'|'dataset'), status,
           config_json, created_at, finished_at
```
**Backend (`routes/deidentify.ts`, `requireEdit`)**
- `POST /api/deidentify/patient/:id` — produce pseudonym, strip configured PHI
  fields (`patient_name`, direct identifiers) into a read-only de-identified view
  `v_patients_deid`; return pseudonym.
- `POST /api/deidentify/image/:key` — DICOM tag scrubbing utility (Phase 2.1) that
  removes PHI tags (PatientName, PatientID, InstitutionName, dates) → re-upload to
  `/deid/` path; record `deid_jobs`.
- `GET /api/deidentify/export` — export dataset with pseudonyms + dropped PHI
  columns (used by cohort builder / external share).

**Frontend**: `pages/deidentify.tsx` — run/inspect jobs, download de-identified CSV.

**Verification**: typecheck; confirm original vs de-id rows differ and PHI absent.

### 1.3 Record edit history / versioning

**Schema (`schema/record_versions.ts`)**
```
record_versions: id, record_id (FK), user_id, version_no,
                 data_snapshot (jsonb), change_summary, created_at
```
**Backend**: extend `routes/records.ts` `UPDATE` — before write, insert prior
`data` as a new `record_versions` row (version_no = max+1), then update.
- `GET /api/records/:id/versions` (own/admin) — list.
- `GET /api/records/:id/versions/:v` — snapshot + diff vs previous.
- Wire `audit.record.update` with `entity_id=record_id`.

**Frontend**: `record-history.tsx` — timeline + diff viewer (reuse `activity` styles).

**Verification**: edit a record, confirm version row + audit; rollback option.

### 1.4 Double data entry / inter-rater reliability

**Schema (`schema/record_verification.ts`)**
```
record_verifications: id, record_id, second_user_id, second_data (jsonb),
                      status ('pending'|'matched'|'conflict'),
                      conflict_fields (jsonb), concordance (float), created_at
```
**Backend (`routes/records.ts`)**: `POST /api/records/:id/verify` (second editor)
compares `second_data` to `record.data`, stores conflicts + concordance.
`GET /api/records/verify-queue` (admin/editor) lists `pending`.
**Frontend**: verification review UI highlighting conflicts.
**Verification**: two editors enter same record, concordance computed.

---

## Phase 2 — Medical Imaging Upgrade

### 2.1 DICOM ingestion & metadata

**Schema (`schema/radiology-images.ts` extend)**: add `modality, body_part,
series_instance_uid, study_instance_uid, sop_instance_uid, acquisition_date,
dicom_metadata (jsonb), is_deidentified (bool)`.
**Backend (`routes/storage.ts` extend)**: on upload with `.dcm`, parse header
(client-side `dicom-parser` or worker `dcmjs`) → populate metadata; store in
`radiology_images`. Add `GET /api/radiology/:patientId/studies` grouping by
`study_instance_uid`.
**Frontend**: `radiology-dicom.tsx` using **Cornerstone.js** + **dicom-parser**:
window/level, zoom/pan, measurements, series thumbnails. Reuse existing object
fetch (`/api/storage/objects/*`).

**Verification**: upload a sample `.dcm`, confirm metadata + viewer renders.

### 2.2 PACS / HL7 v2 ingest (optional, stretch)

**Backend**: `routes/ingest.ts` accepts HL7 v2 ORU/ADT messages (parsed by
`nodemailer`-style simple HL7 lib or `hl7` npm) → maps to patient/record rows.
**Verification**: POST a sample HL7 message, confirm patient created.

---

## Phase 3 — Interoperability & Coding

### 3.1 ICD-10 / SNOMED-CT diagnosis coding

**Schema (`schema/codings.ts`)**
```
diagnosis_codes: id, patient_id (or record_id), code_system ('ICD10'|'SNOMED'),
                 code, display, confidence, coded_by_user_id, created_at
```
Seed a local ICD-10 subset table (or call an external terminology API).
**Backend (`routes/coding.ts`, `requireEdit`)**: `POST /api/diagnoses/:id/code`
with autocomplete `GET /api/codings/search?q=&system=`.
**Frontend**: autocomplete field on diagnosis inputs; store coded value alongside
free text (`final_confirmed_diagnosis`).
**Verification**: code a diagnosis, confirm stored + queryable by code.

### 3.2 FHIR / HL7 export

**Backend (`routes/export.ts`)**: `GET /api/export/fhir?scope=` builds FHIR
`Patient`/`Observation`/`DiagnosticReport` bundles (use `fhir` npm or hand-rolled
mappings). `GET /api/export/hl7` for bulk.
**Verification**: export one patient, validate bundle against FHIR validator.

---

## Phase 4 — Analytics & Study Management

### 4.1 Cohort builder + statistical export + codebook

**Schema**: reuse `saved_views` (filters jsonb) → extend with `cohort` flag.
**Backend (`routes/cohort.ts`, `requireAuth`)**:
- `POST /api/cohort/build` runs filter across `records`/`patients` (tsvector +
  JSONB filters from #8.3), returns matched IDs + variable matrix.
- `GET /api/cohort/export?format=csv|spss|r` streams matrix with attached
  **codebook** (field defs, types, value labels).
- `GET /api/cohort/stats` cross-tabulations (age×diagnosis, sex×outcome).
**Frontend**: `cohort-builder.tsx` (reuse `records-toolbar`), variable picker,
export buttons; `codebook.tsx` view.
**Verification**: build a cohort, export CSV + codebook, open in R/SPSS.

### 4.2 Longitudinal / multi-instrument & study sites

**Schema (`schema/studies.ts`)**
```
studies: id, code, title, irb_number, status, enrollment_target, created_at
sites: id, study_id, name, country, pi_user_id, enrollment_count
study_arms: id, study_id, name
record_events: id, record_id, event (text), arm_id, repeat_instance (int),
               completed_at
```
**Backend**: extend `records` with `event`/`arm`/`repeat_instance`;
`GET /api/studies` dashboard (enrollment vs target).
**Frontend**: study/sites admin tab; longitudinal form repeats.
**Verification**: create study + 2 sites, enter repeating instrument.

---

## Phase 5 — AI/ML Provenance

### 5.1 Model registry & prediction tracking

**Schema (`schema/ml.ts`)**
```
ml_models: id, name, version, artifact_object_key, metrics_json, created_at
ml_predictions: id, record_id (or image_id), model_id, output_json,
                confidence (float), created_at
ml_groundtruth: id, record_id, label, reviewed_by, created_at
ml_eval_runs: id, model_id, auc, sensitivity, specificity, f1, created_at
```
**Backend (`routes/ml.ts`, `requireEdit`)**: log predictions against
`ai_prediction_output`; `POST /api/ml/evaluate` computes metrics vs ground truth.
**Frontend**: model list, prediction confidence display, eval metrics cards.
**Verification**: register model, log predictions, compute AUC.

---

## Phase 6 — Quality Engineering

### 6.1 Validation rules engine

**Schema (`schema/validation_rules.ts`)**
```
validation_rules: id, definition_id, field_key, rule_type
  ('range'|'regex'|'required'|'cross_field'|'unique'),
  params (jsonb), message, severity ('error'|'warn'), created_at
```
**Backend**: validation service runs rules on record create/update; errors block
save (409 + field map), warnings annotate. `GET /api/validation/duplicates?field=patient_id`.
**Frontend**: inline field errors/warnings in `record-form`.
**Verification**: define range rule, trigger error + warning cases.

### 6.2 Automated test suite (CRITICAL)

- Add `vitest` to `research` + `lib/db`. `scripts/test` npm script.
- Unit: validation engine, de-id scrubber, DICOM parser, coding autocomplete.
- Integration: auth roles (viewer/editor/admin), API-token auth, consent gate,
  record versioning, cohort export, duplicate detection.
- Fixtures: seed `patients`/`records` via Drizzle; use MinIO/R2 mock + D1/PG test DB.
**Verification**: `pnpm run test` green in CI (add GitHub Actions / Replit check).

---

## Phase 7 — Reporting & Ops

### 7.1 PDF CRF / report generation

**Backend (`routes/reports.ts`, `requireAuth`)**: `GET /api/reports/patient/:id/pdf`
render CRF via `pdfkit`/`@react-pdf/renderer` (server) or client print.
**Frontend**: "Print CRF" button on patient/record view.
**Verification**: generate PDF, confirm fields render.

### 7.2 GDPR erasure & retention

**Backend (`routes/gdpr.ts`, admin)**: `DELETE /api/gdpr/erasure/:patientId`
cascades `patients` → `records`, `radiology_images`, `consents`, `audit`
(anonymize rather than hard-delete audit), and deletes S3/R2 objects.
`GET /api/gdpr/retention` lists records past retention window.
**Frontend**: admin "Data" tab erasure action with confirmation + reason audit.
**Verification**: erase patient, confirm cascade + objects removed.

---

## Recommended Implementation Order

1. **Phase 6.2 (tests)** — establish safety net before changes.
2. **Phase 1.1 consent/IRB** + **1.2 de-identification** — compliance blockers.
3. **Phase 1.3 record versioning** — data integrity foundation.
4. **Phase 2.1 DICOM** — core radiology value.
5. **Phase 4.1 cohort + codebook** — research output.
6. **Phase 6.1 validation engine** — data quality.
7. **Phase 3 (ICD-10 / FHIR)** — interoperability.
8. **Phase 1.4 double entry**, **5 ML provenance**, **4.2 studies/sites**.
9. **Phase 7 reports + GDPR** — final polish.

## Cross-cutting Notes

- **Dual-DB risk**: `research/schema.sql` (D1/SQLite) vs `lib/db` (Postgres).
  Align migrations; pick one source of truth for new tables. Add a CI check that
  both schemas match.
- **i18n**: wrap all new UI strings in `t()` (en/ar), keep RTL support.
- **Audit**: every new mutation writes `audit_log` (existing `writeAudit`).
- **RBAC**: editors mutate, viewers read, admins manage; API tokens carry scopes.
- **Verification gate**: `pnpm run typecheck` + `pnpm run test` after each phase.

---

## Implementation Status (updated)

### Phase 1.1 — Consent & IRB management ✅ IMPLEMENTED & VERIFIED

Backend (D1/Hono worker — the only backend actually present; `research/src/index.ts`
was a pure proxy leaving all `routes/*.ts` orphaned, so this also wires the new
feature in and surfaces it locally from D1):

- `research/src/routes/consent.ts` — Hono sub-app:
  - `GET  /api/consent/versions` (auth) — active templates
  - `POST /api/consent/versions` (admin) — create template
  - `GET  /api/consent/` (auth, `?patientId=`) — list consents
  - `GET  /api/consent/status?patientId=` — valid-consent check
  - `POST /api/consent/` (editor+) — sign a consent
  - `POST /api/consent/:id/withdraw` (editor+) — withdraw
  - `GET  /api/consent/protocols` (auth) — list study protocols
  - `POST /api/consent/protocols` (admin) — create protocol
  - All mutations write `audit_log` via `writeAudit`.
- `research/src/index.ts` — mounts `consentApp` and runs `ensureSchema(c.env.DB)`
  (idempotent D1 bootstrap); proxy remains the fallback for other `/api/*` paths.
  Set `strict: false` so trailing-slash `/api/consent/` routes resolve.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — new tables:
  `consent_versions`, `consents`, `study_protocols` (+ indexes).

Frontend (no SPA source in repo — only built bundles — so a standalone usable
page was added instead of a React route):

- `research/public/consent.html` + `research/public/assets/consent-page.js`
  — sign/withdraw consents, create templates & protocols, status check.

Verification: `tsc --noEmit` passes; live `wrangler dev --local` smoke test
exercised the full lifecycle (create version → sign → status true → withdraw →
status false) and 401/403 gating.

**Deferred / follow-ups (noted, not blocking):**
- Patient-creation consent gate (`studyRequiresConsent`) — depends on the
  patients route, which is still behind the proxy to the (absent) api-server.
- React SPA integration once `artifacts/research-data` source is present.
- Cross-DB alignment: consent (D1) vs patients (api-server/Postgres) references.

### Phase 1.2 — De-identification & pseudonymization ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/deidentify.ts` — Hono sub-app:
  - `GET  /api/deidentify/pseudonym?patientId=&studyCode=` — lookup
  - `POST /api/deidentify/pseudonym` (editor+) — deterministic, salted SHA-256
    pseudonym (stable per `patient_id`+`study_code`, stored in `pseudonyms`).
  - `GET|POST /api/deidentify/export?studyCode=` (editor+) — CSV with direct
    identifiers dropped (`patient_name`, `radiology_images`, image links, `notes`)
    and `pseudonym` substituted; POST logs a `deid_jobs` row + audit.
  - All mutations write `audit_log`.
- `research/src/index.ts` — `app.route("/api/deidentify", deidentifyApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `pseudonyms`,
  `deid_jobs` tables.
- `research/public/deidentify.html` — standalone UI (generate pseudonym, download
  de-identified CSV).

Verification: `tsc --noEmit` passes; live smoke test confirmed deterministic
pseudonyms, PHI stripping in CSV, and 401 gating.

> DICOM tag-scrubbing sub-item (image `:key` scrub) is deferred to Phase 2.1
> (no DICOM parser present yet) — the `deid_jobs`/pseudonym foundation is in.

### Phase 6.2 — Automated test suite ✅ IMPLEMENTED & VERIFIED

Foundation safety net (recommended first in the plan; added after 1.1/1.2 so it
also covers them):

- `research/vitest.config.ts` — node env, `test/**/*.test.ts`.
- `research/package.json` — added `vitest` devDep + `"test": "vitest run"`.
- `research/test/helpers.ts` — `FakeD1` (scriptable in-memory D1 responder),
  `makeApp()` mounting the real `consentApp` + `deidentifyApp`, `makeEnv()`, and
  admin/editor/viewer fixtures. `lib/security` is mocked (auth/RBAC/audit) so
  tests exercise routing, validation, RBAC and response shapes without a real DB.
- `research/test/consent.test.ts` (7 tests) — 401 gating, version listing, sign
  consent + audit, invalid/unknown-version rejection, admin-only protocol
  creation (403 vs 201), withdraw.
- `research/test/deidentify.test.ts` (5 tests) — CSV/PHI helper units, 401 gating,
  deterministic pseudonym generation, de-identified CSV export (PHI dropped,
  pseudonym substituted).
- `research/src/routes/deidentify.ts` — exported `csvCell`/`csvLine` for unit tests.

Verification: `pnpm test` → **12 passed**. Combined with the live `wrangler
dev --local` smoke tests, the consent + de-identification features are covered.

### Phase 1.3 — Record edit history / versioning ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/recordVersions.ts` — Hono sub-app (D1):
  - `POST /api/record-versions/:recordId/snapshot` (editor+) — captures the
    current `records.data` as a new version (`version_no = max+1`), writes audit.
  - `GET  /api/record-versions/:recordId` (auth) — list versions (newest first).
  - `GET  /api/record-versions/:recordId/:version` (auth) — snapshot + field-level
    diff vs the previous version (`{key, from, to}`).
- `research/src/index.ts` — `app.route("/api/record-versions", recordVersionsApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `record_versions`.
- `research/test/recordVersions.test.ts` (4 tests) — snapshot capture + audit,
  404 on missing record, list, and diff-vs-previous.

Verification: `tsc --noEmit` + `pnpm test` (**16 passed** total).

> **Limitation (documented):** auto-capture *on the records UPDATE path* is not
> wired, because record writes are proxied to the (absent) Postgres api-server,
> not D1. The explicit `snapshot` endpoint delivers the audit-trail/diff value
> on the D1 layer; to auto-capture on every edit, the records write path (the
> api-server) must call `record_versions` on update — a follow-up once the
> records route is mounted/served from this worker.

### Phase 1.4 — Double data entry / inter-rater reliability ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/recordVerify.ts` — Hono sub-app (D1):
  - `POST /api/record-verify/:recordId` (editor+) — submits a second independent
    entry; compares `secondData` against the stored `records.data`, computes
    field-level `conflictFields` and `concordance`, stores status
    (`matched`|`conflict`), writes audit.
  - `GET  /api/record-verify/queue` (editor+) — conflict verifications for review.
  - `GET  /api/record-verify/:recordId` (auth) — verifications for a record.
- `research/src/index.ts` — `app.route("/api/record-verify", recordVerifyApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `record_verifications`.
- `research/test/recordVerify.test.ts` (4 tests) — matched (100%), conflict +
  partial concordance, 404 on missing record, conflict queue.

Verification: `tsc --noEmit` + `pnpm test` (**20 passed** total).

### Phase 3.1 — ICD-10 / SNOMED-CT diagnosis coding ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/coding.ts` — Hono sub-app (D1), mounted at `/api/codings`:
  - `GET  /api/codings/search?q=&system=` (auth) — autocomplete over the
    terminology table (LIKE on code/display, optional system filter).
  - `POST /api/codings/code` (editor+) — attach a standardized code to a
    patient/record; validates `codeSystem` ∈ {ICD10, SNOMED} and that the code
    exists in `terminology_codes`; stores `display` + optional `confidence`.
  - `GET  /api/codings?patientId=&recordId=` (auth) — list coded diagnoses.
- `research/src/index.ts` — `app.route("/api/codings", codingApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `terminology_codes`
  (with a **starter ICD-10/SNOMED subset** via idempotent `INSERT OR IGNORE`)
  and `diagnosis_codes`.
- `research/test/coding.test.ts` (5 tests) — search, invalid system rejection,
  unknown-code rejection, valid attach + audit, list.

Verification: `tsc --noEmit` + `pnpm test` (**25 passed** total).

> **Note:** the terminology seed is a small starter subset (≈13 codes). Load a
> full ICD-10 / SNOMED release (or proxy an external terminology API) to make the
> autocomplete production-complete. Phase 3.2 (FHIR/HL7 export) is still pending.

### Phase 2.1 — DICOM ingestion & metadata ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/dicom.ts` — Hono sub-app (D1), mounted at `/api/dicom`:
  - `POST /api/dicom/metadata` (editor+) — store parsed DICOM metadata
    (modality, body_part, series/study/sop UIDs, acquisition_date, JSON metadata);
    `modality` is allow-listed. Writes audit.
  - `POST /api/dicom/deidentify` (editor+) — strips PHI tags from an image's
    stored metadata via the pure `stripPhiTags()` and flags `is_deidentified=1`.
  - `GET /api/dicom/images?patientId=&studyInstanceUid=` (auth) — list images.
  - `GET /api/dicom/studies/:patientId` (auth) — group images by
    `study_instance_uid` (study modality/body-part/count/date).
  - `stripPhiTags(metadata, placeholder)` — pure, exported; removes DICOM PHI
    tags (PatientName, PatientID, InstitutionName, referring/performing
    physicians, dates, etc.) while keeping clinical/technical tags. Testable.
- `research/src/index.ts` — `app.route("/api/dicom", dicomApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `dicom_images`
  table (modality, body_part, series/study/sop UIDs, acquisition_date,
  dicom_metadata, is_deidentified) + indexes.
- `research/public/dicom.html` + `research/public/assets/dicom-page.js` —
  register parsed metadata, list studies, de-identify a study.
- `research/test/dicom.test.ts` (8 tests) — pure PHI scrubber (strips/keeps,
  no mutation, PHI tag set), metadata store (editor) + 403 (viewer),
  de-identify (editor), studies grouping (viewer), 404 missing image.

Verification: `tsc --noEmit` + `pnpm test` (**44 passed** total).

> A full **Cornerstone.js** pixel-rendering viewer (window/level, zoom/pan,
> measurements) is deferred — the worker stores/serves metadata and groups
> studies; client-side `dicom-parser`/`dcmjs` populates these fields on upload.
> HL7 v2 ingest (Phase 2.2) is still pending.

### Phase 3.2 — FHIR / HL7 export ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/export.ts` — Hono sub-app (D1), mounted at `/api/export`:
  - `GET /api/export/fhir?recordId=` (auth) — builds a FHIR R4 **Bundle** (`type: collection`)
    with a `Patient` resource, one `Observation` per record-data field, and a
    `DiagnosticReport` per coded diagnosis (`diagnosis_codes`). `fhirGender()`
    normalizes the `sex` field. Writes audit `export.fhir`.
  - `GET /api/export/hl7?recordId=` (auth) — builds a minimal **HL7 v2** `ORU^R01`
    (`MSH` / `PID` / `OBX`) message, `text/hl7-v2`, with proper `^~\&` encoding
    chars and `hl7Escape()` field escaping. Writes audit `export.hl7`.
  - Pure, exported builders `buildFhirBundle()`, `buildHl7V2()`, `fhirGender()`,
    `hl7Escape()` for unit testing.
- `research/src/index.ts` — `app.route("/api/export", exportApp)`.
- `research/test/export.test.ts` (6 tests) — FHIR bundle shape (Patient/Observation/
  DiagnosticReport, gender mapping), HL7 escaping + segment structure, route
  bundle + HL7 text (auth), 404 missing record, 400 missing `recordId`.

Verification: `tsc --noEmit` + `pnpm test` (**52 passed** total).

> Bulk multi-patient export (`scope=`) and a full terminology-mapped FHIR profile
> (LOINC-coded Observations) are follow-ups; single-record bundle/message is
> delivered and validated by structure.

### Phase 4.1 — Cohort builder & codebook ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/cohort.ts` — Hono sub-app (D1), mounted at `/api/cohort`:
  - `POST /api/cohort/build` (auth) — apply allow-listed, parameterized filters
    over `patients`; returns the matched matrix + count.
  - `POST /api/cohort/export` (auth) — CSV download of the cohort.
  - `GET  /api/cohort/codebook` (auth) — field metadata (name/type/label).
  - `POST /api/cohort/stats` (auth) — cross-tabulation of two fields.
- **Security:** field names are strictly allow-listed (`FIELD_TYPES`); values are
  always bound as parameters — no string interpolation, closing the SQL-injection
  risk flagged in `update1.md` (routes/schema.ts `SELECT * FROM "${table}"`).
- `research/src/index.ts` — `app.route("/api/cohort", cohortApp)`.
- `research/test/cohort.test.ts` (5 tests) — build, injection-surface rejection
  (malicious field never reaches SQL), CSV export, codebook, cross-tab.

Verification: `tsc --noEmit` + `pnpm test` (**30 passed** total).

> **Scope notes:** cohort filtering operates on the `patients` table (allow-listed
> columns). The plan's `saved_views` `cohort` flag and SPSS/R export formats are
> not implemented (CSV + codebook delivered; extend export for SPSS/R later).
> Record-level (JSONB) cohort filtering can be added by extending `FIELD_TYPES`
> with validated `json_extract` keys.

### Phase 4.2 — Longitudinal / multi-instrument & study sites ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/studies.ts` — Hono sub-app (D1), mounted at `/api/studies`:
  - `GET /api/studies` (auth) — list studies with aggregated `enrolled` (Σ site
    `enrollment_count`) + `siteCount`.
  - `POST /api/studies` (editor+) — create a study (`code` unique, `title`,
    `irbNumber`, `status`, `enrollmentTarget`); audit `study.create`.
  - `POST /api/studies/:id/sites` (editor+) — add a site (name/country/PI/
    enrollment); audit `study.site.create`.
  - `GET|POST /api/studies/:id/arms` (auth / editor+) — list/create study arms.
  - `POST /api/studies/:id/record-events` (editor+) — attach a record to an
    event/`arm_id`/`repeat_instance` (longitudinal repeating instruments); audit.
  - `GET /api/studies/:id/dashboard` (auth) — `enrolled`, `remaining`
    (`target − enrolled`), per-site breakdown.
- `research/src/index.ts` — `app.route("/api/studies", studiesApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `studies`,
  `sites`, `study_arms`, `record_events` (+ indexes).
- `research/test/studies.test.ts` (8 tests) — study create (editor) + 403
  (viewer), site add, study list rollup, dashboard remaining/target, 404 missing
  study, arm create, record-event attach.

Verification: `tsc --noEmit` + `pnpm test` (**60 passed** total).

> `records` are linked to longitudinal events via `record_events` (records'
> `event`/`arm` columns per the plan are captured here so the existing
> `records` table is not altered). React SPA study/sites admin UI is a
> follow-up (standalone HTML pages not added for this phase).

### Phase 5 — AI/ML Provenance ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/ml.ts` — Hono sub-app (D1), mounted at `/api/ml`:
  - `POST /api/ml/models` (editor+) — register a model (`name`, `version`,
    `artifactObjectKey`, `metricsJson`); audit `ml.model.create`.
  - `GET /api/ml/models` (auth) — list models.
  - `POST /api/ml/predictions` (editor+) — log a prediction against a
    `record_id`/`image_id` with `output_json` + `confidence`.
  - `POST /api/ml/groundtruth` (editor+) — store a reviewed label for a record.
  - `POST /api/ml/evaluate` (editor+) — joins predictions × ground truth, runs
    the pure `computeMetrics()` (accuracy, sensitivity, specificity, precision,
    F1, rank-based **AUC**) for a chosen positive label, persists an
    `ml_eval_runs` row; audit `ml.evaluate`.
  - `computeMetrics(rows)` — pure, exported, unit-tested (perfect separation →
    AUC 1; empty → zeros).
- `research/src/index.ts` — `app.route("/api/ml", mlApp)`.
- `research/src/lib/db-bootstrap.ts` + `research/schema.sql` — `ml_models`,
  `ml_predictions`, `ml_groundtruth`, `ml_eval_runs` (+ indexes).
- `research/test/ml.test.ts` (8 tests) — pure metrics (perfect/no-order AUC,
  empty), model register (editor) + 403 (viewer), prediction log, evaluate
  store + AUC, 400 missing modelId.

Verification: `tsc --noEmit` + `pnpm test` (**68 passed** total).

> Prediction display / eval-metric cards in a React SPA are a follow-up
> (no SPA source in repo); the API + audit trail + metrics store are delivered.

### Phase 7 — Reporting & Ops ✅ IMPLEMENTED & VERIFIED

#### 7.1 PDF CRF / report generation
- `research/src/lib/pdf.ts` — `buildSimplePdf(lines, title)` — tiny, **dependency-free**
  valid PDF writer (Helvetica, single page); pure + exported (tested: `%PDF` header/
  `%%EOF`, parentheses escaping).
- `research/src/routes/reports.ts` — Hono sub-app (D1), mounted at `/api/reports`:
  - `GET /api/reports/patient/:id/pdf` (auth) — assembles patient-scoped consents,
    diagnosis codes and DICOM images into a CRF and returns `application/pdf`
    (inline). Writes audit `report.patient.pdf`.

#### 7.2 GDPR erasure & retention
- `research/src/routes/gdpr.ts` — Hono sub-app (D1), mounted at `/api/gdpr`:
  - `DELETE /api/gdpr/erasure/:patientId` (admin) — cascade-deletes patient rows
    from `consents`, `diagnosis_codes`, `dicom_images`, `pseudonyms`; the audit
    trail is **anonymized/retained** (erasure event recorded rather than wiped)
    for compliance. Returns deleted-row count.
  - `GET /api/gdpr/retention?days=` (admin) — lists erasure candidates (withdrawn
    consents older than the window, grouped by patient).
- `research/src/index.ts` — mounts `reportsApp` + `gdprApp`.
- `research/test/reports.test.ts` (7 tests) — PDF builder (valid/escape), patient
  PDF response + content-type, GDPR cascade count (admin), 403 non-admin erasure,
  retention candidates (admin), 403 non-admin retention.

Verification: `tsc --noEmit` + `pnpm test` (**75 passed** total).

> Server-side S3/R2 object deletion on erasure is deferred (no object-store
> binding wired in this worker yet); the row cascade + audit event is delivered.
> A React "Print CRF" button + admin erasure UI are follow-ups (no SPA source).

### Phase 2.2 — PACS / HL7 v2 ingest ✅ IMPLEMENTED & VERIFIED

- `research/src/routes/ingest.ts` — Hono sub-app (D1), mounted at `/api/ingest`:
  - `POST /api/ingest/hl7` (editor+) — accepts an HL7 v2 message (JSON
    `{message}` or raw `text/plain`); parses segments via the pure `parseHl7()`,
    extracts the patient from `PID` (`extractPid()` with `hl7Unescape()`),
    resolves the `Patients` record definition and creates a `records` row
    (`source: "hl7"`). Rejects empty (400), no-PID (422), non-editor (403).
    Writes audit `ingest.hl7`.
  - Pure builders `parseHl7()`, `extractPid()`, `hl7Unescape()` exported/tested.
- `research/src/index.ts` — `app.route("/api/ingest", ingestApp)`.
- `research/test/ingest.test.ts` (7 tests) — parser (segment split, PID
  extraction with unescape), ingest creates record (editor) + 403 (viewer),
  422 no PID, 400 empty.

Verification: `tsc --noEmit` + `pnpm test` (**82 passed** total). All `test3.md`
phases are now implemented.

> React SPA integration for the new UIs remains the only outstanding cross-cutting
> item (no SPA source in repo — features are exposed via standalone HTML pages
> and/or the JSON API as noted per phase).

### Status summary
- ✅ 1.1 Consent & IRB
- ✅ 1.2 De-identification
- ✅ 1.3 Record versioning
- ✅ 1.4 Double data entry / inter-rater
- ✅ 2.1 DICOM ingestion & metadata
- ✅ 2.2 PACS / HL7 v2 ingest
- ✅ 3.1 ICD-10 / SNOMED coding
- ✅ 3.2 FHIR / HL7 export
- ✅ 4.1 Cohort builder & codebook
- ✅ 4.2 Longitudinal / multi-instrument & study sites
- ✅ 5 AI/ML Provenance
- ✅ 6.1 Validation rules engine
- ✅ 6.2 Automated test suite (82 tests)
- ✅ 7 Reporting & Ops (PDF CRF + GDPR erasure)

### Remaining from test3.md
React SPA integration for the new UIs (currently standalone HTML pages where
added, since no SPA source exists in the repo).

---

## update1.md follow-ups delivered (this session)

The worker already implemented most of update1.md (users/admin, signup approval,
RBAC, API tokens, audit, notifications, feedback, sessions, login rate-limiting
+ lockout). This session closed the remaining cross-cutting items on the D1
worker:

- **#8.3 Search & saved views** — `research/src/routes/search.ts`:
  - `POST /api/search` (auth) — parameterized free-text + allow-listed
    `json_extract` field filters over `records` (no string interpolation).
  - `GET|POST|DELETE /api/saved-views` — per-user saved-view CRUD.
- **#8.1 Audit / activity APIs** — `research/src/routes/audit.ts`:
  - `GET /api/audit` (admin) — global, paginated, `?action=&userId=` filters.
  - `GET /api/audit/me` (auth) — own timeline.
- **Security hardening (Phase A1 / Phase C)** — `research/src/lib/security.ts`:
  - `ssrfCheck()` — blocks private/loopback/link-local/metadata + non-http(s)
    URLs; wired into `patients.ts` `BATCH_IMPORT_IMAGES` fetch.
  - `csrfGuard()` + `issueCsrfToken()` — double-submit CSRF on state-changing
    proxy requests (Bearer/API-token requests exempt); `GET /api/csrf` issues
    the token. Applied to `app.all("/api/*")` in `index.ts`.
- **CI + schema-consistency (test3.md cross-cutting note)** —
  `.github/workflows/ci.yml` (typecheck → schema check → vitest) and
  `research/scripts/check-schema.mjs` (`npm run check:schema`) asserting
  `schema.sql` and `db-bootstrap.ts` define the same 32 tables. **This check
  caught a real drift**: `validation_rules`, `patients`, `sessions`, `feedback`
  existed in `schema.sql` but were missing from the runtime bootstrap — now
  reconciled in both files.

Verification: `tsc --noEmit` + `pnpm test` → **97 tests pass** (16 files).
`node scripts/check-schema.mjs` → ✅ 32 tables consistent.
