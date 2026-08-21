import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Download, Bookmark, Trash2, Save } from "lucide-react";

interface SavedView {
  id: number;
  name: string;
  filters: { q?: string };
}

async function fetchViews(definitionId: number): Promise<{ views: SavedView[] }> {
  const res = await fetch(`/api/saved-views?definitionId=${definitionId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load views");
  return res.json();
}

export function RecordsToolbar({
  definitionId,
  canEdit,
  q,
  onQueryChange,
}: {
  definitionId: number;
  canEdit: boolean;
  q: string;
  onQueryChange: (q: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const views = useQuery({
    queryKey: ["saved-views", definitionId],
    queryFn: () => fetchViews(definitionId),
  });

  const saveView = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definitionId, name, filters: { q } }),
      });
      if (!res.ok) throw new Error("Failed to save view");
      return res.json();
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["saved-views", definitionId] });
    },
  });

  const deleteView = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/saved-views/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views", definitionId] }),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search records…"
          className="pl-8 h-9"
        />
      </div>

      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => recordsExport(definitionId, "csv")}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => recordsExport(definitionId, "excel")}>
            <Download className="h-4 w-4 mr-1" /> Excel
          </Button>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark className="h-4 w-4 mr-1" /> Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {views.data?.views.length ? (
            views.data.views.map((v) => (
              <DropdownMenuItem key={v.id} className="flex items-center justify-between">
                <button
                  className="text-left flex-1 truncate"
                  onClick={() => onQueryChange(v.filters.q ?? "")}
                >
                  {v.name}
                </button>
                <button onClick={() => deleteView.mutate(v.id)} title="Delete view">
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground">No saved views</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <div className="flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name"
            className="h-9 w-32"
          />
          <Button size="sm" onClick={() => saveView.mutate()} disabled={!name.trim() || saveView.isPending}>
            <Save className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function recordsExport(definitionId: number, format: "csv" | "excel") {
  const a = document.createElement("a");
  a.href = `/api/records/${definitionId}/export?format=${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
