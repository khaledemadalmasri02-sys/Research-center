import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

const FIELDS = [
  "id", "patient_id", "patient_name", "age", "sex", "collection_type",
  "collection_date", "date_of_visit", "chief_complaint", "provisional_diagnosis",
  "final_confirmed_diagnosis", "final_confirmed_diagnosis_ar", "ai_prediction_output",
  "radiology_images",
];
const OPS = ["eq", "neq", "contains", "gt", "lt", "gte", "lte"];

interface Filter { field: string; op: string; value: string; }
interface Cell { rowVal: any; colVal: any; count: number; }

export default function Cohort() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filter[]>([{ field: "sex", op: "eq", value: "" }]);
  const [cohort, setCohort] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [codebook, setCodebook] = useState<{ field: string; type: string; label: string }[]>([]);
  const [rowField, setRowField] = useState("sex");
  const [colField, setColField] = useState("final_confirmed_diagnosis");
  const [cells, setCells] = useState<Cell[]>([]);
  const [error, setError] = useState("");

  const loadCodebook = () => apiGet<{ codebook: any[] }>("/api/cohort/codebook").then((d) => setCodebook(d.codebook || []));
  useEffect(() => { loadCodebook(); }, []);

  const build = async () => {
    setError("");
    try {
      const d = await apiPost<{ count: number; cohort: any[] }>("/api/cohort/build", { filters });
      setCount(d.count);
      setCohort(d.cohort || []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Build failed."); }
  };

  const exportCsv = async () => {
    setError("");
    try {
      const csv = await apiPost<string>("/api/cohort/export", { filters });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "cohort.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Export failed."); }
  };

  const stats = async () => {
    setError("");
    try {
      const d = await apiPost<{ cells: Cell[] }>("/api/cohort/stats", { rowField, colField, filters });
      setCells(d.cells || []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Stats failed."); }
  };

  const cols = cohort.length ? Object.keys(cohort[0]) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navCohort")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <h2 className="mb-2 font-medium">Filters</h2>
        {filters.map((f, i) => (
          <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
            <Select value={f.field} onChange={(e) => update(i, "field", e.target.value)}>
              {FIELDS.map((fld) => <option key={fld} value={fld}>{fld}</option>)}
            </Select>
            <Select value={f.op} onChange={(e) => update(i, "op", e.target.value)}>
              {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
            </Select>
            <Input value={f.value} onChange={(e) => update(i, "value", e.target.value)} placeholder="value" />
            <Button variant="secondary" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setFilters([...filters, { field: "sex", op: "eq", value: "" }])}>+ Add filter</Button>
          <Button onClick={build}>Build cohort</Button>
          <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Matched: {count}</h2>
        {cols.length > 0 && (
          <Table headers={cols} rows={cohort.map((r) => cols.map((c) => String(r[c] ?? "")))} />
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Cross-tabulation</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={rowField} onChange={(e) => setRowField(e.target.value)}>
            {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Select value={colField} onChange={(e) => setColField(e.target.value)}>
            {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Button onClick={stats}>Compute</Button>
        </div>
        {cells.length > 0 && (
          <Table
            headers={["row", "col", "count"]}
            rows={cells.map((c) => [String(c.rowVal ?? ""), String(c.colVal ?? ""), c.count])}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Codebook</h2>
        <Table headers={["field", "type", "label"]} rows={codebook.map((c) => [c.field, c.type, c.label])} />
      </Card>
    </div>
  );

  function update(i: number, key: keyof Filter, value: string) {
    setFilters(filters.map((f, j) => (j === i ? { ...f, [key]: value } : f)));
  }
}
