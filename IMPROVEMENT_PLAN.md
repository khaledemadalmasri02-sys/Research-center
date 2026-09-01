# Project Improvement Plan

Generated from the full project analysis. Each item has: **priority**, **why it matters**, **scope of work**, **acceptance criteria**, and **status**.

**Priority legend**
- **P0** — security, compliance, or correctness blockers. Do this week.
- **P1** — high-impact quality/scalability work. Do this month.
- **P2** — quality-of-life, testing, docs. Do this quarter.
- **P3** — UX/product polish. Backlog.

**Tracking**: see `.kilo/agent/` todos. Update each item to `completed` (or `cancelled` with reason) when done.

---

## P0 — Do First (this week)

### 1. Rotate Brevo SMTP credentials + scrub git history + add gitleaks hook
**Why:** `.env` and `artifacts/api-server/.env` are tracked in git with a live Brevo SMTP key (`SMTP_USER=b70c97001@smtp-brevo.com`, `SMTP_PASS=REDACTED_SMTP_KEY_4e8b…`) and an `INBOUND_EMAIL_SECRET`. `.gitignore` was added *after* the secrets were committed — so they're still reachable via `git log -p`. This is a credential leak in a public-looking repo.
**Scope:**
- Generate new Brevo SMTP key; update `.env.example`, Vault/1Password, and any prod secrets.
- Remove `.env` from history using `git filter-repo --path .env --path artifacts/api-server/.env --invert-paths` (or BFG).
- Force-push; coordinate with any collaborators.
- Add `.gitleaks.toml` allowlist + a CI job that runs `gitleaks detect --redact --no-banner`.
- Add `husky` pre-commit hook running `gitleaks protect --staged`.
**Acceptance:**
- `git log -p -- .env` returns nothing.
- CI fails on a deliberately leaked secret in a test PR.
- New Brevo key confirmed working via test send.

### 2. Purge PHI files from history + gitignore `attached_assets/*`
**Why:** `attached_assets/patients_2026-07-19_copy_1785052988040.xlsx` (39 MB) and `IMG_6458_*.png` look like real patient data/PHI. For a *medical research* product, PHI in git history is a regulatory and reputational incident (HIPAA/GDPR).
**Scope:**
- Confirm with the user these are real PHI before deletion.
- `git filter-repo --path attached_assets/patients_2026-07-19_copy_1785052988040.xlsx --path attached_assets/IMG_6458_*.png --invert-paths`.
- Add `attached_assets/*.xlsx` and `attached_assets/*.png` to `.gitignore`; replace with synthetic fixtures (e.g., a 5-row anonymised sample under `attached_assets/fixtures/`).
- Document the policy in `SECURITY.md`.
**Acceptance:**
- `git log -- 'attached_assets/patients_*.xlsx'` returns nothing.
- `.gitignore` prevents future commits of xlsx/png in that dir.
- `SECURITY.md` documents the data-handling rule.

### 3. Add Vitest + supertest suite for `artifacts/api-server/`
**Why:** Main Express backend (auth, patients, records, storage, analysis) has **zero tests**. These are exactly the areas where regressions hurt most.
**Scope:**
- Add `vitest` + `supertest` + `@testcontainers/postgresql` + a MinIO testcontainer (or a local MinIO in CI).
- Cover in order: `auth` (login/2FA/lockout/CSRF), `storage` (presigned URL round-trip + SSRF blocks), `patients`, `records`, `collections`, `analysis`.
- Add `pnpm -F api-server test` script.
- Update `.github/workflows/ci.yml` to run it.
- Gate at ~60% line coverage on those routes first; ratchet up.
**Acceptance:**
- `pnpm -F api-server test` runs green in CI.
- Auth + storage + analysis have meaningful test coverage.

### 4. Default-deny CORS in api-server
**Why:** `artifacts/api-server/src/app.ts:26` reflects any origin unless `SECURE_CORS=true` or `ALLOWED_ORIGINS` is set. Combined with `SameSite=None` in production, this widens CSRF surface and relies solely on the Origin-guard middleware.
**Scope:**
- Change default to closed allowlist.
- Require `ALLOWED_ORIGINS` env (comma-separated) in production; in dev, default to `http://localhost:5173,http://localhost:9001`.
- Document the override in `.env.example`.
- Update `package.json` scripts that start the api-server to pass `ALLOWED_ORIGINS`.
**Acceptance:**
- A request with `Origin: https://evil.example` is rejected.
- Existing local + prod setups continue to work.

