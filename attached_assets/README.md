# Attached assets

Real **patient data, PHI, PII, or any non-public files** must NEVER be placed in this directory and committed to git. This is a research platform handling medical data — every commit is a potential compliance event.

## Policy

- Allowed in git (under `fixtures/`): fully synthetic, anonymised data used for tests and demos.
- Forbidden anywhere else in `attached_assets/`: real patient spreadsheets (xlsx/csv), medical images (png/jpg/dicom), or any file that could contain PHI.
- For real data during local development: place files outside the repo (e.g., `~/research-data-private/`) and reference them via an absolute path in `.env`.

## Why

`attached_assets/patients_2026-07-19_copy_*.xlsx` and `IMG_6458_*.png` were committed to history on 2025-08-13. They have since been purged with `git-filter-repo` (see `IMPROVEMENT_PLAN.md` P0.2) and the file types are now blocked by `.gitignore`. New commits will fail via the gitleaks CI check.

## How to add a test fixture

```sh
# Create a small synthetic CSV like sample-patients.csv
# Never include real names, real IDs, or real dates of visit
```

If you need larger data for a test, generate it programmatically in `scripts/` or in the test itself — do not commit bulk data.