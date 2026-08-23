import { useEffect, useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

const RULE_TYPES = ["required", "range", "regex", "cross_field", "unique"];

export default function ValidationPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [rules, setRules] = useState<any[]>([]);
  const [fieldKey, setFieldKey] = useState("");
  const [ruleType, setRuleType] = useState("required");
  const [message, setMessage] = useState("");
  const [data, setData] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const load = () => apiGet<{ rules: any[] }>("/api/validation/rules").then((d) => setRules(d.rules || []));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError("");
    if (!fieldKey) return setError("fieldKey required.");
    try {
      await apiPost("/api/validation/rules", { fieldKey, ruleType, message: message || undefined });
      setFieldKey(""); setMessage("");
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const remove = async (id: number) => {
    await apiDelete(`/api/validation/rules/${id}`);
    load();
  };

  const validate = async () => {
    setError("");
    try {
      const parsed = data.trim() ? JSON.parse(data) : {};
      const d = await apiPost<{ valid: boolean; errors: any[]; warnings: any[] }>("/api/validation/validate", { data: parsed });
      setResult(d);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Invalid JSON."); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navValidation")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <h2 className="mb-2 font-medium">Rules</h2>
        <Table
          headers={["Field", "Type", "Severity", "Message", ""]}
          rows={rules.map((r) => [
            r.fieldKey, r.ruleType, <Badge key={r.id}>{r.severity}</Badge>, r.message || "—",
            <Button key={"d" + r.id} variant="danger" onClick={() => remove(r.id)}>Delete</Button>,
          ])}
        />
        {canEdit(user) && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="fieldKey" />
            <Select value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
              {RULE_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
            </Select>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="message (optional)" />
            <Button onClick={create}>Add rule</Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Validate record data (JSON)</h2>
        <textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder='{"age": 30, "mrn": "MRN-1"}'
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          rows={4}
        />
        <Button className="mt-2" onClick={validate}>Validate</Button>
        {result && (
          <div className="mt-2 text-sm">
            Valid: <b>{String(result.valid)}</b> · Errors: {result.errors?.length || 0} · Warnings: {result.warnings?.length || 0}
          </div>
        )}
      </Card>
    </div>
  );
}
