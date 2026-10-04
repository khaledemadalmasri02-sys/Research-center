# Changelog

All notable changes to the MedResearch Data Collection & Research Platform will be documented in this file.

## [Unreleased] — 2026-10 remediation pass

A five-agent pass across auth, storage, the design system, the desktop
shell, CI and docs. Grouped by area, not by commit. `STATUS.md` has the
single-entry-point summary and the still-open list.

### ⚠ Breaking API changes for clients

- **`GET /api/deidentify/export` → `POST /api/deidentify/export`.**
  The old GET was not a read: it ran `INSERT OR IGNORE INTO pseudonyms`
  for every patient, making it a CSRF write primitive reachable from an
  `<img src>` on any origin (`SameSite=Lax` does not stop a top-level
  navigation). Now returns **409** when the D1 `patients` table is empty
  rather than a 0-row CSV that would read as a successful de-identification
  run. No mutating endpoint may be a GET.
- **`patientId` is now required on `GET /api/consent`** (400 if absent).
  Listing every consent is refused. `GET /api/consent/status?patientId=` and
  `POST /api/consent` already required it.
- **`viewer` now gets 403** on the bulk/cross-patient PHI readers in
  `cohort`, `consent`, `deidentify`, `dicom` and `reports`. The 403 body
  says why: D1's `patients` table has no owner column, so there is no way
  to prove a viewer is entitled to a specific patient's imaging, and
  "authenticated" is not evidence of entitlement.
- **`POST /api/dicom/deidentify` returns 422** when it scrubbed metadata
  only (`METADATA_ONLY`). The rewrite genuinely happened, so it is not a
  failure — but it must not be filed as a pixel scrub.
- **Cohort export is capped and paginated**: `limit` defaults to 1000 and is
  clamped to `10000`, with `offset`. The response echoes both.
- **GDPR erasure response shape changed**: `deletedRows` is gone, replaced
  by per-store `counts` (`d1`, `d1Total`, `d1ExpectedTotal`, `objectStorage`,
  `objectStorageExpected`, `objectStorageFailures`, `postgres`,
  `auditRowsAnonymised`) plus a `stores[]` array. `ok` is now a computed
  verdict; a partial run returns **500** with an explicit "do NOT report this
  erasure to the data subject as complete" message and writes a
  `pending_erasure` marker.
- **`GET /api/gdpr/pending` added** (admin-only): lists incomplete/retryable
  erasures.
- **`DELETE /api/gdpr/erasure/:patientId` added to the api-server**
  (Postgres). Secret-gated via `x-erasure-secret` (falling back to
  `x-inbound-email-secret`), constant-time comparison. Returns 503 when no
  secret is configured, 401 on mismatch, and 200 with `deletedRows: 0` when
  nothing matches (so the Worker does not read it as "route missing" and
  loop forever). This is **not** the same as `DELETE /api/patients/:id`.
- **`GET /api/storage/public-objects/*` retired** — `requireAuth` +
  `requireAdmin`, then **410 Gone**. Clients must use
  `GET /api/storage/objects/*`.
- **`POST /api/storage/uploads/request-url` accepts an optional
  `patientId`.** When present the caller must own that patient and the id is
  baked into the key, making the object attributable on the read path.
- **Object reads are now authorised, not just authenticated.** ACL check +
  patient-ownership predicate; a denial is 403 (object read) or 404
  (per-patient image routes, so they are not an existence oracle).

### Security

- **The Worker's CSRF guard was dead code.** `csrfGuard` was defined in
  `research/src/lib/security.ts` and never imported, so no D1 mutation was
  protected. It is now registered per mount for all 16 D1 route groups.
- **The proxy was overriding the client's `Origin`**, which made the
  api-server's same-origin guard pass for every host, always. Any site on
  the internet could POST `/api/*` through the Worker with a logged-in
  victim's cookies. The origin is now forwarded unchanged and cross-origin
  hosts are rejected at the Worker.
