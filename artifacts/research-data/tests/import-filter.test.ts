import test from "node:test";
import assert from "node:assert/strict";
import { filterImportRows, isImportBlocked } from "../src/lib/import-filter.ts";

const rows = [
  { Diagnosis: "Trauma fracture of the wrist" },
  { Diagnosis: "Medical follow-up" },
  { Diagnosis: "  TRAUMA wound review " },
  { Diagnosis: "" },
  { Diagnosis: "Unrelated" },
];

test("matches partial keywords case-insensitively", () => {
  const result = filterImportRows(rows, {
    enabled: true,
    filters: [{ column: "Diagnosis", keywords: ["fract", " trauma "] }],
  });

  assert.deepEqual(result, [rows[0], rows[2]]);
});

test("matches any of multiple keywords and excludes empty values", () => {
  const result = filterImportRows(rows, {
    enabled: true,
    filters: [{ column: "Diagnosis", keywords: ["medical", "wound"] }],
  });

  assert.deepEqual(result, [rows[1], rows[2]]);
});

test("returns all rows when filtering is disabled or incomplete", () => {
  assert.equal(
    filterImportRows(rows, { enabled: false, filters: [{ column: "Diagnosis", keywords: ["trauma"] }] }).length,
    rows.length,
  );
  assert.equal(
    filterImportRows(rows, { enabled: true, filters: [{ column: "", keywords: ["trauma"] }] }).length,
    rows.length,
  );
  assert.equal(
    filterImportRows(rows, { enabled: true, filters: [{ column: "Diagnosis", keywords: ["  ", ""] }] }).length,
    rows.length,
  );
});

test("combines separate column filters with AND logic", () => {
  const multiColumnRows = [
    { Diagnosis: "Trauma fracture", Sex: "Female" },
    { Diagnosis: "Trauma fracture", Sex: "Male" },
    { Diagnosis: "Medical condition", Sex: "Female" },
    { Diagnosis: "Medical condition", Sex: "Male" },
  ];

  const result = filterImportRows(multiColumnRows, {
    enabled: true,
    filters: [
      { column: "Diagnosis", keywords: ["trauma"] },
      { column: "Sex", keywords: ["female"] },
    ],
  });

  assert.deepEqual(result, [multiColumnRows[0]]);
});

test("blocks import when required fields or an active filter has no matches", () => {
  assert.equal(
    isImportBlocked({ missingRequiredCount: 0, filterConfigured: true, matchingRowCount: 0 }),
    true,
  );
  assert.equal(
    isImportBlocked({ missingRequiredCount: 0, filterConfigured: true, matchingRowCount: 2 }),
    false,
  );
  assert.equal(
    isImportBlocked({ missingRequiredCount: 1, filterConfigured: false, matchingRowCount: 0 }),
    true,
  );
  assert.equal(
    isImportBlocked({ missingRequiredCount: 0, filterConfigured: false, matchingRowCount: 0 }),
    false,
  );
});