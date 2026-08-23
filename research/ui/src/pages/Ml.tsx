import { useEffect, useState } from "react";
import { useAuth, canEdit } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Card, Button, Input, Table, Badge } from "../components/ui";

export default function Ml() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [models, setModels] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [modelId, setModelId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [confidence, setConfidence] = useState("");
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState("");

  const load = () => apiGet<{ models: any[] }>("/api/ml/models").then((d) => setModels(d.models || []));
  useEffect(() => { load(); }, []);

  const createModel = async () => {
    setError("");
    if (!name || !version) return setError("name and version required.");
    try {
      await apiPost("/api/ml/models", { name, version });
      setName(""); setVersion("");
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const logPrediction = async () => {
    setError("");
    if (!modelId || !recordId) return setError("modelId and recordId required.");
    try {
      await apiPost("/api/ml/predictions", { modelId: Number(modelId), recordId: Number(recordId), confidence: confidence ? Number(confidence) : undefined });
      setRecordId(""); setConfidence("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const evaluate = async () => {
    setError("");
    if (!modelId) return setError("modelId required.");
    try {
      const d = await apiPost<any>("/api/ml/evaluate", { modelId: Number(modelId), positiveLabel: "positive" });
      setMetrics(d);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navMl")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      {canEdit(user) && (
        <Card>
          <h2 className="mb-2 font-medium">Register model</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" />
            <Button onClick={createModel}>Add</Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium">Models</h2>
        <Table headers={["ID", "Name", "Version", "Created"]} rows={models.map((m) => [m.id, m.name, m.version, m.createdAt])} />
      </Card>

      {canEdit(user) && (
        <Card>
          <h2 className="mb-2 font-medium">Log prediction & evaluate</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="number" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model ID" />
            <Input type="number" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="Record ID" />
            <Input type="number" step="0.01" value={confidence} onChange={(e) => setConfidence(e.target.value)} placeholder="Confidence" />
            <Button onClick={logPrediction}>Log prediction</Button>
            <Button variant="secondary" onClick={evaluate}>Evaluate</Button>
          </div>
          {metrics && (
            <div className="mt-2 text-sm">
              AUC <Badge>{metrics.auc?.toFixed?.(3)}</Badge> · Sensitivity {metrics.sensitivity?.toFixed?.(3)} · Specificity {metrics.specificity?.toFixed?.(3)} · F1 {metrics.f1?.toFixed?.(3)} · n={metrics.sampleSize}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
