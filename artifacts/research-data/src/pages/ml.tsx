import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, BrainCircuit } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

async function getJson(url: string) { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error("Failed"); return r.json(); }
async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any).error || "Failed"); }
  return r.json();
}

export default function Ml() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ["ml-models"], queryFn: () => getJson("/api/ml/models") });
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [modelId, setModelId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [confidence, setConfidence] = useState("");
  const [metrics, setMetrics] = useState<any>(null);

  const createModel = useMutation({
    mutationFn: () => postJson("/api/ml/models", { name, version }),
    onSuccess: () => { setName(""); setVersion(""); qc.invalidateQueries({ queryKey: ["ml-models"] }); },
  });
  const logPrediction = useMutation({
    mutationFn: () => postJson("/api/ml/predictions", { modelId: Number(modelId), recordId: Number(recordId), confidence: confidence ? Number(confidence) : undefined }),
    onSuccess: () => { setRecordId(""); setConfidence(""); },
  });
  const evaluate = useMutation({
    mutationFn: () => postJson("/api/ml/evaluate", { modelId: Number(modelId), positiveLabel: "positive" }),
    onSuccess: (d) => setMetrics(d),
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BrainCircuit className="h-7 w-7 text-primary" /> {t("features.ml.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.ml.desc")}</p>
        </div>

        {canEdit && (
          <Card>
            <CardHeader><CardTitle className="text-base">Register model</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Version</Label><Input value={version} onChange={(e) => setVersion(e.target.value)} /></div>
              <Button disabled={!name || !version || createModel.isPending} onClick={() => createModel.mutate()}>Add</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Models</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(models.data?.models || []).map((m: any) => (
                    <TableRow key={m.id}><TableCell>{m.id}</TableCell><TableCell>{m.name}</TableCell><TableCell>{m.version}</TableCell><TableCell>{m.createdAt}</TableCell></TableRow>
                  ))}
                  {!models.data?.models?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No models.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {canEdit && (
          <Card>
            <CardHeader><CardTitle className="text-base">Log prediction &amp; evaluate</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <Input className="w-28" type="number" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model ID" />
                <Input className="w-28" type="number" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="Record ID" />
                <Input className="w-28" type="number" step="0.01" value={confidence} onChange={(e) => setConfidence(e.target.value)} placeholder="Confidence" />
                <Button onClick={() => logPrediction.mutate()}>Log prediction</Button>
                <Button variant="secondary" onClick={() => evaluate.mutate()}>Evaluate</Button>
              </div>
              {metrics && (
                <div className="text-sm">
                  AUC <Badge>{metrics.auc?.toFixed?.(3)}</Badge> · Sensitivity {metrics.sensitivity?.toFixed?.(3)} · Specificity {metrics.specificity?.toFixed?.(3)} · F1 {metrics.f1?.toFixed?.(3)} · n={metrics.sampleSize}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
