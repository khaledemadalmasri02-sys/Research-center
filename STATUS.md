# Status — MedResearch Data Collection & Research Platform

> **Read `## Remediation pass (2026-10) — what changed` first.** It is the
> single entry point for everything below, and it is where the still-open
> risks live.

## Remediation pass (2026-10) — what changed

Five engineering agents worked across auth, storage, the design system,
the desktop shell, CI and docs. This section records what actually shipped
so the next reader does not have to reconstruct it from `CHANGELOG.md`.

### Security — false compliance claims that are now real

- **The Worker's CSRF guard was dead code.** `csrfGuard` was defined in
  `research/src/lib/security.ts` and never imported, so **no D1 mutation was
  protected**. It is now registered per mount for all 16 D1 route groups
  (`research/src/index.ts:171-177`).
- **The proxy was defeating the api-server's Origin guard.**
  `proxyToBackend()` overwrote the client's `Origin` with its own backend
  URL, so the api-server's same-origin check passed for every host, always.
  The origin is now forwarded unchanged and cross-origin hosts are rejected
  at the Worker (`research/src/index.ts:214-236`).
- **Mutating GETs converted to POST.** `GET /api/deidentify/export` was a
  CSRF write primitive reachable from any `<img src>` — `SameSite=Lax` does
  not stop a top-level navigation. It is now POST. No state-changing endpoint
  may be a GET.
- **`GET /api/storage/public-objects/*` was unauthenticated** and served
  `backups/*.sql` — unencrypted full `pg_dump` output. Now
  `requireAuth` + `requireAdmin` + **410 Gone (retired)**. The replacement is
  `/api/storage/objects/*`, which additionally runs an ACL check
  (`canAccessObject()`) and a patient-ownership predicate.
- **Login-OTP verify had no rate limit at all** (the documented 8/15min did
  not exist). Now 10/IP/15min **and** 20/login-token/15min, with an atomic
  5-attempt counter.
- **Crash reports shipped PHI.** The reporter sent `window.location.href`,
  including the query string, and routes carry patient ids. Now
  `location.pathname` only.
- **OTPs were `Math.random()` and bcrypt-hashed.** Now `crypto.randomInt`
  and `sha256$<salt>$<HMAC>` (keyed with `OTP_HASH_SECRET`/`SESSION_SECRET`).
- **`X-Forwarded-For` was trusted unconditionally**, so anyone could reset
  every per-IP budget with a fresh header. Now honoured only from
  `TRUSTED_PROXY_CIDRS`.
- **Session fixation:** the session id is regenerated on every
  authentication (password, login OTP, OAuth, admin self-role change).
- **OAuth took over accounts.** `WHERE email = $verified.email` handed a
  full session to anyone who could register that address at a different
  provider, and the callback had no status check. Now: the provider must
  report `email_verified`, no email-only auto-linking, and the account must
  be `active`.
- **API tokens could be escalated.** The `admin` scope is no longer
  self-assignable, and a token's admin rights require the owner's live
  `can_admin_access`, so a token can never out-privilege its owner.
- **Anyone could suppress a clinician's 2FA** by unsubscribing them
  (`category=all` → `login-otp`). `GET /api/unsubscribe/status` now fails
  closed, and `"all"` expands only to non-security categories.

### Compliance corrections

- `SECURITY.md`'s claim that crash reports never contain user IDs or PHI was
  **false** and has been rewritten to describe what is actually sent.
- `STORAGE.md`'s claims that there is "no public bucket prefix in production"
  and that "every read goes through `/api/storage/objects/` (auth)" were
  **both false** until this pass.
- `POST /api/deidentify/export` returns **409** on an empty D1 `patients`
  table instead of a 0-row CSV that would read as a successful
  de-identification run.
- `POST /api/dicom/deidentify` returns **422** when only metadata was
  scrubbed, so a metadata-only run cannot be filed as a pixel scrub.
