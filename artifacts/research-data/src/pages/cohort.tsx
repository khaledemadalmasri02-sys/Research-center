import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

const FIELDS = ["id","patient_id","age","sex","collection_type","final_confirmed_diagnosis","ai_prediction_output"];

export default function Cohort() {
  const { t } = useTranslation();
  const [field, setField] = useState("age");
  const [op, setOp] = useState("gt");
  const [value, setValue] = useState("");
  const [cohort, setCohort] = useState<any[]>([]);
  const [count, setCount] = useState(0);

  const build = useMutation({
    mutationFn: async () => {
      const filters = value ? [{ field, op, value }] : [];
      const res = await fetch("/api/cohort/build", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, fields: FIELDS }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setCount(d.count); setCohort(d.cohort || []);
      return d;
    },
  });

  const codebook = useQuery({ queryKey: ["codebook"], queryFn: async () => (await (await fetch("/api/cohort/codebook", { credentials: "include" })).json()).codebook });

  const exportCsv = async () => {
    const filters = value ? [{ field, op, value }] : [];
    const res = await fetch("/api/cohort/export", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters, fields: FIELDS }),
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "cohort.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const cols = cohort[0] ? Object.keys(cohort[0]) : FIELDS;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" /> {t("features.cohort.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.cohort.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Build cohort</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Field</Label>
              <Select value={field} onValueChange={setField}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{(codebook.data || FIELDS.map((f) => ({ field: f }))).map((c: any) => (
                  <SelectItem key={c.field} value={c.field}>{c.label || c.field}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Op</Label>
              <Select value={op} onValueChange={setOp}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["eq","neq","contains","gt","lt","gte","lte"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Value</Label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="(empty = all)" />
            </div>
            <Button disabled={build.isPending} onClick={() => build.mutate()}>
              {build.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Build
            </Button>
            <Button variant="secondary" disabled={!cohort.length} onClick={exportCsv}>Export CSV</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{count} patients</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>{cols.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {cohort.map((row, i) => (
                    <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{String(row[c] ?? "")}</TableCell>)}</TableRow>
                  ))}
                  {!cohort.length && <TableRow><TableCell colSpan={cols.length} className="text-center text-muted-foreground py-4">No patients matched.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
