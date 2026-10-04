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
| Crash reports (`/api/crash-report`) | **Logged only, not stored** | The api-server logs to pino (`logger.error` with `crash:` context). Pino's default is stdout; a `pino-roll` or file transport controls log retention. See "Crash-report payload" below — this used to claim no user IDs or PHI were included, which was **false**. | Log-driven. |

### Crash-report payload

`POST /api/crash-report` is deliberately unauthenticated (a user who cannot
log in must still be able to report a broken build) and rate limited to
**20 requests / IP / 15 min** (`artifacts/api-server/src/routes/crash-report.ts:25`).

**The reporter used to ship `window.location.href`, which includes the query
string, and this app carries patient identifiers in the query** (e.g.
`/patients/123`, `/records/2/9`). Every crash therefore wrote a PHI-bearing
URL into the api-server's stdout logs. It now sends `location.pathname` only:

- `artifacts/research-data/src/lib/crash-reporter.ts:134` (`window.onerror`)
- `artifacts/research-data/src/lib/crash-reporter.ts:151` (`unhandledrejection`)
- `artifacts/research-data/src/components/ErrorBoundary.tsx:49` (render errors)

The remaining payload is `kind`, `message`, `stack`, `componentStack`,
`pathname`, `userAgent`, `ts` and an optional free-form `context`. The
message and `context` are caller-supplied strings and are **not**
scrubbed, so do not put identifiers in them.

### Recommended additions (not yet shipped)

The following are **known gaps** in the retention story. Track them as separate work items.

- A nightly `pg_cron` or Node cron job that hard-deletes audit log rows older than the configured retention window (e.g. 2 years for HIPAA, 1 year for GDPR data minimisation).
- A "right to be forgotten" flow that:
  1. Marks the user as `pending_erasure` and disables login.
  2. Hard-deletes their `patients`, `records`, `feedback`, `notifications`, `audit_log.detail` rows.
  3. Tombstones the `users` row (`status = 'erased'`, `email = NULL`, `username = 'erased-<id>'`).
  4. Deletes the corresponding `radiology/<patientId>/` and `radiology-objects/uploads/<patientId>/` prefixes from the object store.

  **Step 1 (account-level `users.status = 'erased'` tombstone) is still not
  implemented**, and the erasure that does exist is *patient*-scoped, not
  account-scoped: `DELETE /api/gdpr/erasure/:patientId` (Worker, orchestrating
  D1 + object storage + Postgres + audit-trail anonymisation). See
  "GDPR erasure" below for what that route does and does not cover.
- A D1 equivalent for the Worker (currently no D1-side purge).
- Document destruction: when a patient is deleted, the JSON in `radiologyImages` should be parsed and each `objectKey` should be deleted from the bucket. Today the row delete is silent on the S3 side.

### Local development retention

Synthetic data under `attached_assets/fixtures/` is **not** PHI and has no retention requirement. Anything else in `attached_assets/` must be wiped before any commit (`.gitignore` blocks it; `gitleaks` scans for it). Test suites use Testcontainers Postgres + MinIO; both are destroyed at the end of the test run, so no test data persists beyond the CI job.

## Cryptographic defaults

- **Passwords** hashed with **bcrypt**. Cost 12 at the api-server
  (`artifacts/api-server/src/lib/security.ts:5`); cost 10 in the Worker
  (`research/src/lib/security.ts:71`).
- **OTP codes are NOT bcrypt-hashed.** They were changed to
  `sha256$<16-byte salt>$<HMAC-SHA256(salt:code)>`:
  `hashOtp()` in `artifacts/api-server/src/lib/security.ts:45`, verified in
  constant time by `verifyOtp()` (`:54`). The HMAC key is `OTP_HASH_SECRET`,
  falling back to `SESSION_SECRET`. Rationale in the source: a 6-digit OTP is
  ~20 bits of entropy, lives 10 minutes and is tried at most 5 times, so a
  cost-12 KDF bought nothing while blocking the event loop for hundreds of
  ms per code. Because the MAC is keyed with a server-side secret, a leaked
  database dump alone cannot be brute-forced offline.
  `verifyOtp()` **fails closed** on any stored value that is not in this
  scheme, so legacy bcrypt hashes stop verifying (they must be reissued, not
  migrated).
