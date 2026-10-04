import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tags } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { FadeIn } from "@/lib/page-motion";
import { NoDataState } from "@/components/ui/states";

export default function Coding() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const fail = t("coding.requestFailed");
  const [q, setQ] = useState("");
  const [system, setSystem] = useState("ICD10");
  const [patientId, setPatientId] = useState("");
  const [selected, setSelected] = useState<{ id: number; code: string; display: string } | null>(null);

  const search = useQuery<Array<{ id: number; code: string; display: string; codeSystem: string }>>({
    queryKey: ["code-search", q, system],
    queryFn: async () => {
      const r = await fetch(`/api/codings/search?q=${encodeURIComponent(q)}&system=${system}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(fail);
      return (await r.json()).codes || [];
    },
    enabled: q.length > 1,
    retry: false,
  });

  const list = useQuery<
    Array<{ id: number; code: string; display: string; codeSystem: string; confidence?: number }>
  >({
    queryKey: ["diagnoses", patientId],
    queryFn: async () => {
      const r = await fetch(`/api/codings?patientId=${patientId}`, { credentials: "include" });
      if (!r.ok) throw new Error(fail);
      return (await r.json()).diagnoses || [];
    },
    enabled: !!patientId,
    retry: false,
  });

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error || fail);
    }
    return res.json();
  }

  const attach = useMutation({
    mutationFn: async () =>
      postJson("/api/codings/code", {
        codeSystem: system,
        code: selected?.code,
        patientId: patientId ? Number(patientId) : undefined,
        confidence: 1,
      }),
    onSuccess: () => {
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["diagnoses", patientId] });
    },
  });

  const searchRows = search.data ?? [];
  const listRows = list.data ?? [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Tags className="h-7 w-7 text-primary" aria-hidden />{" "}
              {t("features.coding.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("features.coding.desc")}</p>
          </div>
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("coding.searchAttach")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="coding-system" className="text-xs text-muted-foreground">
                    {t("coding.codeSystemLabel")}
                  </Label>
                  <Select value={system} onValueChange={setSystem}>
                    <SelectTrigger id="coding-system" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ICD10">ICD-10</SelectItem>
                      <SelectItem value="SNOMED">SNOMED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Both of these were placeholder-only inputs with no label. */}
                <div className="space-y-1">
                  <Label htmlFor="coding-search" className="text-xs text-muted-foreground">
                    {t("coding.phSearchLabel")}
                  </Label>
                  <Input
                    id="coding-search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("coding.phSearch")}
                    className="max-w-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="coding-patient" className="text-xs text-muted-foreground">
                    {t("coding.phPatientIdLabel")}
                  </Label>
                  <Input
                    id="coding-patient"
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    placeholder={t("coding.phPatientId")}
                    className="w-32"
                  />
                </div>
              </div>
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("coding.colSystem")}</TableHead>
                      <TableHead>{t("coding.colCode")}</TableHead>
                      <TableHead>{t("coding.colDisplay")}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t("coding.select")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchRows.map((c) => (
                      <TableRow key={c.id} className={selected?.id === c.id ? "bg-accent" : ""}>
                        <TableCell>
                          <Badge variant="outline">{c.codeSystem}</Badge>
                        </TableCell>
                        <TableCell>{c.code}</TableCell>
                        <TableCell>{c.display}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            disabled={!canEdit}
                            aria-pressed={selected?.id === c.id}
                            aria-label={`${t("coding.select")}: ${c.code}`}
                            onClick={() => setSelected(c)}
                          >
                            {t("coding.select")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {search.isError && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-4">
                          <p role="alert" className="text-center text-sm text-destructive">
                            {(search.error as Error).message}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                    {!search.isError && searchRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-4">
                          <NoDataState title={t("coding.typeToSearch")} size="sm" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {selected && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {t("coding.attachPrefix")} <b>{selected.code}</b> {selected.display}
                  </span>
                  <Button
                    disabled={!patientId || attach.isPending}
                    onClick={() => attach.mutate()}
                  >
                    {attach.isPending && (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                    )}
                    {t("coding.attachToPatient")}
                  </Button>
                  {attach.isError && (
                    <span role="alert" className="text-sm text-destructive">
                      {(attach.error as Error).message}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {patientId
                  ? t("coding.codedDiagnosesFor", { id: patientId })
                  : t("coding.codedDiagnoses")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("coding.colSystem")}</TableHead>
                      <TableHead>{t("coding.colCode")}</TableHead>
                      <TableHead>{t("coding.colDisplay")}</TableHead>
                      <TableHead>{t("coding.colConfidence")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listRows.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Badge variant="outline">{d.codeSystem}</Badge>
                        </TableCell>
                        <TableCell>{d.code}</TableCell>
                        <TableCell>{d.display}</TableCell>
                        <TableCell className="tabular-nums">
                          {d.confidence ?? t("common.emDash")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {list.isError && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-4">
                          <p role="alert" className="text-center text-sm text-destructive">
                            {(list.error as Error).message}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                    {!list.isError && listRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-4">
                          <NoDataState title={t("coding.noCodes")} size="sm" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </Layout>
  );
}