- **`GET /api/storage/public-objects/*` was unauthenticated** and streamed
  whatever an attacker-controlled path resolved to — including
  `backups/*.sql`, unencrypted full `pg_dump` output. Now retired (410).
- **`GET /api/storage/objects/*` had only a prefix allowlist.** Added
  `canAccessObject()` (ACL policy in S3 object metadata, fails closed) and a
  patient-ownership predicate derived from the object key.
- **Per-patient image routes were an enumeration oracle.** Any authenticated
  user could read the object keys for any patient in the deployment. Now
  ownership-scoped, returning 404.
- **OTPs were generated with `Math.random()`** (V8 xorshift128+, state
  recoverable from consecutive outputs, so codes were *predictable*) and
  stored as a bcrypt hash. Now `crypto.randomInt` and
  `sha256$<salt>$<HMAC-SHA256(salt:code)>` keyed with `OTP_HASH_SECRET` or
  `SESSION_SECRET`; verification is constant-time and fails closed on
  legacy hashes.
- **Login-OTP verify had no rate limit at all.** Now 10/IP/15min **and**
  20/login-token/15min, with an atomic 5-attempt counter (a conditional
  `UPDATE … RETURNING`, so concurrent wrong codes cannot all read 0).
- **`X-Forwarded-For` was trusted unconditionally**, so anyone could reset
  every per-IP budget with a fresh header. Now honoured only when the socket
  peer is inside `TRUSTED_PROXY_CIDRS`; unset means XFF is ignored.
- **Session fixation.** `SESSION_COOKIE_DOMAIN` is
  `.research-center.fit` in production, so any sibling subdomain could plant
  a known session id. All four authentication paths (password, login OTP,
  OAuth, admin self-role change) now `regenerate()` the session id.
- **OAuth account takeover.** `WHERE email = $verified.email` handed a full
  session to anyone who could register that address at a *different*
  provider, and the callback had no account-status check. Now requires the
  provider's `email_verified`, refuses email-only auto-linking
  (`?oauth=link_required`), and requires `status = 'active'`.
- **API-token privilege escalation.** The `admin` scope is no longer
  self-assignable, and a token's admin rights require the owner's live
  `can_admin_access`, so a token can never out-privilege its owner.
- **2FA suppression.** Anyone who knew a clinician's address could suppress
  their login OTP. `GET /api/unsubscribe/status` now fails closed (403
  without a configured token, constant-time header check with one), `"all"`
  expands only to non-security categories, and a direct request for a
  security category is refused with 400 and writes nothing. Security
  categories are `login-otp`, `signup-otp`, `password-reset`,
  `account-security`, `account-security-notice`, `security-notice`,
  `transactional`.
- **Crash reports leaked PHI.** The reporter sent `window.location.href`
  including the query string, and routes carry patient ids. Now
  `location.pathname` only.
- Object keys no longer use `Math.random()`; imports and uploads use
  `crypto.randomUUID()`.
- Login-challenge tokens are hashed with `sha256` rather than bcrypt — they
  are looked up by hash, and bcrypt's per-call salt made that lookup
  unreachable, which broke login 2FA entirely.
- Server-side secrets are compared with a length-independent constant-time
  helper (`timingSafeEqual` in the Worker) instead of `===`.

### Compliance corrections

These are documentation-truth fixes. Several of the old claims described
controls that were not running.

- `SECURITY.md`'s "Crash reports never include user IDs or PHI" was
  **false** and has been rewritten to state exactly what is sent.
- `STORAGE.md`'s "No public bucket prefix in production" and "every read
  goes through `/api/storage/objects/` (auth)" were **both false** until this
  pass.
- `SECURITY.md`'s login-OTP-verify rate limit (8/15min) **did not exist**.
- `SECURITY.md`'s implied CSRF coverage for D1 routes **did not exist**.
- `STATUS.md`'s "P2 (Testing) — 0 of 4 done" and "P3 (UX/Product) — 0 of 5
  done" were both false; all four P2 suites exist and most of P3 has landed.