- **Login-challenge tokens** are `sha256(randomBytes(32))`
  (`hashLoginToken`, `security.ts:77`). They must be deterministic because
  the challenge is *looked up* by hash; bcrypt's per-call salt made that
  lookup unreachable and broke login 2FA.
- **OTP code generation** uses `crypto.randomInt` (OS CSPRNG), not
  `Math.random` — `generateOtpCode()` at
  `artifacts/api-server/src/routes/auth.ts:47`. V8's `Math.random` is
  xorshift128+ whose state is recoverable from a handful of consecutive
  outputs, so codes drawn from it were *predictable*, not merely guessable.
- **Sessions** signed with `SESSION_SECRET` (≥ 32 random bytes in
  production; the server refuses to boot without it under
  `NODE_ENV=production`). Production uses `__Host-rc_sid`.
- **Session ids are regenerated on every authentication.** All three login
  paths (password, login OTP, OAuth) and the admin self-role change go
  through `establishSession()` (`artifacts/api-server/src/lib/session.ts:38`),
  which calls `req.session.regenerate()` before writing the identity.
  This closes session fixation: `SESSION_COOKIE_DOMAIN` is
  `.research-center.fit` in production, so any sibling subdomain could plant
  a known session id that would otherwise be promoted to an authenticated one.
- **CSRF:** double-submit cookie on the Worker's D1 routes + an Origin
  guard on the api-server. See "CSRF model" below — this used to be documented
  as if both halves were active; they were not.
- **Cookies:** `HttpOnly`, `SameSite=Lax` for same-origin flows (configurable
  via `SESSION_COOKIE_SAMESITE`), `Secure` in production.

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
  fallback is removed. An **Origin guard** middleware in
  `artifacts/api-server/src/app.ts:150-162` rejects cross-origin
  non-safe methods independently of the CORS config, so a future
  allowlist regression does not silently re-open writes.
- **`X-Forwarded-For` is honoured only from a trusted proxy.**
  `clientIp()` (`artifacts/api-server/src/lib/security.ts:159`) reads XFF
  only when `req.socket.remoteAddress` falls inside `TRUSTED_PROXY_CIDRS`
  (comma-separated CIDRs/bare IPs, IPv4 + IPv6); otherwise the socket
  address wins. The server is *also* directly reachable at
  `api.research-center.fit`, so trusting XFF unconditionally let anyone
  reset every per-IP budget (login, signup, OTP, presign, upload) by
  sending a fresh header. **Unset `TRUSTED_PROXY_CIDRS` and XFF is ignored
  entirely** — correct for direct exposure and fail-closed if the Cloudflare
  ranges are ever forgotten. Example for the Cloudflare-fronted deployment:
  `TRUSTED_PROXY_CIDRS=173.245.48.0/20,103.21.244.0/22,2400:cb00::/32`.
  This variable is read from the environment but is **not yet documented in
  any `.env.example`** — see "Known gaps".
- **Object keys**: prefixed by patient/record ID; never accept
  free-form keys that could collide across patients. Object ids are
  generated with `crypto.randomUUID()`, not `Math.random()`. See
  `STORAGE.md` for the residual gap on unattributable keys.
- **Body size**: JSON capped at 1 MB (overridable via
  `JSON_BODY_LIMIT`); large uploads go through multer with per-IP
  rate limits.
- **API tokens**: the `admin` scope is in the stored vocabulary but is
  **not self-service requestable** — `POST /api/tokens` rejects it with 403
  unless `req.session.canAdminAccess` is already true
  (`artifacts/api-server/src/routes/tokens.ts:79`). Independently,
  `authenticateApiToken()` grants `canAdminAccess` **only** when the token
  carries the `admin` scope **and** the owning user still has
  `can_admin_access` in the database
  (`artifacts/api-server/src/lib/apiToken.ts:101-102`), so a token can
  never out-privilege its owner even after demotion. Token issuance is
  limited to 10/IP/15min and 5/user/15min.
