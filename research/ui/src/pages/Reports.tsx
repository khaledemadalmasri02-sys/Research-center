import { useState } from "react";
import { useI18n } from "../i18n";
import { apiGet, ApiError } from "../lib/api";
import { Card, Button, Input } from "../components/ui";

export default function Reports() {
  const { t } = useI18n();
  const [patientId, setPatientId] = useState("");
  const [error, setError] = useState("");

  const download = async () => {
    setError("");
    if (!patientId) return setError("Patient ID required.");
    try {
      const res = await fetch(`/api/reports/patient/${patientId}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `patient_${patientId}_crf.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navReports")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="number" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient ID" />
          <Button onClick={download}>Download CRF (PDF)</Button>
        </div>
      </Card>
    </div>
  );
}