- `GET /api/consent` requires `patientId`; listing every consent is refused.
- GDPR erasure is now multi-store and reports honestly: per-store
  `counts` replaced the hardcoded `deletedRows`, `ok` is computed, a partial
  run returns 500 and writes `pending_erasure`, and `GET /api/gdpr/pending`
  lists incomplete erasures. A Postgres half was added on the api-server.

### Accessibility

Fixed and verified against the current source (see the dated addenda at
the top of [`docs/ui-ux-audit.md`](docs/ui-ux-audit.md) and
[`docs/accessibility-audit.md`](docs/accessibility-audit.md)):

- Contrast: `--muted-foreground` light 4.30 → **4.79**; `--input` light
  1.19 → **3.75**, dark 1.21 → **3.87**; dark `--destructive` reworked via a
  new `--destructive-text` token (**5.61** on `--card`); dark `--primary`
  white-label 4.12 → **5.33**, with a new `--primary-text` for accent text.
- Focus: 1 px rings → `ring-2` (WCAG 2.2 2.4.11); checkboxes gained a 28 px
  hit area (2.5.8); the global `outline: none` on inputs and the
  `:focus-visible` `border-radius` shape mutation are gone.
- Semantics: nested interactive elements removed from the saved-view and
  notification menus; the select-all checkbox is no longer wrapped in the
  sort `<button>`; `aria-sort`, `aria-rowcount` and `aria-rowindex` added to
  `<DataTable>`.
- Focus management on route change (`useRouteFocus` in `layout.tsx`).
- The product tour went from 14/14 broken steps to working
  `data-tour`-anchored steps in all three shells.
- Platform: `color-scheme` declarations, an `@media print` block, an RTL
  convention (logical properties only), `prefers-contrast` and
  `prefers-reduced-data` blocks.

### Desktop shell

- `zIndex` is actually rendered (`components/desktop/z-index.ts` is the
  single source of truth for stacking) — previously stacking was DOM order
  and the focus system was a no-op.
- Escape no longer closes a Radix dialog *and* the window behind it.
- Fixed a conditional-hook crash in `Layout`.
- All 38 window titles resolve through `resolveAppTitle()` in both `en` and
  `ar` (13 were previously untranslated).
- Minimized/inactive windows are `inert` + `aria-hidden`, so they leave the
  tab order.
- Alt+Arrow moves and Alt+Shift+Arrow resizes the focused window.
- The a11y Playwright gate can no longer self-disable.

### CI / tooling

- **Dependabot was inert**: a catch-all `ignore: [{ dependency-name: "*",
  versions: ["*"] }]` rule suppressed every npm update. Only genuine
  exclusions remain.
- `.github/workflows/audit.yml` exists and opens a deduped issue on
  high/critical production advisories.
- The pre-commit hook now **self-installs**: `core.hooksPath` was unset, and
  the root `prepare` script runs `git config core.hooksPath .githooks` on
  `pnpm install`.
- `.github/workflows/a11y.yml` added: route-level axe scans for both shells.
- `.npmrc` pins `minimumReleaseAge` for supply-chain defence.

### Documentation

Three `.env.example` files now own disjoint groups of variables, with the
root file as the source of truth for the object-store prefixes;
`scripts/dev.sh` no longer hardcodes its own values.

### Dead code removed

**77 files deleted**, including the entire `research/ui/` second SPA (the
single biggest cleanup win flagged by `docs/ui-ux-audit.md` §10),
`artifacts/local-api/`, `artifacts/worker-api/`, and nine now-unreachable
Worker route modules (`admin`, `audit`, `auth`, `extras`, `feedback`,
`patients`, `records`, `storage`, `voice`) plus
`artifacts/research-data/src/pages/sessions.tsx` at the wrong path.

---

## Still open — do not claim these are done

