import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as any).error ?? "Request failed");
  }
  return res.json();
}

export default function Consent() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();

  const [patientId, setPatientId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [reason, setReason] = useState("");
  const [withdrawId, setWithdrawId] = useState<number | null>(null);

  const consents = useQuery({ queryKey: ["consents"], queryFn: () => getJson("/api/consent") });
  const versions = useQuery({ queryKey: ["consent-versions"], queryFn: () => getJson("/api/consent/versions") });

  const create = useMutation({
    mutationFn: () => postJson("/api/consent", { patientId: Number(patientId), consentVersionId: Number(versionId) }),
    onSuccess: () => { setPatientId(""); setVersionId(""); qc.invalidateQueries({ queryKey: ["consents"] }); },
  });
  const withdraw = useMutation({
    mutationFn: (id: number) => postJson(`/api/consent/${id}/withdraw`, { reason }),
    onSuccess: () => { setReason(""); setWithdrawId(null); qc.invalidateQueries({ queryKey: ["consents"] }); },
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="h-7 w-7 text-primary" /> {t("features.consent.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.consent.desc")}</p>
        </div>

        {canEdit && (
          <Card>
            <CardHeader><CardTitle className="text-base">Record consent</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label>Patient ID</Label>
                <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. 12" />
              </div>
              <div className="space-y-1 min-w-[220px]">
                <Label>Consent version</Label>
                <Select value={versionId} onValueChange={setVersionId}>
                  <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {(versions.data?.versions || []).map((v: any) => (
                      <SelectItem key={v.id} value={String(v.id)}>{v.label} ({v.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={!patientId || !versionId || create.isPending} onClick={() => create.mutate()}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">{consents.data?.consents?.length ?? 0} consents</CardTitle></CardHeader>
          <CardContent>
            {consents.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead><TableHead>Patient</TableHead><TableHead>Version</TableHead>
                      <TableHead>Status</TableHead><TableHead>Signed</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(consents.data?.consents || []).map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.id}</TableCell>
                        <TableCell>{c.patientId}</TableCell>
                        <TableCell>{c.versionLabel || c.versionCode}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "signed" ? "default" : "destructive"}>{c.status}</Badge>
                        </TableCell>
                        <TableCell>{c.signedAt ?? "—"}</TableCell>
                        <TableCell>
                          {canEdit && c.status === "signed" && (
                            <Button variant="outline" size="sm" onClick={() => { setWithdrawId(c.id); }}>
                              Withdraw
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {withdrawId != null && (
          <Card>
            <CardHeader><CardTitle className="text-base">Withdraw consent #{withdrawId}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1 flex-1 min-w-[240px]">
                <Label>Reason</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
              </div>
              <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdraw.mutate(withdrawId)}>
                Confirm withdraw
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
