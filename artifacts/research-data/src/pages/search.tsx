import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any).error || "Failed"); }
  return r.json();
}

export default function SearchPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [viewName, setViewName] = useState("");

  const loadViews = async () => {
    const d = await (await fetch("/api/saved-views", { credentials: "include" })).json();
    setViews(d.views || []);
  };
  const search = useMutation({
    mutationFn: () => postJson("/api/search", { q: q || undefined }),
    onSuccess: (d) => setResults(d.results || []),
  });
  const saveView = useMutation({
    mutationFn: () => postJson("/api/saved-views", { name: viewName, filters: { note: q } }),
    onSuccess: () => { setViewName(""); loadViews(); },
  });
  const delView = useMutation({
    mutationFn: (id: number) => fetch(`/api/saved-views/${id}`, { method: "DELETE", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => loadViews(),
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Search className="h-7 w-7 text-primary" /> {t("features.search.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.search.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Search records</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records…" />
            <Button disabled={search.isPending} onClick={() => search.mutate()}>Search</Button>
            <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Save as view name" />
            <Button variant="secondary" onClick={() => saveView.mutate()}>Save view</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Results: {results.length}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Definition</TableHead><TableHead>Data</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>
                  {results.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.id}</TableCell><TableCell>{r.definitionId}</TableCell>
                      <TableCell className="max-w-xs truncate">{JSON.stringify(r.data)}</TableCell><TableCell>{r.createdAt}</TableCell>
                    </TableRow>
                  ))}
                  {!results.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No results yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Saved views</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Filters</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {views.map((v: any) => (
                    <TableRow key={v.id}><TableCell>{v.name}</TableCell><TableCell>{JSON.stringify(v.filters)}</TableCell>
                      <TableCell><Button variant="destructive" size="sm" onClick={() => delView.mutate(v.id)}>Delete</Button></TableCell></TableRow>
                  ))}
                  {!views.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No saved views.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
