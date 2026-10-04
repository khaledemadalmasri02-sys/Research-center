import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CrossFade, FadeIn } from "@/lib/page-motion";
import { ErrorState, NoDataState } from "@/components/ui/states";

const RULE_TYPES = [
  { value: "required", labelKey: "validation.ruleTypeRequired" },
  { value: "range", labelKey: "validation.ruleTypeRange" },
  { value: "regex", labelKey: "validation.ruleTypeRegex" },
  { value: "cross_field", labelKey: "validation.ruleTypeCrossField" },
  { value: "unique", labelKey: "validation.ruleTypeUnique" },
] as const;

async function postJson(url: string, body: unknown, fallbackError: string) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error || fallbackError);
  }
  return res.json();
}

export default function ValidationPage() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const fail = t("validation.requestFailed");

  const rules = useQuery({
    queryKey: ["validation-rules"],
    queryFn: async () => {
      const r = await fetch("/api/validation/rules", { credentials: "include" });
      if (!r.ok) throw new Error(fail);
      const body = await r.json();
      return (body.rules || []) as Array<{
        id: number;
        fieldKey: string;
        ruleType: string;
        severity: string;
      }>;
    },
    retry: false,
  });

  const [fieldKey, setFieldKey] = useState("");
  const [ruleType, setRuleType] = useState("required");
  const [severity, setSeverity] = useState("error");
  const [sample, setSample] = useState('{\n  "age": 70,\n  "sex": "M"\n}');
  const [result, setResult] = useState<{
    valid?: boolean;
    errors?: Array<{ field: string; message: string; severity?: string }>;
    warnings?: Array<{ field: string; message: string; severity?: string }>;
  } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      postJson("/api/validation/rules", { fieldKey, ruleType, severity, params: {} }, fail),
    onSuccess: () => {
      setFieldKey("");
      qc.invalidateQueries({ queryKey: ["validation-rules"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/validation/rules/${id}`, { method: "DELETE", credentials: "include" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["validation-rules"] }),
  });
  const validate = useMutation({
    mutationFn: async () => {
      const data = JSON.parse(sample);
      const d = await postJson("/api/validation/validate", { data }, fail);
      setResult(d);
      return d;
    },
    // A malformed JSON sample is a user-input error, not a server failure.
    onError: () => setResult(null),
  });

  const ruleRows = rules.data ?? [];
  const violations = [...(result?.errors ?? []), ...(result?.warnings ?? [])];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <CheckCircle className="h-7 w-7 text-primary" aria-hidden />{" "}
              {t("features.validation.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("features.validation.desc")}</p>
          </div>
        </FadeIn>

        {canEdit && (
          <FadeIn delay={0.05}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("validation.addRule")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-2">
                {/* All three labels were unassociated: no `htmlFor`, and the
                    two `SelectTrigger`s carried no `id`. */}
                <div className="space-y-1">
                  <Label htmlFor="validation-field">{t("validation.field")}</Label>
                  <Input
                    id="validation-field"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    placeholder={t("validation.phField")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="validation-type">{t("validation.type")}</Label>
                  <Select value={ruleType} onValueChange={setRuleType}>
                    <SelectTrigger id="validation-type" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_TYPES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {t(r.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="validation-severity">{t("validation.severity")}</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger id="validation-severity" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">{t("validation.severityError")}</SelectItem>
                      <SelectItem value="warning">{t("validation.severityWarning")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!fieldKey || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />}
                  {t("validation.add")}
                </Button>
                {create.isError && (
                  <p role="alert" className="w-full text-sm text-destructive">
                    {(create.error as Error).message}
                  </p>
                )}
              </CardContent>
            </Card>
          </FadeIn>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <FadeIn delay={0.05}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-base">{t("validation.rules")}</CardTitle>
              </CardHeader>
              <CardContent>
                {rules.isError ? (
                  <ErrorState
                    title={t("common.errorTitle")}
                    description={(rules.error as Error).message}
                    action={
                      <Button size="sm" variant="outline" onClick={() => void rules.refetch()}>
                        {t("common.retry")}
                      </Button>
                    }
                  />
                ) : (
                  <CrossFade
                    loading={rules.isLoading}
                    label={t("common.loading")}
                    skeleton={<div className="h-24 w-full animate-pulse bg-muted/40 rounded-md" />}
                  >
                    {ruleRows.length === 0 ? (
                      <NoDataState title={t("validation.noRules")} size="sm" />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("validation.colField")}</TableHead>
                              <TableHead>{t("validation.colType")}</TableHead>
                              <TableHead>{t("validation.colSeverity")}</TableHead>
                              <TableHead>
                                <span className="sr-only">{t("admin.actions")}</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ruleRows.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell>{r.fieldKey}</TableCell>
                                <TableCell>
                                  {t(
                                    `validation.ruleType${
                                      r.ruleType.charAt(0).toUpperCase() +
                                      r.ruleType.slice(1)
                                    }`,
                                    r.ruleType,
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={r.severity === "error" ? "destructive" : "default"}>
                                    {r.severity === "error"
                                      ? t("validation.severityError")
                                      : t("validation.severityWarning")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end">
                                  {canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`${t("validation.delete")}: ${r.fieldKey}`}
                                      onClick={() => del.mutate(r.id)}
                                    >
                                      {t("validation.delete")}
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CrossFade>
                )}
                {del.isError && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {(del.error as Error).message}
                  </p>
                )}
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.05}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-base">{t("validation.validateSample")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="validation-sample" className="sr-only">
                    {t("validation.validateSample")}
                  </Label>
                  <Textarea
                    id="validation-sample"
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                    rows={6}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <Button disabled={validate.isPending} onClick={() => validate.mutate()}>
                  {validate.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />}
                  {t("validation.runValidation")}
                </Button>
                {validate.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {(validate.error as Error).message}
                  </p>
                )}
                {result && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="text-sm space-y-1 rounded-md border p-2"
                  >
                    <Badge variant={result.valid ? "default" : "destructive"}>
                      {result.valid ? t("validation.valid") : t("validation.invalid")}
                    </Badge>
                    {violations.map((v, i) => (
                      <div
                        key={i}
                        className={
                          v.severity === "error"
                            ? "text-destructive"
                            : "text-amber-700 dark:text-amber-400"
                        }
                      >
                        {v.field}: {v.message}
                      </div>
                    ))}
                    {result.valid && violations.length === 0 && (
                      <div className="text-muted-foreground">{t("validation.noViolations")}</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </FadeIn>
        </div>
      </div>
    </Layout>
  );
}