- `STATUS.md`'s "P1.5 Dependabot not yet added" was false — Dependabot
  existed but was **inert**, because its `ignore` list contained a catch-all
  `dependency-name: "*", versions: ["*"]` rule that matched every package.
  Now only `@types/*` and `@workspace/*` are excluded.
- `STATUS.md`'s "P1.12 OTP_LENGTH updated in `.env.example`" was overstated —
  it was a commented-out line in one file, absent from the other. Now
  uncommented with a real value in both.
- `STATUS.md`'s "P1.13 single prefix codified" was false — three
  contradictory conventions were live (`scripts/dev.sh`, `.env.example`,
  `scripts/research-deploy.sh`). Unified on `.env.example`.
- `README.md`'s four test counts, port scheme, package names, Node version,
  `docker compose up -d` scope and `dev:s3` behaviour were all wrong; see
  "Documentation" below.
- `docs/motion.md` documented a `DURATION` export and a `layoutId`
  minimize-to-dock animation that **do not exist**, and told the reader not
  to replace the latter.
- `docs/design-tokens.md` had six diverging rows plus two tokens
  (`--success`, `--warning`) that are not declared anywhere.

### Accessibility

- **Contrast.** `--muted-foreground` light `215 16% 47%` → `44%`
  (4.30 → **4.79** on `--muted`). `--input` split out of `--border` and
  given its own value: light 1.19 → **3.75**, dark 1.21 → **3.87** on
  `--background` (WCAG 1.4.11). Dark `--primary` `35%` → `30%` (white label
  4.12 → **5.33**); `--sidebar-primary` matched. Dark `--destructive`
  reworked.
- **New `--destructive-text` and `--primary-text` tokens.** `--destructive`
  is now a *surface* token and `--destructive-text` carries error text
  (`0 72% 45%` light = **5.81** on `--card`; `0 80% 66%` dark = **5.61**).
  The previous single dark value `0 62% 30%` was **1.75:1** on the dark
  card, which is why every dark-mode error message was invisible. Same split
  for `--primary` (dark `--primary-text` = **9.89:1**). Legacy
  `text-destructive` still resolves to the surface token and should be
  migrated.
- **Focus.** `focus-visible:ring-1` → `ring-2` with offsets across Button,
  Input and Checkbox (WCAG 2.2 2.4.11). Checkbox gained a **28 px** pointer
  target over its 16 px visual box (2.5.8). The global
  `input/textarea/select:focus-visible { outline: none }` suppression was
  removed — bare `border-input` fields had **no** focus indicator at all.
  The `border-radius` on the auth-screen `:focus-visible` rule was removed
  (it squared off rounded elements while focused).
- **Semantics.** `aria-sort`, `aria-rowcount`, `aria-colcount` and
  `aria-rowindex` added to `<DataTable>`. The select-all checkbox is no
  longer wrapped in the sort `<button>` (`<button><button role="checkbox">`).
  Nested interactive elements removed from the saved-view menu (delete moved
  into a submenu; both actions now driven by `onSelect`) and from the
  notification menu (navigation moved to `onSelect`).
- **Focus management on route change.** `useRouteFocus()` moves focus to
  `#main-content`, skipping the first render and collapsing in-record
  navigation so focus is not stolen from the button just pressed.
- **Product tour.** 14/14 steps were broken (`a[href="/…"]` never matched,
  because the sidebar renders `<button>`s). All steps are now anchored to
  `data-tour="<key>"` in all three shells, and a step whose target is absent
  is dropped instead of rendered as a context-free card.
- **Platform preferences.** `color-scheme: light|dark` declarations (native
  widgets no longer render light inside `.dark`), an `@media print` block,
  a `prefers-contrast: more` override, a `prefers-reduced-data: reduce`
  block, and a written RTL convention (logical properties only).
