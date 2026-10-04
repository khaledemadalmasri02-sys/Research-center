import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, BrainCircuit } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CrossFade, FadeIn } from "@/lib/page-motion";
import { ErrorState, NoDataState } from "@/components/ui/states";

async function getJson(url: string, fallbackError: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(fallbackError);
  return r.json();
}
async function postJson(url: string, body: unknown, fallbackError: string) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error || fallbackError);
  }
  return r.json();
}

export default function Ml() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const models = useQuery({
    queryKey: ["ml-models"],
    queryFn: () => getJson("/api/ml/models", t("ml.requestFailed")),
    retry: false,
  });
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [modelId, setModelId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [confidence, setConfidence] = useState("");
  const [metrics, setMetrics] = useState<Record<string, number | undefined> | null>(null);

  const fail = t("ml.requestFailed");

  const createModel = useMutation({
    mutationFn: () => postJson("/api/ml/models", { name, version }, fail),
    onSuccess: () => {
      setName("");
      setVersion("");
      qc.invalidateQueries({ queryKey: ["ml-models"] });
    },
  });
  const logPrediction = useMutation({
    mutationFn: () =>
      postJson(
        "/api/ml/predictions",
        {
          modelId: Number(modelId),
          recordId: Number(recordId),
          confidence: confidence ? Number(confidence) : undefined,
        },
        fail,
      ),
    onSuccess: () => {
      setRecordId("");
      setConfidence("");
    },
  });
  const evaluate = useMutation({
    mutationFn: () =>
      postJson("/api/ml/evaluate", { modelId: Number(modelId), positiveLabel: "positive" }, fail),
    onSuccess: (d: Record<string, number>) => setMetrics(d),
  });

  const rows: Array<{ id: number; name: string; version: string; createdAt: string }> =
    models.data?.models ?? [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <BrainCircuit className="h-7 w-7 text-primary" aria-hidden />{" "}
              {t("features.ml.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("features.ml.desc")}</p>
          </div>
        </FadeIn>

        {canEdit && (
          <FadeIn delay={0.05}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("ml.registerModel")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-2">
                {/* The two labels below had no `htmlFor` and the inputs no `id`,
                    so both were announced as unlabelled text boxes. */}
                <div className="space-y-1">
                  <Label htmlFor="ml-model-name">{t("ml.name")}</Label>
                  <Input
                    id="ml-model-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ml-model-version">{t("ml.version")}</Label>
                  <Input
                    id="ml-model-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  />
                </div>
                <Button
                  disabled={!name || !version || createModel.isPending}
                  onClick={() => createModel.mutate()}
                >
                  {createModel.isPending && (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {t("ml.add")}
                </Button>
                {createModel.isError && (
                  <p role="alert" className="w-full text-sm text-destructive">
                    {(createModel.error as Error).message}
                  </p>
                )}
              </CardContent>
            </Card>
          </FadeIn>
        )}

        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("ml.models")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* isError-first: a failed fetch rendered the same empty table a
                  genuinely empty model registry renders. */}
              {models.isError ? (
                <ErrorState
                  title={t("common.errorTitle")}
                  description={(models.error as Error).message}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void models.refetch()}>
                      {t("common.retry")}
                    </Button>
                  }
                />
              ) : (
                <CrossFade
                  loading={models.isLoading}
                  label={t("common.loading")}
                  skeleton={<div className="h-24 w-full animate-pulse bg-muted/40 rounded-md" />}
                >
                  {rows.length === 0 ? (
                    <NoDataState title={t("ml.noModels")} size="sm" />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("ml.colId")}</TableHead>
                            <TableHead>{t("ml.colName")}</TableHead>
                            <TableHead>{t("ml.colVersion")}</TableHead>
                            <TableHead>{t("ml.colCreated")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell>{m.id}</TableCell>
                              <TableCell>{m.name}</TableCell>
                              <TableCell>{m.version}</TableCell>
                              <TableCell>{m.createdAt}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CrossFade>
              )}
            </CardContent>
          </Card>
        </FadeIn>

        {canEdit && (
          <FadeIn delay={0.05}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("ml.logEvaluate")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  {/* These three were placeholder-only inputs: a placeholder is
                      not an accessible name, and it disappears on focus. */}
                  <div className="space-y-1">
                    <Label htmlFor="ml-log-model-id" className="text-xs text-muted-foreground">
                      {t("ml.colId")} — {t("ml.phModelId")}
                    </Label>
                    <Input
                      id="ml-log-model-id"
                      className="w-28"
                      type="number"
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      placeholder={t("ml.phModelId")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ml-log-record-id" className="text-xs text-muted-foreground">
                      {t("common.openRecord")} — {t("ml.phRecordId")}
                    </Label>
                    <Input
                      id="ml-log-record-id"
                      className="w-28"
                      type="number"
                      value={recordId}
                      onChange={(e) => setRecordId(e.target.value)}
                      placeholder={t("ml.phRecordId")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ml-log-confidence" className="text-xs text-muted-foreground">
                      {t("ml.phConfidence")}
                    </Label>
                    <Input
                      id="ml-log-confidence"
                      className="w-28"
                      type="number"
                      step="0.01"
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value)}
                      placeholder={t("ml.phConfidence")}
                    />
                  </div>
                  <Button
                    onClick={() => logPrediction.mutate()}
                    disabled={logPrediction.isPending}
                  >
                    {logPrediction.isPending && (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                    )}
                    {t("ml.logPrediction")}
                  </Button>
                  <Button variant="secondary" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
                    {evaluate.isPending && (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                    )}
                    {t("ml.evaluate")}
                  </Button>
                </div>
                {(logPrediction.isError || evaluate.isError) && (
                  <p role="alert" className="text-sm text-destructive">
                    {((logPrediction.error ?? evaluate.error) as Error).message}
                  </p>
                )}
                {metrics && (
                  <div role="status" className="text-sm flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">{t("ml.metricAuc")}</span>
                    <Badge>{(metrics.auc as number | undefined)?.toFixed?.(3)}</Badge>
                    <span aria-hidden>·</span>
                    <span className="text-muted-foreground">{t("ml.metricSensitivity")}</span>
                    <span className="tabular-nums">{metrics.sensitivity?.toFixed?.(3)}</span>
                    <span aria-hidden>·</span>
                    <span className="text-muted-foreground">{t("ml.metricSpecificity")}</span>
                    <span className="tabular-nums">{metrics.specificity?.toFixed?.(3)}</span>
                    <span aria-hidden>·</span>
                    <span className="text-muted-foreground">{t("ml.metricF1")}</span>
                    <span className="tabular-nums">{metrics.f1?.toFixed?.(3)}</span>
                    <span aria-hidden>·</span>
                    <span className="text-muted-foreground">{t("ml.metricN")}</span>
                    <span className="tabular-nums">={metrics.sampleSize}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </FadeIn>
        )}
      </div>
    </Layout>
  );
}