### 5. Convert inline DDL to Drizzle migrations
**Why:** `artifacts/api-server/src/index.ts:9-234` runs 200+ lines of `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` at startup. No migration history, no rollback, silent drift between dev and prod; the parallel D1 SQLite schema (`research/schema.sql`) makes drift worse.
**Scope:**
- Generate initial `drizzle/*.sql` migration from current schema.
- Replace `ensureAuthTables()` calls with `drizzle-orm/migrator` at startup.
- Drop the defensive `ALTER TABLE … IF NOT EXISTS` once migrations are authoritative.
- Reconcile `research/schema.sql` (D1) with `lib/db/schema/*` (Postgres) — add a CI check that compares both schemas' column lists.
**Acceptance:**
- Fresh DB bootstraps via `drizzle-kit migrate`, not inline SQL.
- `pnpm db:check` script verifies schema parity between Postgres and D1.

---

## P1 — Do This Month

### 6. Document production routing model + remove dead Worker routes
**Why:** Worker has 25 Hono routers (consent/deidentify/cohort/dicom/ml/gdpr/audit…) but also proxies `/api/*` to api-server, which doesn't mount most of those. Many Worker routes are unreachable in production.
**Scope:** Decide one source of truth per feature. Either (a) move all into api-server and remove the Worker routers, or (b) wire them through the Worker and stop proxying. Document the chosen model in `docs/architecture/routing.md`.
**Acceptance:** Every public route has one documented code path; no orphan routes.

### 7. Tighten CSRF
**Why:** Layered (Worker double-submit + api-server Origin guard), but with reflective CORS only the Origin guard stands.
**Scope:** `__Host-` prefix where feasible; `SameSite=Lax` by default; `Strict` for admin routes; explicit `Secure` in production.
**Acceptance:** Pen-test of CSRF flow passes.

### 8. Reduce JSON body limit + per-IP rate-limit
**Why:** 50 MB JSON limit (`app.ts:105`) is a DoS amp; multer accepts 50 MB on `/analysis`.
**Scope:** Tighten per-route (e.g., 1 MB JSON, 50 MB only on `/upload`). Add `express-rate-limit` per IP on `/api/auth/*` and `/api/upload/*`.
**Acceptance:** Synthetic load test stays under thresholds.

### 9. Bump OTP length or document threat model
**Why:** `OTP_LENGTH = 4` = 10 000 codes, 5 attempts. Borderline for medical data.
**Scope:** Either bump to 6 or document the threat model + lockout curve in `SECURITY.md`.
**Acceptance:** Choice made and documented.

### 10. Add Dependabot + scheduled `pnpm audit`
**Why:** You already use `minimumReleaseAge: 1440`; add a scheduled audit so CVEs surface.
**Scope:** `.github/dependabot.yml` for pnpm + GitHub Actions. `.github/workflows/audit.yml` runs weekly `pnpm audit --prod --audit-level=high`.
**Acceptance:** Audit workflow visible in Actions tab.

### 11. Split `data-analysis.tsx` (~1000 lines)
**Why:** Mixes variable list, builder, results, upload, export. `plan-spss.md §7` proposes the layout.
**Scope:** Extract `<VariableListPanel>`, `<BuilderPanel>`, `<ResultsPanel>`, `<UploadPanel>`, `<ExportPanel>` + hooks (`useAnalysisRun`, `useDataset`). Keep the page as a thin composition.
**Acceptance:** Page < 200 lines; each panel < 300.

### 12. Reconcile object-store prefix conventions
**Why:** `STORAGE.md` says `radiology-public/` + `radiology-objects/` but `.env` ships `/mednexus` + `/objects` and `research-deploy.sh` uses `/mednexus` + `/objects`. Three conventions in production code.
**Scope:** Pick one, codify in `STORAGE.md`, error out on misconfiguration.
**Acceptance:** One canonical scheme; `STORAGE.md` and `.env.example` agree.

### 13. Fix `discoverImagesByPatientId`
**Why:** `patients.ts:37-60` calls `ListObjectsV2Command` with no per-call prefix and substring/regex matches every key. Doesn't scale, risks false positives.
**Scope:** Key records as `radiology/<patientId>/<uuid>`; enforce on upload; `ListObjectsV2 Prefix=radiology/<patientId>/`.
**Acceptance:** Listing 10k objects for one patient completes in <100 ms; no false positives in tests.

### 14. OpenAPI client regeneration in CI
**Why:** `lib/api-client-react/` is generated by orval; drift between spec and client = silent bugs.
**Scope:** Add `pnpm api:gen` script. CI runs it and fails if the working tree changes.
**Acceptance:** Editing the spec without regen fails CI.