- **OAuth**: the callback is the authorisation point for a social login and
  now enforces three things it did not before
  (`artifacts/api-server/src/routes/auth.ts`):
  1. the provider must report `email_verified` (Google via `tokeninfo`,
     Apple via the ID-token claim) before the address is used to identify
     or create an account (`:903`);
  2. **no email-only auto-linking** — if a local account already uses that
     address, the login is refused with `?oauth=link_required` and must be
     linked explicitly (`:922`). Previously `WHERE email = $verified.email`
     handed a full session to anyone who could register that address at a
     *different* provider;
  3. the account must be `status = 'active'` — the callback previously had
     no status check at all, so a `suspended` account could still log in via
     OAuth (`:976`).
- **Unsubscribe / suppression** (`research/src/routes/unsubscribe.ts`):
  - `GET /api/unsubscribe/status` **fails closed**. With no
    `UNSUBSCRIBE_STATUS_TOKEN` (or `UNSUBSCRIBE_TOKEN`/`INBOUND_EMAIL_SECRET`)
    configured it returns 403 instead of disclosing an arbitrary address's
    per-category suppression state; with one configured it requires the
    `x-mail-unsubscribe-token` header, compared in constant time (`:394-411`).
  - **`"all"` can no longer suppress security-relevant mail.**
    `resolveSuppressionScope()` (`:194`) expands `all` only to the concrete
    marketing/engagement categories, and a direct request for a security
    category is refused with 400 and writes nothing. `SECURITY_CATEGORIES`
    (`:47`) is `login-otp`, `signup-otp`, `password-reset`,
    `account-security`, `account-security-notice`, `security-notice`,
    `transactional`. CAN-SPAM §4(4) does not override authentication
    obligations, and suppressing `login-otp` is a denial of service on
    another person's sign-in.
  - Every unsubscribe mutation requires a per-address HMAC token minted into
    the email link, is rate limited to 10/IP/10min, and compares the token
    in constant time. `GET /status` no longer derives `unsubscribedAll` from
    a stored `"all"` row; it is hardcoded `false` (`:428`).
  - The api-server's pre-send guard (`lib/unsubscribeGuard.ts`) is still
    **fail-open on a network error or timeout** (800 ms) — deliberate, so a
    Worker outage cannot break OTP delivery.

### Rate limits (as implemented)

All per-IP, all return 429 with a `Retry-After` header.

| Endpoint | Budget | Source |
| --- | --- | --- |
| `POST /api/auth/login` | 10 / 15 min | `auth.ts:71` |
| `POST /api/auth/signup` | 10 / 15 min | `auth.ts:191` |
| `POST /api/auth/otp/send` (signup) | 8 / 15 min | `auth.ts:282` |
| `POST /api/auth/signup/otp/verify` | 10 / IP / 15 min **and** 20 / username / 15 min | `auth.ts:366`, `:379` |
| `POST /api/auth/login/otp/send` | 8 / 15 min | `auth.ts:459` |
| `POST /api/auth/login/otp/verify` | 10 / IP / 15 min **and** 20 / login-token / 15 min | `auth.ts:533`, `:555` |
| `POST /api/storage/uploads/request-url` | 60 / 15 min | `storage.ts:378` |
| `POST /api/storage/upload-file` | 30 / 15 min | `storage.ts:819` |
| `POST /api/storage/images/import` | 30 / 15 min | `storage.ts:546` |
| `POST /api/analysis/datasets` | 20 / 15 min | `analysis.ts:51` |
| `POST /api/analysis/runs` | 30 / 15 min | `analysis.ts:53` |
| `POST /api/analysis/from-query` | 30 / 15 min | `analysis.ts:55` |
| `POST /api/tokens` | 10 / IP and 5 / user / 15 min | `tokens.ts:47`, `:60` |
| `POST /api/crash-report` | 20 / 15 min | `crash-report.ts:25` |
| `POST /api/unsubscribe` (Worker) | 10 / 10 min per IP | `unsubscribe.ts:99` |

### Login-OTP verification: what it does and does not do

`POST /api/auth/login/otp/verify` previously had **no rate limit at all** —
the 8/15min figure documented here for months did not exist. It now has:

- a per-IP budget (10/15min) and a per-login-token budget (20/15min). The
  per-token budget is what actually stops a botnet walking the 1 000 000
  code space from many addresses; the per-IP budget alone does not;
- an **atomic** 5-attempt counter. The increment and the cap check are one
  conditional `UPDATE ... WHERE "otp_attempts" < 5 RETURNING`, so concurrent
  wrong codes cannot all read 0 and proceed (`auth.ts:588-598`).