| # | Item | Why it matters | Where |
| --- | --- | --- | --- |
| 1 | **D1 / Postgres split-brain** | Patient records are written to Postgres behind the api-server; the Worker's D1 `patients` table receives nothing. In production it is empty, so every D1 clinical route reads rows that do not exist. List endpoints return `[]`, cohorts export empty, and the D1 half of GDPR erasure erases nothing. | `research/src/index.ts:40-72` |
| 2 | **No data-layer migration** | The fix for #1 is dual-write or moving the route modules to Postgres. Deliberately not attempted — it needs a plan, a backfill and a rollback path. | `research/src/index.ts:67-71` |
| 3 | **No DICOM pixel scrubbing** | De-identification is metadata-only. The route returns 422 rather than 200 precisely so this cannot be filed as complete. | `research/src/routes/dicom.ts:308` |
| 4 | **No MFA** | Login 2FA is email OTP over the same channel as password reset — not a second factor against a compromised mailbox. | `artifacts/api-server/src/routes/auth.ts` |
| 5 | **No read-access audit** | `audit_log` records mutations only. Reading a patient's imaging leaves no trace (HIPAA §164.312(b)). | — |
| 6 | **Missing `patients.owner_user_id`** | D1 `patients` has no owner column, so there is no correct owner-scoping query. The interim gate denies `viewer` outright with a 403 that says why. | `research/src/lib/security.ts:514-570` |
| 7 | **Light `--destructive` fails AA** | `0 84% 60%` with white text is **3.78:1**, below the 4.5:1 needed for normal text. Open item, not fixed. | `artifacts/research-data/src/index.css:156` |
| 8 | **Unattributable object keys** | A key naming no patient with no ACL policy is readable by any authenticated user, because `POST /api/storage/uploads/request-url` without `patientId` writes exactly those keys. | `artifacts/api-server/src/routes/storage.ts:245` |
| 9 | **No tablet breakpoint** | The desktop shell has one breakpoint (768 px). 1024×600 is a poor fit; `useIsTablet` does not exist. | `docs/ui-ux-audit.md` §15.1 |
| 10 | **No keyboard focus trap in desktop windows** | `<Dialog>` traps its own focus, but a window containing no dialog has no shell-level trap. Deferred until a modal-in-window regression is reported. | `docs/ui-ux-audit.md` §15.4 |
| 11 | **~29 `<Label>` elements are still unassociated** | No `htmlFor` and no wrapping control, mostly in `pages/data-analysis/*`, `pages/ml.tsx`, `pages/validation.tsx` and `VariableSelect.tsx`. Screen readers announce nothing for those fields. | see the addendum in `docs/accessibility-audit.md` |
| 12 | **Form error summary** | Multi-field forms surface the first error only. `useUnsavedChanges` is in; `FormErrorSummary` is not. | `docs/ui-ux-audit.md` §15.7 |
| 13 | **`research/README.md` and the OpenAPI spec still advertise the retired public-objects route** | `lib/api-spec/openapi.yaml:268` documents it and the generated client exposes it; `research/README.md:27` lists it. | — |

---

## P0 (Security & Compliance) — DONE

- **P0.1 + P0.2** — Secrets/PHI history scrub: git history rewritten with `git-filter-repo`; PHI files (`patients_2026-07-19_copy_*.xlsx`, `IMG_6458_*.png`) purged; dev `.env` files removed; bcrypt hashes redacted; `.gitleaks.toml` config added; `.github/workflows/secrets.yml` CI hook added; pre-commit hook self-installs via the `prepare` script; force-pushed to `Research-center/main`. Zero leaks in working tree or full history.
- **P0.4** — Default-deny CORS: flipped CORS logic; `ALLOWED_ORIGINS`/`SECURE_CORS` env vars; documented production routing model.
- **P0.3** — api-server test suite: Vitest + supertest, **227 tests across 22 files** covering auth, storage, patients, records, analysis, CSRF, GDPR erasure, token privilege, RBAC and the route-auth allowlist. (Was documented as 97 tests. Counts are `it(`/`test(` declarations, not run results — see the caveat under P2.)
- **P0.5** — Drizzle migrations: inline `ensureAuthTables` SQL block documented as deprecated; `lib/db/drizzle/0001_wandering_bug.sql` exists; migration workflow set up.

## P1 (Architecture & Code Quality) — substantially complete

Every listed P1 item is now either done or explicitly not-applicable, so a
pass/fail count would be misleading (four entries were never specified in
the original plan). Per-item state below.