### 15. Drop unused deps + dedupe `@types/nodemailer`
**Why:** `google-auth-library` and `openai` don't appear used; `@types/nodemailer` is duplicated.
**Scope:** Remove from `dependencies`; regenerate `pnpm-lock.yaml`.
**Acceptance:** `pnpm -F api-server build` still passes; lockfile shrinks.

### 16. Tighten `tsconfig.base.json`
**Why:** `noUnusedLocals: false` + `strictFunctionTypes: false` defeat `strict: true` benefits.
**Scope:** Enable both; fix the (likely few) resulting errors.
**Acceptance:** `pnpm typecheck` passes with stricter config.

### 17. Delete legacy artifacts
**Why:** `artifacts/worker-api/` is superseded by `research/`; `research/public-legacy/` is a committed backup of an old SPA bundle; `mockup-sandbox` + `local-api` look orphaned; `research/public/**` is a build artefact committed by some flow.
**Scope:** Remove or move to an `archive/` branch. Gitignore `research/public/**`. Remove from workspace `packages`.
**Acceptance:** Repo size shrinks; build flow doesn't commit generated artefacts.

### 18. Error boundary + Sentry-style reporting
**Why:** Two frontends + Express backend log to stdout only. Medical software needs crash visibility.
**Scope:** Wrap root routes/pages in `<ErrorBoundary>`. Add `pino` + `pino-sentry-transport` for the api-server. Add `@sentry/react` to both frontends.
**Acceptance:** A thrown error in dev shows the boundary; in prod it's reported.

---

## P2 — Do This Quarter

### 19. Tests for `artifacts/research-data/`
**Why:** Only `import-filter.test.ts`. No coverage for i18n switch, theme presets, desktop window reducer, analysis page.
**Scope:** Vitest + Testing Library. Cover Ubuntu desktop reducer, RTL flip, analysis run with a fake dataset.

### 20. Tests for `research/ui/`
**Why:** `plan-spa.md §5` references `pnpm ui:test` but no test files exist.

### 21. `lib/stats` reference-value tests
**Why:** `plan-spss.md §10` asks for Student/iris reference-value tests; only 4 test files exist. SPSS accuracy is the selling point.

### 22. Playwright e2e smoke
**Why:** `.playwright-mcp/` is empty traces. One login + upload + analysis run catches config and CORS regressions across the two deployments.

### 23. Consolidate plan docs
**Why:** `plan-spa.md`, `plan-spss.md`, `step1.md`, `ubuntu-desk.md`, `update1.md`, `test3.md` are large progress logs. Only `ubuntu-desk.md` is updated to DONE.
**Scope:** Move progress to `CHANGELOG.md`; keep `plan-*.md` as decision records only. Add `STATUS.md` per package.

### 24. Fix README duplication + add `OPERATIONS.md`
**Why:** README has duplicated "Option 2" install blocks. Deploy/run steps are scattered across shell scripts.

### 25. Add CONTRIBUTING/LICENSE/SECURITY/CHANGELOG
**Why:** MIT is in `package.json` but no `LICENSE` file; no security disclosure policy; no contributor guide.

### 26. D1 in-memory LRU for read-heavy Worker routes
**Why:** Consent/IRB and audit-log reads are read-heavy.

### 27. Enforce API token scopes per-route
**Why:** `tokens.ts` defines scopes but they're not enforced per-route on the Worker side.

### 28. Fix Dockerfile/docker-compose healthcheck path
**Why:** Dockerfile healthcheck points at `/api/health`; route is `/api/healthz`.

### 29. husky + lint-staged pre-commit
**Why:** Nothing runs locally before push.

### 30. Audit `pnpm-workspace.yaml` overrides
**Why:** 45+ overrides, some undocumented.

---

## P3 — Backlog (UX/Product)

### 31. Accessibility audit
Focus traps, ARIA on Ubuntu desktop windows, RTL flip on dock/wallpaper.

### 32. Theme-preset FOUC fix
Inline `data-theme` script to avoid first-paint flash.

### 33. Virtualize analysis results tables
TanStack Table + react-virtual for large analyses.

### 34. DICOM viewer lite
Thumbnail + metadata panel (cornerstone or similar). High research value.

### 35. Cohort builder UI
`plan-spa.md` flags this as the highest research value — currently stub.

---

## Suggested execution order (this week)

1. P0.1 — rotate Brevo key + scrub history + gitleaks
2. P0.2 — purge PHI + gitignore attached_assets
3. P0.4 — default-deny CORS (small change, immediate win)
4. P0.3 — first slice of api-server tests (auth + storage)
5. P0.5 — Drizzle migrations (do this before more schema changes accumulate)

Each item is independent enough to be a separate PR. The todo list in `.kilo/agent/` tracks progress.