- Arabic faces are now actually loaded: `--app-font-sans` names
  `Noto Sans Arabic` and `--app-font-serif` names `Noto Naskh Arabic`, with
  matching Google Fonts links in `index.html`.
- `ErrorBoundary` fallback carries `role="alert"`.

### Desktop shell

- `zIndex` is rendered. It was tracked in the store and never applied, so
  stacking was DOM array order and the entire focus system was a no-op.
  `components/desktop/z-index.ts` is now the single source of truth.
- Escape no longer closes an open Radix dialog *and* the window behind it
  (Radix binds Escape in the capture phase and only calls
  `preventDefault()`, which does not stop propagation).
- Fixed a conditional-hook crash in `Layout` (`useIsDesktopMode` is
  reactive, and both hooks run before the early return).
- All 38 window titles resolve through `resolveAppTitle()` in both `en` and
  `ar`; 13 previously fell back to a title-cased app id.
- Desktop focus management: focus returns to the owning dock button when a
  window closes, and open/minimize/restore/maximize/close are announced
  through the live region. Duplicate `#main-content` ids across windows are
  de-duplicated so the skip link targets the focused window.
- Minimized and inactive windows are `inert` + `aria-hidden` +
  `visibility: hidden`, so they leave the tab order.
- Keyboard move and resize: `Alt`+Arrow and `Alt`+`Shift`+Arrow, plus
  `Alt`+M / `Alt`+R. Suppressed while typing in a field.
- `Alt+Tab` is no longer intercepted on Apple platforms;
  `Cmd/Ctrl+W` no longer fires while the user is typing.
- Window focus is now a single treatment (`ring-2` accent vs `ring-1`
  border) instead of a doubled 2 px accent border plus inset shadow.
- `PHI on shared workstations`: desktop window state is cleared on sign-out.
  `ubuntu-desktop-windows-v1` survived logout, so the next person to sign in
  was shown the previous user's windows and their patient ids.
- `<CommandPalette>` was mounted twice (once per shell), so one `⌘K` opened
  two stacked dialogs. Mounted once.

### CI / tooling

- **Dependabot un-inerted** (the catch-all `ignore` is removed).
- **Pre-commit hook self-installs.** `core.hooksPath` was unset, so a fresh
  clone had no hook despite the docs claiming one. The root `prepare` script
  now runs `git config core.hooksPath .githooks` on `pnpm install`.
- **`.github/workflows/a11y.yml` added**: route-level `@axe-core/playwright`
  scans for both shells via a matrix. The specs hard-fail instead of
  `test.skip()`ing when the auth boundary redirects or the dock is missing,
  and the job fails if the spec directory is missing — the gate could
  previously disable itself silently.
- `research-data` tests moved from `node --test` to **vitest**; the old
  config only matched `*-vitest.test.ts{,x}` and silently skipped seven plain
  `.test.ts` files.
- `.npmrc` pins `minimumReleaseAge` for supply-chain defence.
- Node engine raised to `>=22.6`; the documented "Node 20+" was wrong.

### Performance

- The api-server's synthetic Bearer-token session inherits from the real
  session instead of being a bare object literal, so `req.session.touch()`
  no longer throws on every API-token request.
- `discoverImagesByPatientId` lists by prefix (paginated, capped at 100 000
  keys) and filters to an exact patient match, so `patient_4` cannot read
  `patient_420` and a patient with >1000 images no longer silently loses the
  rest.
- The D1 schema bootstrap logs its errors instead of swallowing them behind
  `catch {}`; a failed bootstrap was invisible while every handler failed
  with an opaque "no such table".

### Dead code removed

**77 files.** The entire `research/ui/` duplicate SPA (the single biggest
cleanup win flagged by `docs/ui-ux-audit.md` §10), `artifacts/local-api/`,
`artifacts/worker-api/`, nine now-unreachable Worker route modules
(`admin`, `audit`, `auth`, `extras`, `feedback`, `patients`, `records`,
`storage`, `voice`), and `artifacts/research-data/src/pages/sessions.tsx` at
a duplicated path.

