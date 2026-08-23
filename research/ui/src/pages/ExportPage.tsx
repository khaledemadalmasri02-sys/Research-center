import { useState } from "react";
import { useI18n } from "../i18n";
import { apiGet, ApiError } from "../lib/api";
import { Card, Button, Input } from "../components/ui";

export default function ExportPage() {
  const { t } = useI18n();
  const [recordId, setRecordId] = useState("");
  const [error, setError] = useState("");

  const download = async (kind: "fhir" | "hl7") => {
    setError("");
    if (!recordId) return setError("Record ID required.");
    try {
      if (kind === "fhir") {
        const bundle = await apiGet(`/api/export/fhir?recordId=${recordId}`);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        trigger(blob, `record_${recordId}_fhir.json`);
      } else {
        const msg = await apiGet<string>(`/api/export/hl7?recordId=${recordId}`);
        const blob = new Blob([msg], { type: "application/hl7-v2" });
        trigger(blob, `record_${recordId}.hl7`);
      }
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navExport")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="number" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="Record ID" />
          <Button onClick={() => download("fhir")}>Download FHIR bundle</Button>
          <Button variant="secondary" onClick={() => download("hl7")}>Download HL7 v2</Button>
        </div>
      </Card>
    </div>
  );
}

function trigger(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
