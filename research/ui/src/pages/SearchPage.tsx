import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { Card, Button, Input, Table, Badge } from "../components/ui";

export default function SearchPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");

  const loadViews = () => apiGet<{ views: any[] }>("/api/saved-views").then((d) => setViews(d.views || []));
  useEffect(() => { loadViews(); }, []);

  const search = async () => {
    setError("");
    try {
      const d = await apiPost<{ count: number; results: any[] }>("/api/search", { q: q || undefined });
      setResults(d.results || []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const saveView = async () => {
    if (!viewName) return setError("Name required.");
    await apiPost("/api/saved-views", { name: viewName, filters: { note: q } });
    setViewName("");
    loadViews();
  };

  const delView = async (id: number) => {
    await apiDelete(`/api/saved-views/${id}`);
    loadViews();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navSearch")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records…" />
          <Button onClick={search}>Search</Button>
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Save as view name" />
          <Button variant="secondary" onClick={saveView}>Save view</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Results: {results.length}</h2>
        <Table
          headers={["ID", "Definition", "Data", "Created"]}
          rows={results.map((r) => [r.id, r.definitionId, <span key={r.id} className="line-clamp-1 max-w-xs truncate">{JSON.stringify(r.data)}</span>, r.createdAt])}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Saved views</h2>
        <Table
          headers={["Name", "Filters", ""]}
          rows={views.map((v) => [v.name, JSON.stringify(v.filters), <Button key={"v" + v.id} variant="danger" onClick={() => delView(v.id)}>Delete</Button>])}
        />
      </Card>
    </div>
  );
}
