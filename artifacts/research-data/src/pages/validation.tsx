import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useTranslation } from "react-i18next";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).error || "Failed"); }
  return res.json();
}

export default function ValidationPage() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["validation-rules"], queryFn: async () => (await (await fetch("/api/validation/rules", { credentials: "include" })).json()).rules || [] });

  const [fieldKey, setFieldKey] = useState("");
  const [ruleType, setRuleType] = useState("required");
  const [severity, setSeverity] = useState("error");
  const [sample, setSample] = useState("{\n  \"age\": 70,\n  \"sex\": \"M\"\n}");
  const [result, setResult] = useState<any>(null);

  const create = useMutation({
    mutationFn: () => postJson("/api/validation/rules", { fieldKey, ruleType, severity, params: {} }),
    onSuccess: () => { setFieldKey(""); qc.invalidateQueries({ queryKey: ["validation-rules"] }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => fetch(`/api/validation/rules/${id}`, { method: "DELETE", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["validation-rules"] }),
  });
  const validate = useMutation({
    mutationFn: async () => {
      const data = JSON.parse(sample);
      const d = await postJson("/api/validation/validate", { data });
      setResult(d); return d;
    },
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CheckCircle className="h-7 w-7 text-primary" /> {t("features.validation.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.validation.desc")}</p>
        </div>

        {canEdit && (
          <Card>
            <CardHeader><CardTitle className="text-base">Add rule</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label>Field</Label><Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="e.g. age" /></div>
              <div className="space-y-1"><Label>Type</Label>
                <Select value={ruleType} onValueChange={setRuleType}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{["required","range","regex","cross_field","unique"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Severity</Label>
                <Select value={severity} onValueChange={setSeverity}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="error">error</SelectItem><SelectItem value="warning">warning</SelectItem></SelectContent>
                </Select>
              </div>
              <Button disabled={!fieldKey || create.isPending} onClick={() => create.mutate()}>Add</Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Type</TableHead><TableHead>Severity</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(rules.data || []).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.fieldKey}</TableCell><TableCell>{r.ruleType}</TableCell>
                        <TableCell><Badge variant={r.severity === "error" ? "destructive" : "default"}>{r.severity}</Badge></TableCell>
                        <TableCell>{canEdit && <Button variant="ghost" size="sm" onClick={() => del.mutate(r.id)}>Delete</Button>}</TableCell>
                      </TableRow>
                    ))}
                    {!rules.data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No rules.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Validate sample</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={6} className="font-mono text-xs" />
              <Button disabled={validate.isPending} onClick={() => validate.mutate()}>
                {validate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Run validation
              </Button>
              {result && (
                <div className="text-sm space-y-1">
                  <Badge variant={result.valid ? "default" : "destructive"}>{result.valid ? "Valid" : "Invalid"}</Badge>
                  {(result.errors || []).concat(result.warnings || []).map((v: any, i: number) => (
                    <div key={i} className={v.severity === "error" ? "text-destructive" : "text-amber-600"}>
                      {v.field}: {v.message}
                    </div>
                  ))}
                  {result.valid && !(result.warnings || []).length && <div className="text-muted-foreground">No violations.</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
