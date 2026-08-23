import { useEffect, useState } from "react";
import { useAuth, canAdmin } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiDelete, ApiError } from "../lib/api";
import { Card, Button, Input, Table } from "../components/ui";

export default function Gdpr() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [patientId, setPatientId] = useState("");
  const [days, setDays] = useState("365");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [last, setLast] = useState<any>(null);

  const loadRetention = async () => {
    setError("");
    try {
      const d = await apiGet<{ candidates: any[] }>(`/api/gdpr/retention?days=${days}`);
      setCandidates(d.candidates || []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };
  useEffect(() => { if (canAdmin(user)) loadRetention(); /* eslint-disable-next-line */ }, [user]);

  const erase = async () => {
    setError("");
    if (!patientId) return setError("Patient ID required.");
    try {
      const d = await apiDelete<{ deletedRows: number }>(`/api/gdpr/erasure/${patientId}`);
      setLast(d);
      setPatientId("");
      loadRetention();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  if (!canAdmin(user)) return <div className="text-sm text-slate-500">Admin only.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navGdpr")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <h2 className="mb-2 font-medium">Erasure candidates (retention window)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="days" />
          <Button variant="secondary" onClick={loadRetention}>Check retention</Button>
        </div>
        <Table headers={["Patient", "Consents", "Earliest withdrawal"]} rows={candidates.map((c) => [c.patientId, c.consentCount, c.earliestWithdrawal])} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Erase patient (cascade)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="number" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient ID" />
          <Button variant="danger" onClick={erase}>Erase</Button>
        </div>
        {last && <p className="mt-2 text-sm">Deleted rows: <b>{last.deletedRows}</b></p>}
      </Card>
    </div>
  );
}