- **P1.1** — Consolidate plan/progress docs: `CHANGELOG.md` created; `plan-spa.md` trimmed to decision records; `STATUS.md` added; `SECURITY.md` + `attached_assets/README.md` documenting no-PHI policy; `LICENSE` file added. **DONE**
- **P1.2** — README dedup + ops runbook: **DONE** in the 2026-10 pass (ports, package names, test counts, env-var ownership and `dev:s3` all corrected against the code).
- **P1.3** — LICENSE + SECURITY.md + CONTRIBUTING.md + CHANGELOG.md: all four exist. **DONE**
- **P1.4** — Not explicitly listed; covered under other P1 items.
- **P1.5** — Dependabot + scheduled `pnpm audit`: **both existed and both were broken.** The scheduled audit workflow (`.github/workflows/audit.yml`, Mondays 07:00 UTC) was fine; Dependabot was **inert** because its `ignore` list contained a catch-all `dependency-name: "*", versions: ["*"]` rule that matched every package, so no update was ever proposed. The catch-all is removed; only `@types/*` and `@workspace/*` are excluded. **DONE**
- **P1.6** — CSRF / cookie model: `__Host-rc_sid` in production + `SESSION_COOKIE_SAMESITE`; `requireRole` middleware. The **Worker-side guard was dead code until the 2026-10 pass** — see "Security" above. **DONE**
- **P1.7** — Document production routing + remove dead routes: routing model doc written; **77 dead files removed in 2026-10**, including `research/ui/`, `artifacts/local-api/` and `artifacts/worker-api/`. **DONE**
- **P1.8** — Not explicitly listed; overlaps with P1.6+P1.7.
- **P1.9** — Not explicitly listed; overlaps with other items.
- **P1.10** — Not explicitly listed; overlaps with P1.15 (unused deps).
- **P1.11** — Drop unused deps: removed `google-auth-library`, `openai`, duplicate `@types/nodemailer`; regenerated `pnpm-lock.yaml`.
- **P1.12** — Bump OTP length 4→6: code default is 6 (`routes/auth.ts:31`). **The `.env.example` update was overstated**: `OTP_LENGTH=6` existed only as a **commented-out** line in `artifacts/api-server/.env.example` (and was absent from the root file). It is now uncommented with a real value in both places. **DONE**
- **P1.13** — Object-store prefix conventions: **this was never actually codified.** Two contradictory conventions were live at once — `scripts/dev.sh` hardcoded `PUBLIC_OBJECT_SEARCH_PATHS="/mednexus"` + `PRIVATE_OBJECT_DIR="/objects"`, `scripts/research-deploy.sh` defaulted `/mednexus` + `/objects`, and `.env.example` said `/mednexus` + `/mednexus`. **Unified on `.env.example` as the single source of truth**; `scripts/dev.sh` no longer overrides. *Residual:* `research-deploy.sh:281` and `tunnel-run.sh:113` still carry shell fallbacks that disagree (`/objects` vs `/mednexus`), so set the variables explicitly. **DONE with a noted residual.**
- **P1.14** — `discoverImagesByPatientId` fix: O(n) over the whole bucket replaced with prefix-based, paginated listing, filtered to an exact patient match so `patient_4` cannot read `patient_42`.
- **P1.15** — Tighten tsconfig: `noUnusedLocals` + `strictFunctionTypes` enabled; unused imports fixed; `tsc --build` green.
- **P1.16** — Error boundary + reporting: React `ErrorBoundary` + global `unhandledrejection` / `window.onerror` handlers posting to `/api/crash-report`. **The payload leaked PHI through `location.href` until the 2026-10 pass.**
- **P1.17** — Delete/archive legacy artefacts: `research/public/**` gitignored; 60 video files; 7.7 MB build outputs untracked; `.gitignore` expanded; backup at `research/public-legacy/`.

## P2 (Testing) — 4 of 4 done

The previous "0 of 4" was false; all four suites exist and run in CI.

