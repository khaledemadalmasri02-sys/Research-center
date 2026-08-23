# Plan — React SPA Integration (research worker)

> **Problem:** `research/public/` contains a *built* React + Vite SPA (the
> `artifacts/research-data` app), but its **source is not in the repo**. The
> SPA has pages for patients/records/admin/feedback/activity/etc., yet **none of
> the new research-grade feature APIs** we built on the D1 worker
> (consent/IRB, de-identification, cohort + codebook, validation rules, DICOM,
> FHIR/HL7 export, studies/sites, ML provenance, PDF/GDPR, audit, search +
> saved views) are surfaced in the SPA. They are only reachable via standalone
> HTML pages (`consent.html`, `deidentify.html`, `dicom.html`) or raw JSON.
>
> **Goal:** Re-establish the SPA **source**, integrate every worker feature API
> into a cohesive, RBAC-aware, i18n/RTL/dark-mode SPA, and build it into
> `public/` so Cloudflare Assets serves it unchanged (`not_found_handling =
> "single-page-application"`, `run_worker_first = ["/api/*"]` already set).

---

## 1. Toolchain & layout

- New app at **`research/ui/`** — Vite + React 18 + TypeScript + Tailwind,
  react-router-dom, TanStack Query, i18next (+ react-i18next), next-themes.
- `research/ui/vite.config.ts` → `build.outDir = "../public"` (and
  `emptyOutDir: true`) so `wrangler` needs **no config change**.
- `research/package.json` gets `ui:dev`, `ui:build`, `ui:preview`, `ui:typecheck`
  and the UI deps. The worker remains a separate build (`tsc`/`wrangler`).
- **Back up** the current built bundle to `research/public-legacy/` before the
  first `ui:build`, so a regression is recoverable.

## 2. Core infrastructure (build first, then port)

1. **`ui/src/lib/api.ts`** — fetch wrapper:
   - `credentials: "include"` (session cookie set by `/api/auth/login`).
   - Bearer token from `localStorage` when present (API-token users).
   - On mutations, lazily `GET /api/csrf` once, cache the token, and send
     `X-CSRF-Token` (satisfies `csrfGuard` on the proxied backend).
   - Normalized error shape (`{error, status}`).
2. **`ui/src/auth/`** — `AuthProvider` + `useAuth()` (login/logout/me),
   `canEdit(user)`, `canAdmin(user)` mirroring `security.ts` RBAC.
3. **`ui/src/components/layout.tsx`** — responsive sidebar + top bar with:
   dark-mode toggle, language switcher (EN/AR), user menu, role-gated nav,
   "Activity" (admin) and "My Activity" links.
4. **`ui/src/i18n/`** — `en` + `ar`; set `dir="rtl"` on `<html>` for AR.
   `ui/src/index.css` carries light/dark CSS variables (matches current theme).
5. **UI primitives** — `Button`, `Card`, `Input`, `Select`, `Textarea`, `Tabs`,
   `Table`, `Badge`, `Skeleton` (names mirror the existing bundle components for
   visual parity).

## 3. Page → API → RBAC mapping

Existing pages to **port** (preserve current behavior): Home, Patients, Records
(+ detail / definition-edit / new), Radiology images, Admin (users/feedback/
system), Feedback, Activity, Activity/me, API tokens, Sessions, Login, Signup,
Database viewer, Not-found.

New feature pages to **add** (APIs already implemented & tested on the worker):

| Route              | API (worker)                                  | RBAC        | Notes |
|--------------------|-----------------------------------------------|-------------|-------|
| `/consent`         | `/api/consent/*`                              | auth/editors | list, sign/withdraw, templates + protocols |
| `/deidentify`      | `/api/deidentify/*`                           | editor+     | pseudonym + de-id CSV export |
| `/cohort`          | `/api/cohort/*`                               | auth        | builder, CSV + codebook, stats |
| `/validation`      | `/api/validation/*`                           | auth/editor | list/create/delete rules, validate |
| `/dicom`           | `/api/dicom/*`                                | auth/editor | metadata, studies, de-identify |
| `/export`          | `/api/export/fhir`, `/api/export/hl7`         | auth        | download FHIR bundle / HL7 msg |
| `/studies`         | `/api/studies/*`                              | auth/editor | studies, sites, arms, dashboard |
| `/ml`              | `/api/ml/*`                                   | auth/editor | models, predictions, eval metrics |
| `/reports`         | `/api/reports/patient/:id/pdf`                | auth        | CRF PDF download |
| `/gdpr`            | `/api/gdpr/erasure`, `/api/gdpr/retention`    | admin       | erasure + retention candidates |
| `/audit`           | `/api/audit`, `/api/audit/me`                 | admin/auth  | global + personal timelines |
| `/search`          | `/api/search`, `/api/saved-views`             | auth        | search + save/load views |

