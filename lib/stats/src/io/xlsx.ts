import * as XLSX from "xlsx";
import type { TabularData, Cell, VariableMeta } from "../types";
import { inferDataType, inferMeasure } from "../dataset";
import { parseCsv } from "./csv";

function toCell(raw: unknown): Cell {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") return Number.isNaN(raw) ? null : raw;
  const s = String(raw).trim();
  if (s === "" || s.toLowerCase() === "na" || s.toLowerCase() === "null") return null;
  const num = Number(s);
  return !Number.isNaN(num) && s !== "" ? num : s;
}

export function tabularFromArrays(
  headers: string[],
  rows: Cell[][],
): TabularData {
  const variables: VariableMeta[] = headers.map((name) => {
    const col = rows.map((r) => r[headers.indexOf(name)]).filter((c) => c !== null);
    const dataType = inferDataType(col);
    return { name, dataType, measure: inferMeasure(dataType) };
  });
  return { variables, rows };
}

export function tabularFromCsv(text: string): TabularData {
  const { headers, rows } = parseCsv(text);
  const cells = rows.map((r) => r.map((c) => toCell(c)));
  return tabularFromArrays(headers, cells);
}

export function tabularFromXlsx(buffer: Uint8Array): TabularData {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Workbook has no sheets.");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  if (aoa.length === 0) return { variables: [], rows: [] };
  const headers = (aoa[0] as unknown[]).map((h, idx) =>
    String(h ?? "").trim() || `Column${idx + 1}`,
  );
  const dataRows = aoa.slice(1).map((r) =>
    headers.map((_, j) => toCell((r as unknown[])[j])),
  );
  return tabularFromArrays(headers, dataRows);
}

export function tabularToXlsxBytes(data: TabularData): Uint8Array {
  const aoa = [
    data.variables.map((v) => v.name),
    ...data.rows.map((r) => r.map((c) => (c === null ? "" : c))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dataset");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
