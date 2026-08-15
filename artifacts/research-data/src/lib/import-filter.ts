export type ImportFilterRule = {
  column: string;
  keywords: string[];
};

export type ImportFilterOptions = {
  enabled: boolean;
  filters: ImportFilterRule[];
};

/**
 * Return only rows that match every configured filter rule. Within one rule,
 * a row may match any keyword. Matching is case-insensitive substring matching.
 *
 * When filtering is not fully configured, the original rows are returned so
 * the existing import behavior remains unchanged.
 */
export function filterImportRows(
  rawRows: Record<string, string>[],
  options: ImportFilterOptions,
): Record<string, string>[] {
  const filters = options.filters
    .map((filter) => ({
      column: filter.column.trim(),
      keywords: filter.keywords
        .map((keyword) => keyword.trim().toLocaleLowerCase())
        .filter(Boolean),
    }))
    .filter((filter) => filter.column && filter.keywords.length > 0);

  if (!options.enabled || filters.length === 0) {
    return rawRows;
  }

  return rawRows.filter((row) => {
    return filters.every((filter) => {
      const value = String(row[filter.column] ?? "").trim().toLocaleLowerCase();
      return value.length > 0 && filter.keywords.some((keyword) => value.includes(keyword));
    });
  });
}

export function isImportBlocked(options: {
  missingRequiredCount: number;
  filterConfigured: boolean;
  matchingRowCount: number;
}): boolean {
  return options.missingRequiredCount > 0
    || (options.filterConfigured && options.matchingRowCount === 0);
}