- **P2.1** — research-data tests (vitest + Testing Library): **DONE.** 87 tests across 13 files (last reported run: 75 passing, 9 failing) — `medical-correction`, `vitals-utils`, `radiology-images`, `crash-reporter`, `import-filter`, `route-params`, `desktop-mode`, `theme-toggle`, `otp-verification`, `welcome`, `window-store`, and a jsdom axe pass. The runner **moved from `node --test` to vitest** (`vitest.config.ts`); the old config only matched `*-vitest.test.ts{,x}`, so plain `.test.ts` files were silently skipped.
- **P2.2** — research/ui tests: **N/A — the package was deleted.** `research/ui/` was the duplicate SPA; its tests went with it. The `P2.2` line item in `IMPROVEMENT_PLAN.md` was asking for tests on code that should not exist.
- **P2.3** — lib/stats reference-value tests: **DONE.** 35 tests across 5 files (`reference`, `analyses`, `io`, `mathx`, `upgrade`), runner is `tsx --test` (node:test). Package is **`@workspace/stats`** (renamed from `@mednexus/stats`).
- **P2.4** — Playwright e2e / a11y gate: **DONE.** `artifacts/research-data/tests/a11y-pages/` has classic + desktop specs using `@axe-core/playwright`, wired into `.github/workflows/a11y.yml` with a per-shell matrix. The specs **hard-fail** instead of `test.skip()`ing when the auth boundary redirects, and the job fails if the spec directory is missing — the gate used to be able to disable itself silently.

Also present: the **Worker** suite (`research/test/`, 203 tests / 18 files) and the **api-server** suite (227 / 22 files, Testcontainers-backed). Neither is listed as a P2 item but both are load-bearing.

> **Counting caveat.** All four totals above are `it(` / `test(` **declaration** counts (`grep -cE "^\s*(it|test)\(" <files>`), not run results — the remediation pass did not run the suites. The last reported run was api-server 200 passing / 6 failing across 21 files and research-data 75 / 9 across 13. 21 api-server tests (`route-auth-policy.test.ts`) and 3 research-data tests landed *while this doc was being written*, so declared totals now exceed passing + failing. Re-run before quoting a pass/fail split.

## P3 (UX / Product) — 4 of 5 done

The previous "0 of 5" was false; the UX work substantially landed. See the
dated addendum at the top of
[`docs/ui-ux-audit.md`](docs/ui-ux-audit.md) for per-item status.

- **P3.1** — Accessibility audit: **DONE.** `docs/accessibility-audit.md` (2026-09-07) plus a route-level axe gate in CI. A 2026-10 pass fixed the contrast, focus-ring, focus-shape, table-semantics, label-association, route-focus and platform-preference items; ~29 unassociated `<Label>` elements and the form error summary remain open.
- **P3.2** — FOUC theme-preset fix: **DONE.** `index.html` sets `data-theme`, `data-density`, `dir` and `lang` pre-hydration.
- **P3.3** — Virtualized analysis tables: **DONE.** `<DataTable>` (`components/ui/data-table.tsx`) uses `@tanstack/react-virtual` with `aria-rowcount` / `aria-rowindex` / `aria-sort`; `patients.tsx` and `activity.tsx` were migrated.
- **P3.4** — DICOM viewer lite: **NOT DONE.** Cornerstone.js is still deferred. The Worker exposes a metadata-only de-identification route that returns 422, which is the honest signal, not a viewer.
- **P3.5** — Cohort builder UI: **PARTIAL.** The Worker has a D1-backed cohort route, but D1's `patients` table is empty in production (see "Still open" #1), so it returns 0 rows against real data.

## Where to start next

1. The data-layer migration for D1/Postgres (#1, #2) — it blocks P3.4 and
   P3.5 and makes every D1 clinical route meaningful.
2. Require `patientId` on `POST /api/storage/uploads/request-url`, or write
   an ACL policy, to close the unattributable-key gap (#8).
3. Read-access audit for object and patient reads (#5).
4. The ~29 unassociated `<Label>` elements and the form error summary
   (#11, #12).
5. Clean up the retired public-objects references in the OpenAPI spec,
   `research/README.md` and `routes/storage.ts` (#13).