The counter is still per-`users` row, not per-challenge: requesting a new
code resets it to 0 (`auth.ts:490`), so a user who keeps resending gets a
fresh budget. That is a deliberate availability/usability trade-off, not a
defect.

### CSRF model

**This section previously described a control that was not running.**

`csrfGuard()` was defined in `research/src/lib/security.ts` and never
imported anywhere, so **no D1 mutation was protected at this layer**. It is
now registered per mount immediately before each D1 sub-app
(`research/src/index.ts:171-177`), covering both the bare prefix and
`/*/…` sub-paths for all 16 D1 mounts: `consent`, `deidentify`,
`record-versions`, `record-verify`, `codings`, `cohort`, `validation`,
`dicom`, `export`, `studies`, `ml`, `reports`, `gdpr`, `ingest`, `search`,
`unsubscribe`. Tokens are minted at `GET /api/csrf`
(`index.ts:182`). `csrfGuard` skips `GET`/`HEAD`/`OPTIONS` and
`Authorization: Bearer` requests.

It is deliberately **not** applied to the proxied `/api/*` catch-all: those
routes are authenticated by the api-server's `connect.sid` session, and
requiring the Worker's separate `csrf` cookie there broke login. Proxied
traffic is protected by the two controls below instead.

**The proxy used to defeat the api-server's Origin guard.**
`proxyToBackend()` did `headers.set("origin", base)`, overwriting the
client's `Origin` with the api-server's own base URL — so the api-server's
guard passed unconditionally, for every host, always. Any site on the
internet could POST `/api/*` through the Worker with a logged-in victim's
cookies. Two changes:

1. the client's `Origin` is now forwarded **unchanged** (deleted when
   absent, which the api-server treats as same-origin)
   (`research/src/index.ts:232-236`);
2. the Worker rejects any request whose `Origin` host is not in
   `CANONICAL_HOSTS` (`research-center.fit`, `www.research-center.fit`) with
   403 before proxying (`index.ts:214-228`). An absent `Origin` is left
   alone.

**No state-changing endpoint may be a `GET`.** `SameSite=Lax` does not stop
a top-level navigation, so a mutating GET is a CSRF write primitive
reachable from an `<img src>` on any origin. `GET /api/deidentify/export`
was one — it ran `INSERT OR IGNORE INTO pseudonyms` for every patient — and
is now **`POST /api/deidentify/export`** (`research/src/routes/deidentify.ts:219`).
Do not reintroduce a GET on any mutating route; `csrfGuard` explicitly does
not cover GET.

## GDPR erasure

`DELETE /api/gdpr/erasure/:patientId` (Worker) orchestrates four stores and
returns a per-store verdict. The response shape changed: **`deletedRows` is
gone, replaced by a `counts` object** (`d1`, `d1Total`, `d1ExpectedTotal`,
`objectStorage`, `objectStorageExpected`, `objectStorageFailures`,
`postgres`, `auditRowsAnonymised`) plus a `stores[]` array, and `ok` is a
*computed* verdict rather than a hardcoded `true`
(`research/src/routes/gdpr.ts:403-430`). A partial run returns **500** with
an explicit "do NOT report this erasure as complete" message and writes a
`pending_erasure` marker.

A Postgres half was added: `DELETE /api/gdpr/erasure/:patientId` on the
api-server (`artifacts/api-server/src/routes/gdpr.ts`), secret-gated by
`x-erasure-secret` (falling back to `x-inbound-email-secret`), comparing
`ERASURE_SECRET`/`INBOUND_EMAIL_SECRET` in constant time. It returns 503
when no secret is configured (fail closed) and 401 on mismatch. It collects
object keys *before* deleting anything (that is the only linkage from a
patient to their S3 objects), cascades across `record_images`, `records`,
`radiology_images`, `patients` in one transaction, and **anonymises rather
than deletes** the audit trail. `GET /api/gdpr/pending` (Worker,
admin-only) lists incomplete/retryable erasures.

The object store is still not *fully* covered by the automated flow: the
Worker deletes the keys it can collect, and the api-server returns the full
key list for the caller to remove. Verify the object-store outcome in the
`counts` block rather than assuming the images are gone.

