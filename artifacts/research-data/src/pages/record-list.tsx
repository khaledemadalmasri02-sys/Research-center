import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import { recordsApi } from "@/lib/records";
import { RecordsToolbar } from "@/components/records-toolbar";
import { useAuth } from "@/hooks/use-auth";

export default function RecordList({
  definitionId: defIdProp,
  basePath,
  backHref,
}: {
  definitionId?: number;
  basePath?: string;
  backHref?: string;
}) {
  const { definitionId: paramId } = useParams();
  const defId = defIdProp ?? Number(paramId);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const [q, setQ] = useState("");

  const navBase = basePath ?? (defId ? `/records/${defId}` : "/records");
  const navBack = backHref ?? "/records";

  const { data: defData, isLoading: defLoading } = useQuery({
    queryKey: ["record-definition", defId],
    queryFn: () => recordsApi.getDefinition(defId),
    enabled: !!defId,
  });

  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ["records", defId, q],
    queryFn: () =>
      q.trim()
        ? recordsApi.searchRecords(defId, { q: q.trim() })
        : recordsApi.listRecords(defId),
    enabled: !!defId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deleteRecord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records", defId] }),
  });

  const fields = defData?.definition.fields ?? [];
  const previewKeys = fields.filter((f) => f.type !== "image").slice(0, 4).map((f) => f.key);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate(navBack)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <h1 className="text-3xl font-bold tracking-tight mt-2">{defData?.definition.name ?? "Records"}</h1>
            <p className="text-muted-foreground mt-1">{fields.length} fields defined</p>
          </div>
          <Button onClick={() => navigate(`${navBase}/new`)}>
            <Plus className="h-4 w-4 mr-1" /> New record
          </Button>
        </div>

        {defId ? (
          <RecordsToolbar definitionId={defId} canEdit={canEdit} q={q} onQueryChange={setQ} />
        ) : null}

        {defLoading || recLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : recData?.records.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No records yet in this collection.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {recData?.records.map((rec) => (
              <Card key={rec.id}>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      {previewKeys.map((k) => (
                        <Badge key={k} variant="outline" className="text-xs truncate max-w-[200px]">
                          {String(rec.data?.[k] ?? "—")}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Updated {new Date(rec.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" onClick={() => navigate(`${navBase}/${rec.id}`)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm("Delete this record?")) deleteMutation.mutate(rec.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
