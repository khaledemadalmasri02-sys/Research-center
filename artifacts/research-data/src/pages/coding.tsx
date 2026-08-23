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
import { Loader2, Tags } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

export default function Coding() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [system, setSystem] = useState("ICD10");
  const [patientId, setPatientId] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const search = useQuery({
    queryKey: ["code-search", q, system],
    queryFn: async () => {
      const r = await fetch(`/api/codings/search?q=${encodeURIComponent(q)}&system=${system}`, { credentials: "include" });
      return (await r.json()).codes || [];
    },
    enabled: q.length > 1,
  });

  const list = useQuery({
    queryKey: ["diagnoses", patientId],
    queryFn: async () => {
      if (!patientId) return [];
      const r = await fetch(`/api/codings?patientId=${patientId}`, { credentials: "include" });
      return (await r.json()).diagnoses || [];
    },
    enabled: !!patientId,
  });

  const attach = useMutation({
    mutationFn: async () => postJson("/api/codings/code", {
      codeSystem: system, code: selected.code, patientId: patientId ? Number(patientId) : undefined, confidence: 1,
    }),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["diagnoses", patientId] }); },
  });

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).error || "Failed"); }
    return res.json();
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Tags className="h-7 w-7 text-primary" /> {t("features.coding.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.coding.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Search terminology &amp; attach</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={system} onValueChange={setSystem}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ICD10">ICD-10</SelectItem>
                  <SelectItem value="SNOMED">SNOMED</SelectItem>
                </SelectContent>
              </Select>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or display…" className="max-w-xs" />
              <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="Patient ID" className="w-32" />
            </div>
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader><TableRow><TableHead>System</TableHead><TableHead>Code</TableHead><TableHead>Display</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {(search.data || []).map((c: any) => (
                    <TableRow key={c.id} className={selected?.id === c.id ? "bg-accent" : ""}>
                      <TableCell><Badge variant="outline">{c.codeSystem}</Badge></TableCell>
                      <TableCell>{c.code}</TableCell>
                      <TableCell>{c.display}</TableCell>
                      <TableCell>
                        <Button size="sm" disabled={!canEdit} onClick={() => setSelected(c)}>Select</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!search.data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">Type to search…</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
            {selected && (
              <div className="flex items-center gap-2">
                <span className="text-sm">Attach <b>{selected.code}</b> {selected.display}</span>
                <Button disabled={!patientId || attach.isPending} onClick={() => attach.mutate()}>
                  {attach.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Attach to patient
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Coded diagnoses {patientId ? `· patient ${patientId}` : ""}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>System</TableHead><TableHead>Code</TableHead><TableHead>Display</TableHead><TableHead>Confidence</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(list.data || []).map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell><Badge variant="outline">{d.codeSystem}</Badge></TableCell>
                      <TableCell>{d.code}</TableCell>
                      <TableCell>{d.display}</TableCell>
                      <TableCell>{d.confidence ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!list.data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No codes yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
