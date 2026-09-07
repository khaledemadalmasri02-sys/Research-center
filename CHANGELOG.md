# Changelog

All notable changes to the MedResearch Data Collection & Research Platform will be documented in this file.

## [Unreleased]

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