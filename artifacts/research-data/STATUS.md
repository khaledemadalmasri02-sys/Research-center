# research-data frontend — Status

The React 19 + Vite 7 SPA shipped to the public Worker. Includes
the Ubuntu-style desktop mode, the analysis workspace, the
patient records UI, the Excel import flow, the Remotion product
tour, and the voice-dictation textarea.

## What works

- **Auth flow**: login, signup request, 2FA OTP, session refresh.
- **Patient records**: CRUD, custom field definitions, image
  upload (via the api-server's presigned URL flow), search,
  import (CSV/XLSX/SAV), export.
- **Analysis workspace**: 14 analysis types, chart builders
  (histogram, scatter, bar), variable palette, run history.
- **Desktop mode**: draggable / resizable windows, animated
  wallpaper, dock, right-click context menus.
- **Internationalisation**: English + Arabic, full RTL flip.
- **Accessibility**: skip-to-content, live region, keyboard
  navigation.
- **Theming**: 5 colour presets, persisted preference.
- **Error boundary + crash reporter** (P1.18): render-time
  errors are caught, the user sees a recoverable error UI, and
  the crash is sent to `/api/crash-report`.

## What doesn't (yet) work

- **No component tests**: the test runner (Node `--test` +
  `--experimental-strip-types`) only handles pure modules
  (no jsdom / React Testing Library set up). Component-level
  coverage would need a Vite-based vitest run with React
  Testing Library.
- **i18n coverage** is partial — many error messages are
  English-only. The `language-switcher.tsx` works but the
  `ar.ts` / `en.ts` files don't cover all keys.
- **Cohort builder**: plan-spa.md §7 calls for a multi-criteria
  cohort builder; the Worker has the `cohort` route but the
  frontend UI is still stub.
- **DICOM viewer**: the worker has DICOM metadata extraction
  but the frontend doesn't have an in-browser viewer.

## Known issues (documented in tests)

- **`Pt` miscorrection**: see `STATUS.md` in
  `artifacts/api-server/`.

## Tests

- 50 tests in 5 files, all passing.
- `pnpm -C artifacts/research-data test` (or
  `cd artifacts/research-data && pnpm test`).
- CI: `test-research` job runs `pnpm -C artifacts/research-data
  pnpm run test` after the build step.

## Build / deploy

- `pnpm -C artifacts/research-data typecheck` (clean, with
  `noUnusedLocals: false` for now).
- `pnpm -C artifacts/research-data build` → `dist/public/` →
  copied to `research/public/` by `scripts/research-deploy.sh`.

## Where to start

- New to the frontend? Start with
  [`src/App.tsx`](src/App.tsx) for the top-level providers and
  route table, then [`src/pages/`](src/pages/) for the page
  components.
- Adding a new page? Drop it in `src/pages/`, add a route in
  `src/components/desktop/app-registry.tsx` (desktop mode)
  and `src/App.tsx` (classic mode).
- Adding a new analysis? Edit
  [`src/pages/data-analysis/`](src/pages/data-analysis/) — see the
  per-panel files (AnalysisBuilder, VariablePalette, etc.) added
  in P1.11.
