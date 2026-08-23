import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

async function getJson(url: string) { const r = await fetch(url, { credentials: "include" }); if (!r.ok) throw new Error("Failed"); return r.json(); }

export default function Gdpr() {
  const { t } = useTranslation();
  const { canAdminAccess } = useAuth();
  const qc = useQueryClient();
  const [days, setDays] = useState("365");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [patientId, setPatientId] = useState("");
  const [last, setLast] = useState<any>(null);

  const loadRetention = async () => {
    const d = await getJson(`/api/gdpr/retention?days=${days}`).catch(() => ({ candidates: [] }));
    setCandidates(d.candidates || []);
  };
  const erase = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/gdpr/erasure/${patientId}`, { method: "DELETE", credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      return d;
    },
    onSuccess: (d) => { setLast(d); setPatientId(""); loadRetention(); },
  });

  if (!canAdminAccess) return <Layout><div className="p-4 text-sm text-muted-foreground">Admin access required.</div></Layout>;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" /> {t("features.gdpr.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.gdpr.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Erasure candidates (retention window)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label>Days</Label><Input className="w-32" type="number" value={days} onChange={(e) => setDays(e.target.value)} /></div>
              <Button variant="secondary" onClick={loadRetention}>Check retention</Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Consents</TableHead><TableHead>Earliest withdrawal</TableHead></TableRow></TableHeader>
                <TableBody>
                  {candidates.map((c: any) => (
                    <TableRow key={c.patientId}><TableCell>{c.patientId}</TableCell><TableCell>{c.consentCount}</TableCell><TableCell>{c.earliestWithdrawal}</TableCell></TableRow>
                  ))}
                  {!candidates.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No candidates. Use “Check retention”.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Erase patient (cascade)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label>Patient ID</Label><Input className="w-32" type="number" value={patientId} onChange={(e) => setPatientId(e.target.value)} /></div>
            <Button variant="destructive" disabled={!patientId || erase.isPending} onClick={() => erase.mutate()}>
              {erase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Erase
            </Button>
            {last && <span className="text-sm">Deleted rows: <b>{last.deletedRows}</b></span>}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