## Object storage access control

Full details in [`STORAGE.md`](STORAGE.md). The security-relevant summary:

- `GET /api/storage/public-objects/*` was **unauthenticated** and resolved an
  attacker-controlled path against the whole configured search path,
  including `backups/*.sql` (unencrypted full `pg_dump` output). It is now
  `requireAuth` + `requireAdmin` and answered **410 Gone (retired)**
  (`artifacts/api-server/src/routes/storage.ts:465-479`).
- `GET /api/storage/objects/<key>` requires a session and then runs two
  gates before reading a byte: an object ACL check
  (`canAccessObject()`, `lib/objectAcl.ts`) and a patient-ownership
  predicate derived from the key.

## Dependencies

- `pnpm` enforces `minimumReleaseAge: 1440` (1 day) for supply-chain defense.
- Dependabot is configured at `.github/dependabot.yml`: weekly scan of
  the pnpm workspace and GitHub Actions, grouped PRs (patch+minor
  together, major separate), one open PR per ecosystem.
  **Dependabot was inert until this pass.** Its `ignore` list contained a
  catch-all `{ dependency-name: "*", versions: ["*"] }` rule that matched
  every package, so no npm update was ever proposed. The `ignore` list now
  contains only genuine exclusions (`@types/*`, `@workspace/*`), and the
  `github-actions` block's `<5.0.0` pin on `actions/checkout` is gone so
  action SHAs can be bumped.
- `.github/workflows/audit.yml` runs `pnpm audit --prod
  --audit-level=high` weekly and opens an issue with the report on
  failure. The issue is deduped by title over a 30-day window so
  the same finding doesn't produce many tickets. Note the workflow step
  carries `continue-on-error: true` **by design** — the failure signal is
  the opened issue, not a red X on the schedule.

## Known gaps (security)

Track these; none of them is closed by the remediation pass.

1. **D1 / Postgres split-brain.** Patient records are written to Postgres
   behind the api-server; the Worker's D1 `patients` table receives
   nothing, so every D1 clinical route reads rows that do not exist. Full
   description in `research/src/index.ts:40-72`. Until the data-layer
   migration lands, treat every D1 clinical response as unverified.
2. **No DICOM pixel scrubbing.** De-identification is metadata-only. The
   route returns **422** (not 200) precisely so a metadata-only run cannot
   be filed as a completed pixel scrub — see `research/src/routes/dicom.ts:308`.
3. **No MFA.** Login 2FA is email OTP over the same channel as the password
   reset, so it is not a second factor against a compromised mailbox.
4. **No read-access audit.** `audit_log` records mutations. Reading a
   patient's imaging through `/api/storage/objects/*` leaves no trace, which
   is a HIPAA §164.312(b) problem.
5. **`patients.owner_user_id` does not exist.** The D1 `patients` table has
   no owner column, so there is no correct owner-scoping query; the interim
   gate is `requirePatientScope()` (`research/src/lib/security.ts:556`),
   which denies `viewer` outright with a 403 that says so.
6. **No data-layer migration** (dual-write D1 or move the route modules to
   Postgres). Deliberately not attempted; needs a plan, backfill and
   rollback path.
7. **Unattributable object keys.** A key that names no patient and carries
   no ACL policy is readable by any authenticated user, because
   `POST /api/storage/uploads/request-url` without `patientId` writes
   exactly those keys. See `STORAGE.md`.
8. **`TRUSTED_PROXY_CIDRS` is undocumented in every `.env.example`.** It is
   read by `clientIp()` and its absence silently disables XFF trust (the
   fail-closed behaviour), but an operator enabling the Cloudflare tunnel
   has no in-repo prompt to set it.
9. **`ERASURE_SECRET` is likewise undocumented** in
   `artifacts/api-server/.env.example`; without it (or
   `INBOUND_EMAIL_SECRET`) the Postgres erasure route returns 503.
10. **The OpenAPI spec still advertises the retired route.**
    `lib/api-spec/openapi.yaml:268` documents
    `/storage/public-objects/{filePath}`, which now answers 410, and does
    not document `/storage/objects/{path}`, which is the real read path.
11. **`research/README.md:27`** still lists `GET /api/storage/public-objects/*`
    as a live endpoint.