import { useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input } from "../components/ui";

export default function Deidentify() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [patientId, setPatientId] = useState("");
  const [studyCode, setStudyCode] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [error, setError] = useState("");

  const generate = async () => {
    setError("");
    if (!patientId || !studyCode) return setError("Patient ID and study code required.");
    try {
      const d = await apiPost<{ pseudonym: string }>("/api/deidentify/pseudonym", { patientId: Number(patientId), studyCode });
      setPseudonym(d.pseudonym);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed.");
    }
  };

  const downloadExport = async () => {
    setError("");
    if (!studyCode) return setError("Study code required.");
    try {
      const csv = await apiGet<string>(`/api/deidentify/export?studyCode=${encodeURIComponent(studyCode)}`);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deidentified_${studyCode}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed.");
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navDeidentify")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("patientId")}</label>
            <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="P001" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Study code</label>
            <Input value={studyCode} onChange={(e) => setStudyCode(e.target.value)} placeholder="ST1" />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button disabled={!canEdit(user)} onClick={generate}>Generate pseudonym</Button>
          <Button variant="secondary" onClick={downloadExport}>Download de-identified CSV</Button>
        </div>
        {pseudonym && (
          <p className="mt-3 text-sm">
            Pseudonym: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{pseudonym}</code>
          </p>
        )}
      </Card>
    </div>
  );
}