### Documentation

- `SECURITY.md`: CSRF model, rate-limit table (all values now traced to
  source), OTP hashing and generation, session regeneration, OAuth gates,
  API-token privilege rules, XFF trust, the unsubscribe policy, GDPR
  erasure, and an explicit "Known gaps (security)" list.
- `STORAGE.md`: rewritten read-path authorisation, the retired route and
  what replaced it, `crypto.randomUUID()` key generation, presigned-URL
  scoping, the unattributable-key residual gap, and the single-source-of-
  truth rule for the prefixes.
- `README.md`: corrected test counts, port scheme, package names, Node
  version, `docker compose up -d` scope, `dev:s3` behaviour, `dev:apps`, the
  three-file env-var split with a per-file ownership table, and a table of
  env vars that are read but documented nowhere (`TRUSTED_PROXY_CIDRS`,
  `ERASURE_SECRET`, `TEST_DATABASE_URL`).
- `STATUS.md`: new remediation-pass section as the single entry point, a
  thirteen-item "Still open" table, and P1/P2/P3 rewritten against reality.
- `docs/design-tokens.md`: rows re-transcribed from `index.css`, the two
  new tokens with the *reason* for the split, measured contrast ratios, and
  light `--destructive` recorded as **still failing** at 3.78:1.
- `docs/motion.md`: `DURATION` removed (it never existed), the `layoutId`
  minimize claim removed, window close corrected to 180 ms, reduced-motion
  rewritten to describe the three layers.
- `docs/ui-ux-audit.md`, `docs/accessibility-audit.md`: dated
  per-item FIXED / STILL VALID / SUPERSEDED addenda at the top; the
  original audits left unedited.
- `docs/architecture/routing.md`: the "why the proxy rewrites Origin"
  section was describing the bug that has now been removed; corrected,
  along with the deleted-worker sections, the dev port list, the
  `/api/saved-views` storage attribution and the stale line references.

### Still open (not in this pass)

D1/Postgres split-brain and the data-layer migration it needs · DICOM pixel
scrubbing · MFA · read-access audit · `patients.owner_user_id` · light
`--destructive` white-label contrast (3.78:1) · unattributable object keys ·
a tablet breakpoint · a desktop-window focus trap · ~29 unassociated
`<Label>` elements · a form error summary · the stale public-objects
references in `lib/api-spec/openapi.yaml`, `lib/api-client-react/src/generated/api.ts`,
`routes/storage.ts` and `research/README.md`. See `STATUS.md`.

---

## Earlier unreleased work

> These entries predate the 2026-10 remediation pass. They are kept
> verbatim as a record of what shipped when; the test counts in them are
> as-of-then and are superseded by the counts in `README.md`.

### Security
- **Rotate Brevo SMTP key + scrub git history + add gitleaks CI hook** (P0.1+0.2): Purged PHI files and dev `.env` from git history; added `.gitleaks.toml` config and pre-commit hook; force-pushed rewritten history to remote.

### Authentication & Authorization
- **Default-deny CORS** (P0.4): Flipped CORS logic to default-deny; added `ALLOWED_ORIGINS`/`SECURE_CORS` env vars; documented production routing model.
- **API token scopes + CSRF hardening** (P1.6+P1.7): Enforced `__Host-` prefixed cookies with `SameSite=Lax`/`Secure`; added `requireRole` middleware; tightened CSRF guards.
- **Body limits + per-IP rate limits** (P1.3): Tightened 50MB JSON body limit; added per-IP rate limiting on `/api/auth/*` and `/api/upload/*`; OTP length increased from 4 to 6.
- **zod validators on mutating api-server routes** (P2.5): New `validate({ body, query, params })` middleware + 9 route files converted (`patients`, `feedback`, `tokens`, `saved-views`, `sessions`, `notifications`, `inbound-email`, `voice`, `admin`). Tightens input validation, gives structured 400 errors, and removes several `as { ... }` casts over unvalidated `req.body`.

