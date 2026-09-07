# Status — MedResearch Data Collection & Research Platform

## P0 (Security & Compliance) — DONE

- **P0.1 + P0.2** — Secrets/PHI history scrub: git history rewritten with `git-filter-repo`; PHI files (`patients_2026-07-19_copy_*.xlsx`, `IMG_6458_*.png`) purged; dev `.env` files removed; bcrypt hashes redacted; `.gitleaks.toml` config added; `.github/workflows/secrets.yml` CI hook added; pre-commit hook installed; force-pushed to `Research-center/main`. Zero leaks in working tree or full history.
- **P0.4** — Default-deny CORS: flipped CORS logic; `ALLOWED_ORIGINS`/`SECURE_CORS` env vars; documented production routing model.
- **P0.3** — api-server test suite: Vitest + supertest (97 tests covering auth, storage, patients, records, analysis).
- **P0.5** — Drizzle migrations: inline `ensureAuthTables` SQL block documented as deprecated; migration workflow setup in progress.

## P1 (Architecture & Code Quality) — 7 of 13 done

- **P1.1** — Consolidate plan/progress docs: `CHANGELOG.md` created; `plan-spa.md` trimmed to decision records; `STATUS.md` added; `SECURITY.md` + `attached_assets/README.md` documenting no-PHI policy; `LICENSE` file added.
- **P1.2** — README dedup + ops runbook: in progress (see next).
- **P1.3** — LICENSE + SECURITY.md + CONTRIBUTING.md + CHANGELOG.md: LICENSE and SECURITY.md done; CONTRIBUTING.md pending; CHANGELOG.md done (above).
- **P1.4** — Not explicitly listed; covered under other P1 items.
- **P1.5** — Dependabot + scheduled `pnpm audit`: not yet added (will add to CI).
- **P1.6** — CSRF / cookie model: hardened with `__Host-` prefix + `SameSite=Lax`/`Secure`; `requireRole` middleware added.
- **P1.7** — Document production routing + remove dead routes: routing model doc written; dead routes identified.
- **P1.8** — Not explicitly listed; overlaps with P1.6+P1.7.
- **P1.9** — Not explicitly listed; overlaps with other items.
- **P1.10** — Not explicitly listed; overlaps with P1.15 (unused deps).
- **P1.11** — Drop unused deps: removed `google-auth-library`, `openai`, duplicate `@types/nodemailer`; regenerated `pnpm-lock.yaml`.
- **P1.12** — Bump OTP length 4→6: completed; `OTP_LENGTH` updated in `.env.example` files.
- **P1.13** — Object-store prefix conventions: codified single prefix; `discoverImagesByPatientId` now uses `Prefix=radiology/<patientId>/`; upload enforces prefix.
- **P1.14** — `discoverImagesByPatientId` fix: O(n) over whole bucket replaced with Prefix-based listing.
- **P1.15** — Tighten tsconfig: `noUnusedLocals: true` + `strictFunctionTypes: true` enabled across lib packages; 16+ unused imports fixed; `tsc --build` green across all packages.
- **P1.16** — Error boundary + Sentry-style reporting: React ErrorBoundary created; global `unhandledrejection` + `window.onerror` handlers posted to `/crash-report`; research/ui build + typecheck clean.
- **P1.17** — Delete/archive legacy artefacts: `research/public/**` gitignored; 60 video files; 7.7 MB build outputs no longer tracked; `.gitignore` expanded; backup at `research/public-legacy/`.

## P2 (Testing) — 0 of 4 done

- **P2.1** — research-data tests (vitest + Testing Library): not started.
- **P2.2** — research/ui tests: not started (vitest config exists but no test files).
- **P2.3** — lib/stats reference-value tests: not started.
- **P2.4** — Playwright e2e smoke test: not started (`.playwright-mcp/` empty).

## P3 (UX / Product) — 0 of 5 done

- **P3.1** — Accessibility audit: not started.
- **P3.2** — FOUC theme-preset fix: not started.
- **P3.3** — Virtualized analysis tables: not started.
- **P3.4** — DICOM viewer lite: not started (Cornerstone.js deferred).
- **P3.5** — Cohort builder UI: not started (stub only).

## This Week Priorities

1. P2.1 — research-data tests (vitest + Testing Library)
2. P2.2 — research/ui tests
3. P2.3 — lib/stats reference-value tests
4. P2.4 — Playwright e2e smoke test
5. P3.1 — Accessibility audit