## 4. Rollout phases

- **Phase 0 — Scaffold & build:** Vite app builds into `public/`; verify the
  shell loads and existing routes resolve. Keep `public-legacy` backup.
- **Phase 1 — Core infra:** api client, auth context, layout, i18n, theme,
  primitives.
- **Phase 2 — Port existing pages** into the new source (behavior-preserving).
- **Phase 3 — Add new feature pages** area-by-area (one per commit), each with a
  nav entry, RBAC guard, and loading/empty/error states. Replace the three
  standalone HTML pages (`consent.html`, `deidentify.html`, `dicom.html`) with
  SPA routes (or 301-redirect the HTML files to the routes).
- **Phase 4 — Polish:** mobile bottom-nav, a11y pass, wire CSRF on all
  mutations, verify against `wrangler dev --local` (assets + /api proxy + D1
  routes all functioning).

## 5. Verification gate

- `pnpm ui:typecheck` (tsc) and `pnpm ui:build` → emits `public/`.
- `pnpm ui:test` (vitest + RTL) for components/integration where practical; the
  **97 backend API tests already cover the endpoints**.
- Manual smoke of every new page; `wrangler dev` to confirm the SPA loads,
  `/api/*` still proxies to the backend, and the D1 feature routes are served
  (they take precedence over the catch-all proxy).

## 6. Risks & mitigations

- **Stale bundle replacement:** back up to `public-legacy/`; roll out behind the
  existing `index.html` only after the shell + ported pages are verified.
- **Auth scheme:** support both session-cookie (login → cookie) and Bearer
  (API tokens); always send `X-CSRF-Token` on mutations.
- **Standalone HTML pages** become redundant — redirect or remove after the
  equivalent SPA routes ship.

## 7. Out of scope

- Re-implementing backend logic (already done & tested).
- Changing `wrangler.toml` (Assets config already correct).
- Full ICD-10/SNOMED terminology import (seed subset already present).

---

## 8. Progress log

### Done (Phase 0 + 1 + first feature pages)
- Scaffolded `research/ui/` (Vite + React 18 + TS + Tailwind + react-router).
  Builds into `research/public/` (`emptyOutDir: true`) — replaces the stale
  built bundle. `wrangler.toml` unchanged.
- Backed up the old built bundle to `research/public-legacy/` (60 files) before
  the first build, so it is recoverable.
- Core infra: `lib/api.ts` (session cookie + Bearer + `X-CSRF-Token`),
  `auth/AuthContext.tsx` (RBAC `canEdit`/`canAdmin`), `i18n.tsx` (en/ar + RTL),
  `Layout.tsx` (role-gated sidebar, lang switch, logout), `components/ui.tsx`
  (Button/Card/Input/Select/Textarea/Tabs/Table/Badge/Skeleton).
- Routing in `App.tsx` with `RequireAuth` and all 16 nav routes.
- **Functional pages:** `Consent` (templates, sign, withdraw) and `Deidentify`
  (pseudonym + CSV export). Both call the live worker APIs.
- **Stub pages** (wired, render via `Placeholder`, to be filled in later
  phases): Cohort, Validation, DICOM, Export, Studies, ML, Reports, GDPR, Audit,
  Search, Admin, Activity/My Activity. Plus Home/Login/Signup/NotFound.

### Verification
- `npm --prefix ui run build` → emits `public/index.html` + `assets/*` +
  copies `ui/public` (favicon/manifest/robots). **Exit 0.**
- `npm --prefix ui run typecheck` (tsc) → **Exit 0.**
- Worker `tsc --noEmit` still **Exit 0** (SPA build only touches `public/`).
- `node scripts/check-schema.mjs` still **Exit 0** (32 tables consistent).

### Next
- Fill stub pages one-by-one (start with Cohort + Studies dashboard — highest
  research value), reusing `lib/api.ts` + primitives.
- Add TanStack Query / i18next later if desired; current minimal i18n works.
- Manual smoke via `wrangler dev` once a few more pages are real.
