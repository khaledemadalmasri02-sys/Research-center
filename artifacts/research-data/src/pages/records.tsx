import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Eye, Pencil, Trash2, Database, Upload } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { DestructiveActionButton } from "@/components/confirm-destructive";
import { recordsApi, type RecordDefinition, type FieldDef } from "@/lib/records";
import { parseExcelFile } from "@/lib/import-utils";
import { useToast } from "@/hooks/use-toast";
import { useDesktopNav } from "@/lib/desktop-nav";
import { ErrorState } from "@/components/ui/states";
import { StaggeredItem, StaggeredList } from "@/lib/page-motion";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
}

export default function RecordsHub() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  /* On the desktop host wouter navigation is a no-op: the window manager is
   * the navigation target. `dn.open` opens the right window and `navigate`
   * still runs in the classic shell. */
  const dn = useDesktopNav();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["record-definitions"],
    queryFn: () => recordsApi.listDefinitions(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deleteDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      toast({ title: t("records.deleted") });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => recordsApi.activateDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["active-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
    },
    onError: (e) =>
      toast({ title: t("destructive.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deactivateDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
      qc.invalidateQueries({ queryKey: ["active-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      qc.invalidateQueries({ queryKey: ["records"] });
    },
    onError: (e) =>
      toast({ title: t("destructive.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  const defaultMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      recordsApi.setDefaultDefinition(id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["default-definition"] });
      qc.invalidateQueries({ queryKey: ["collections-list"] });
      qc.invalidateQueries({ queryKey: ["record-definitions"] });
    },
    onError: (e) =>
      toast({ title: t("destructive.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  async function handleImportCollection(file: File) {
    setImporting(true);
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.rawRows.length === 0) {
        toast({ title: t("importExcel.noValidData"), variant: "destructive" });
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
      toast({
        title: t("importExcel.resultOk", { count: inserted }),
        description: `${name}`,
      });
      dn.open("records/:definitionId", `/records/${definition.id}`);
    } catch (err) {
      toast({ title: t("importExcel.urlFailed"), description: (err as Error).message, variant: "destructive" });
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
              <Database className="h-7 w-7 text-primary" aria-hidden /> {t("nav.collections")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("records.subtitlePre")}{" "}
              <span className="font-medium text-foreground">{t("records.defaultBadge")}</span>{" "}
              {t("records.subtitlePost")}
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
              {importing ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4 me-1" aria-hidden />
              )}
              {t("patients.importExcel")}
            </Button>
            <Button onClick={() => dn.open("collections/new", "/collections/new")}>
              <Plus className="h-4 w-4 me-1" aria-hidden /> {t("app.newCollection")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <ErrorState
            title={t("common.errorTitle")}
            description={t("records.loadFailed")}
            action={
              <Button onClick={() => void refetch()} disabled={isFetching}>{t("common.retry")}</Button>
            }
          />
        ) : data?.definitions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("analysis.noDatasets")}: {t("analysis.noDatasetsDesc")}
            </CardContent>
          </Card>
        ) : (
          <StaggeredList className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.definitions.map((def: RecordDefinition, i) => (
              <StaggeredItem key={def.id} index={i}>
              <Card className="h-full card-interactive">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {def.name}
                    {def.isDefault && (
                      <Badge className="bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950">
                        {t("records.defaultBadge")}
                      </Badge>
                    )}
                    {def.isActive && !def.isDefault && <Badge variant="secondary">{t("database.statusActive")}</Badge>}
                    {def.deactivated && <Badge variant="secondary">{t("records.deactivatedBadge")}</Badge>}
                  </CardTitle>
                  <Badge variant="secondary">
                    {t("database.fieldsCount", { count: def.fields.length })}
                  </Badge>
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
                    <Button size="sm" variant="default" onClick={() => dn.open("records/:definitionId", `/records/${def.id}`)}>
                      <Eye className="h-4 w-4 me-1" aria-hidden /> {t("common.open")}
                    </Button>
                    {!def.deactivated && !def.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={defaultMutation.isPending}
                        onClick={() => defaultMutation.mutate({ id: def.id, value: true })}
                      >
                        {t("records.setDefault")}
                      </Button>
                    )}
                    {def.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={defaultMutation.isPending}
                        onClick={() => defaultMutation.mutate({ id: def.id, value: false })}
                      >
                        {t("records.removeDefault")}
                      </Button>
                    )}
                    {!def.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={activateMutation.isPending}
                        onClick={() => activateMutation.mutate(def.id)}
                      >
                        {t("records.showInDirectory")}
                      </Button>
                    )}
                    {def.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(def.id)}
                      >
                        {t("records.hideFromDirectory")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => dn.open("collections/:id/edit", `/collections/${def.id}/edit`)}>
                      <Pencil className="h-4 w-4 me-1" aria-hidden /> {t("common.edit")}
                    </Button>
                    <DestructiveActionButton
                      trigger={<><Trash2 className="h-4 w-4 me-1" aria-hidden /> {t("common.delete")}</>}
                      triggerLabel={`${t("common.delete")}: ${def.name}`}
                      triggerClassName="h-8"
                      title={t("records.deleteTitle")}
                      description={t("destructive.body")}
                      subject={def.name}
                      onSelect={async () => {
                        await deleteMutation.mutateAsync(def.id);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
              </StaggeredItem>
            ))}
          </StaggeredList>
        )}
      </div>
    </Layout>
  );
}
