# Step 1 — Patient Record & Data Collections

## Goal
Reframe the app around **Data Collections** (each a named dataset with its own schema):
- **Collection A** = the current `patients` table (schema + existing rows).
- **Collection B, C, …** = new collections created by uploading/defining a new table.
- Each collection can be **Activated**; the **Patient Directory** renders the active collection's records.

This reuses the existing records infrastructure (`record_definitions` + `records` JSONB) rather than creating physical SQL tables per collection.

## Data Model
- `record_definitions` (id, userId, name, fields JSON, shared) = a Data Collection's schema.
- `records` (id, userId, definitionId, data JSONB) = a row in a collection.
- `record_images` (id, recordId, fieldKey, objectKey) = S3-backed images.
- **Active** = a single active definition, stored as `isActive` on `record_definitions` (or a user pref). Directory loads the active definition's records.

## Pages
1. **Collections page** (`/collections`, rebrand of old `/records` hub)
   - Lists Data Collections (cards: name, #records, field summary, Active badge).
   - **New Collection** tab/button → define fields manually OR upload Excel/CSV (columns → schema, rows → records).
   - **Activate** button per collection.
   - Edit/delete collection, manage fields.
2. **Patient Directory** (`/patients`)
   - Renders the **active collection's** records as a table (columns from its `fields`).
   - Search/filter; shows which collection is active + a switcher.
   - For active = Collection A, this is the familiar patient directory (with import/export).

## Backend
1. Ensure `record_definitions`, `records`, `record_images` tables exist (runtime `ensureAuthTables()` or migration).
2. **Seed Collection A**: script reads `patients`, creates a `record_definitions` row named "Patients" with `fields` = patient columns, and inserts each `patients` row as a `records` row (radiology images → `record_images`). Mark it shared + active.
3. **Active flag**: add `isActive` to `record_definitions`; `PATCH /api/records/definitions/:id/activate` sets it and clears others (within shared scope).
4. **Generic import**: `POST /api/records/definitions` (create collection from schema) + `POST /api/records/:definitionId/import` (upload file → rows).
5. Keep per-definition CRUD, search, CSV/Excel export.

## Frontend
- Rebrand `records.tsx`/`record-list.tsx` → **Collections** page (collections list + New Collection tab + Activate).
- `lib/records.ts`: add `activateDefinition`, `importRecords`, `getActiveDefinition`.
- Patient Directory (`patients.tsx`): load active definition's records; render dynamic table from `fields`; keep import/export for Collection A.
- `App.tsx`: `/collections` → Collections page; `/patients` → active collection directory.
- `layout.tsx`: nav "Records" → `/collections`.

## Migration
- One-time seed: `patients` → Collection A definition + records. Existing patient data becomes the default active collection.

## Verification
- `pnpm typecheck`; manual: open Collections → see Collection A (seeded) → Activate → Directory shows patient data → create Collection B via upload → Activate B → Directory shows B → export/import per collection.
