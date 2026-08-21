import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Eye, Pencil, Trash2, Database, Upload } from "lucide-react";
import { Link, useLocation } from "wouter";
import { recordsApi, type RecordDefinition, type FieldDef } from "@/lib/records";
import { parseExcelFile } from "@/lib/import-utils";
import { useToast } from "@/hooks/use-toast";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
}

export default function RecordsHub() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["record-definitions"],
    queryFn: () => recordsApi.listDefinitions(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deleteDefinition(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["record-definitions"] }),
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => recordsApi.activateDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["active-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deactivateDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["active-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      qc.invalidateQueries({ queryKey: ["records"] });
    },
  });

  const defaultMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      recordsApi.setDefaultDefinition(id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["default-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
    },
  });

  async function handleImportCollection(file: File) {
    setImporting(true);
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.rawRows.length === 0) {
        toast({ title: "Nothing to import", description: "The file has no data rows.", variant: "destructive" });
        return;
      }
      const fields: FieldDef[] = parsed.columnMap.map((c) => ({
        key: slugify(c.header),
        label: c.header,
        type: "text",
      }));
      const name = file.name.replace(/\.[^.]+$/, "") || "Imported Collection";
      const { definition } = await recordsApi.createDefinition(name, fields);
      const rows = parsed.rawRows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const c of parsed.columnMap) obj[slugify(c.header)] = r[c.header];
        return obj;
      });
      const { inserted } = await recordsApi.importRecords(definition.id, rows);
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      toast({ title: "Collection imported", description: `${inserted} record(s) added to "${name}".` });
      navigate(`/records/${definition.id}`);
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Database className="h-7 w-7 text-primary" /> Data Collections
            </h1>
            <p className="text-muted-foreground mt-1">
              Each collection is a dataset with its own fields. Mark one as the <span className="font-medium text-foreground">Default</span> to choose where new records are added and what the Patient Directory shows.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportCollection(f);
              }}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              Import Collection
            </Button>
            <Button onClick={() => navigate("/collections/new")}>
              <Plus className="h-4 w-4 mr-1" /> New Collection
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : data?.definitions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No collections yet. Create one to start building your own record fields.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.definitions.map((def: RecordDefinition) => (
              <Card key={def.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {def.name}
                    {def.isDefault && <Badge className="bg-emerald-600">Default</Badge>}
                    {def.isActive && !def.isDefault && <Badge variant="secondary">Active</Badge>}
                    {def.deactivated && <Badge variant="secondary">Deactivated</Badge>}
                  </CardTitle>
                  <Badge variant="secondary">{def.fields.length} fields</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1">
                    {def.fields.slice(0, 6).map((f) => (
                      <Badge key={f.key} variant="outline" className="text-xs">
                        {f.label}
                      </Badge>
                    ))}
                    {def.fields.length > 6 && (
                      <Badge variant="outline" className="text-xs">
                        +{def.fields.length - 6}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="default" onClick={() => navigate(`/records/${def.id}`)}>
                      <Eye className="h-4 w-4 mr-1" /> Open
                    </Button>
                    {!def.deactivated && !def.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={defaultMutation.isPending}
                        onClick={() => defaultMutation.mutate({ id: def.id, value: true })}
                      >
                        Set as default
                      </Button>
                    )}
                    {def.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={defaultMutation.isPending}
                        onClick={() => defaultMutation.mutate({ id: def.id, value: false })}
                      >
                        Remove default
                      </Button>
                    )}
                    {!def.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={activateMutation.isPending}
                        onClick={() => activateMutation.mutate(def.id)}
                      >
                        Show in directory
                      </Button>
                    )}
                    {def.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(def.id)}
                      >
                        Hide from directory
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => navigate(`/collections/${def.id}/edit`)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(`Delete collection "${def.name}" and all its records?`)) {
                          deleteMutation.mutate(def.id);
                        }
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