### Testing
- **api-server test suite** (P0.3): Added Vitest + supertest suite covering auth, storage, patients, records, and analysis endpoints (97 tests).
- **Worker test coverage** (P1.19): Tightened tsconfig; all 106 Worker tests pass; `tsc --build` green across workspace.
- **research-data component tests** (P2.2): Vitest + Testing Library setup with framer-motion/next-themes/i18next mocks; tests for `ThemeToggle` and `OtpVerification` (12 cases).
- **research-ui component tests + Playwright smoke** (P2.3): Tests for `ErrorBoundary`, `AuthContext`, `Layout`, `Login`; ui primitives extended to cover `Textarea`/`Select`/`Tabs`/`Table`/`Skeleton`; Playwright smoke now covers language toggle, 404, and login error.
- **research-data lib tests** (P2.1): 27 new tests across `medical-correction`, `vitals-utils`, `radiology-images`, `crash-reporter`, `import-filter`.
- **lib/stats reference-value tests** (P2.4): 11 new regression tests pinning SPSS-style calculations to known-good values.

### Documentation
- **Plan/progress consolidation** (P1.1): Created `CHANGELOG.md`; trimmed `plan-spa.md`/`plan-spss.md` to decision records only; added `STATUS.md` per package.
- **SECURITY.md** + **attached_assets/README.md**: Documented no-PHI / no-real-secrets policy.
- **LICENSE** file added (MIT from package.json).
- **README rewrite** (P2.7): Removed duplicated "Option 2" install blocks; added operations & security pointers; reorganised around Docker Compose and local pnpm paths.

### Tooling
- **OpenAPI codegen drift check in CI** (P1.16 + P2.8): `pnpm -F @workspace/api-spec codegen:check` runs orval in a sandbox and diffs the output against the committed `lib/api-client-react/src/generated/`. Wired into the pre-commit hook (only when `lib/api-spec/openapi.yaml` or `lib/api-client-react/src/generated/**` are staged) and into the `codegen-check` GitHub Actions job.

### Code Quality
- **Tighten tsconfig** (P1.19): Enabled `noUnusedLocals` + `strictFunctionTypes` across lib packages; fixed 16+ unused imports; `tsc --build` green across all packages.
- **Error boundary + Sentry-style reporting** (P1.20): Created React ErrorBoundary component that posts structured crash reports to `/crash-report` endpoint; added global `unhandledrejection` + `window.onerror` handlers; research/ui build + typecheck clean.
- **Delete/untrack build artefacts** (P1.20): 7.7 MB of build artefacts no longer tracked in git; `.gitignore` expanded.

### Storage & Routing
- **Object-store prefix conventions** (P1.13): Codified single prefix convention; enforced on upload; `discoverImagesByPatientId` now uses `Prefix=radiology/<patientId>/`.
- **Routing model doc** (P1.7): Merged Worker routes into api-server or actual served from Worker; added request-flow documentation.

### PHI & Compliance
- **Purge PHI from history** (P0.2): Removed `attached_assets/patients_2026-07-19_copy_*.xlsx` and `IMG_6458_*.png` from git history; added synthetic fixtures; updated `.gitignore`; added `attached_assets/README.md`.

### Dependencies
- **Drop unused deps** (P1.15): Removed `google-auth-library` and `openai` from `api-server/package.json`; removed duplicate `@types/nodemailer`; regenerated `pnpm-lock.yaml`.
- **Tighten tsconfig** (P1.19): Enabled `noUnusedLocals` + `strictFunctionTypes`; fixed resulting errors; `tsc --build` green.

### Build Artefacts
- **Untrack build artefacts** (P1.20): `research/public/**` gitignored; 60 video files; 7.7 MB of build outputs no longer in history.