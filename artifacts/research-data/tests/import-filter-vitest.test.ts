import { describe, it, expect } from "vitest";
import { filterImportRows, isImportBlocked } from "../src/lib/import-filter.ts";

describe("import-filter (vitest)", () => {
  const rows = [
    { Diagnosis: "Trauma fracture of the wrist" },
    { Diagnosis: "Medical follow-up" },
    { Diagnosis: "  TRAUMA wound review " },
    { Diagnosis: "" },
    { Diagnosis: "Unrelated" },
  ];

  it("matches partial keywords case-insensitively", () => {
    const result = filterImportRows(rows, {
      enabled: true,
      filters: [{ column: "Diagnosis", keywords: ["fract", "trauma"] }],
    });
    expect(result).toEqual([rows[0], rows[2]]);
  });

  it("matches any of multiple keywords and excludes empty values", () => {
    const result = filterImportRows(rows, {
      enabled: true,
      filters: [{ column: "Diagnosis", keywords: ["medical", "wound"] }],
    });
    expect(result).toEqual([rows[1], rows[2]]);
  });

  it("returns all rows when no filters are set", () => {
    const result = filterImportRows(rows, {
      enabled: true,
      filters: [],
    });
    expect(result).toEqual(rows);
  });

  it("returns all rows when import is disabled (preserves existing behavior)", () => {
    const result = filterImportRows(rows, {
      enabled: false,
      filters: [{ column: "Diagnosis", keywords: ["fract"] }],
    });
    expect(result).toEqual(rows);
  });

  it("isImportBlocked returns true when missing required fields", () => {
    expect(
      isImportBlocked({ missingRequiredCount: 1, filterConfigured: false, matchingRowCount: 10 }),
    ).toBe(true);
  });

  it("isImportBlocked returns true when filter configured but no matching rows", () => {
    expect(
      isImportBlocked({ missingRequiredCount: 0, filterConfigured: true, matchingRowCount: 0 }),
    ).toBe(true);
  });

  it("isImportBlocked returns false when all good", () => {
    expect(
      isImportBlocked({ missingRequiredCount: 0, filterConfigured: true, matchingRowCount: 5 }),
    ).toBe(false);
    expect(
      isImportBlocked({ missingRequiredCount: 0, filterConfigured: false, matchingRowCount: 5 }),
    ).toBe(false);
  });
});
