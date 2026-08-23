/** Robust CSV parser supporting quoted fields, embedded commas/newlines, and "" escapes. */

import type { TabularData, Cell } from "../types";

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === "," || ch === ";" || ch === "\t") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop a trailing empty row caused by a final newline.
  if (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h, idx) => h.trim() || `Column${idx + 1}`);
  return { headers, rows: rows.slice(1) };
}

function csvEscape(c: Cell): string {
  if (c === null || c === undefined) return "";
  const s = String(c);
  return /",|\n/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tabularToCsv(data: TabularData): string {
  const lines = [data.variables.map((v) => csvEscape(v.name)).join(",")];
  for (const row of data.rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n");
}
