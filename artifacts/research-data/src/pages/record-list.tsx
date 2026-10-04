import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Loader2,
  Plus,
  Trash2,
  ArrowLeft,
  Pencil,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { recordsApi, type RecordRow } from "@/lib/records";
import { RecordsToolbar } from "@/components/records-toolbar";
import { DestructiveActionButton } from "@/components/confirm-destructive";
import { ErrorState } from "@/components/ui/states";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

/** How long to wait after the last keystroke before hitting the server. */
const SEARCH_DEBOUNCE_MS = 300;

export default function RecordList({
  definitionId: defIdProp,
  basePath,
  backHref,
  route,
}: {
  definitionId?: number;
  basePath?: string;
  backHref?: string;
  route?: string;
}) {
  const { t } = useTranslation();
  const { definitionId: paramId } = useParams();
  // In the desktop shell each window gets its own `route` prop and
  // `useParams()` returns `{}`, so `Number(undefined)` was NaN -> an empty
  // window with no records. Fall back to the route path (mirrors
  // record-detail.tsx).
  const defId = defIdProp ?? Number(paramId ?? route?.split("/").filter(Boolean)[1]);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  /**
   * Debounce the search term. Previously the query key contained the raw
   * `q`, so every single keystroke fired a server request — one round-trip
   * per character typed.
   */
  const [debouncedQ, setDebouncedQ] = useState("");

  const navBase = basePath ?? (defId ? `/records/${defId}` : "/records");
  const navBack = backHref ?? "/records";

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [q]);

  const { data: defData, isLoading: defLoading, isError: defError, refetch: refetchDef } =
    useQuery({
      queryKey: ["record-definition", defId],
      queryFn: () => recordsApi.getDefinition(defId),
      enabled: !!defId,
    });

  const {
    data: recData,
    isLoading: recLoading,
    isError: recError,
    refetch: refetchRec,
    isFetching,
  } = useQuery({
    queryKey: ["records", defId, debouncedQ],
    queryFn: () =>
      debouncedQ.trim()
        ? recordsApi.searchRecords(defId, { q: debouncedQ.trim() })
        : recordsApi.listRecords(defId),
    enabled: !!defId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordsApi.deleteRecord(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records", defId] });
      toast({ title: t("records.deleted"), description: t("records.deletedBody") });
    },
  });

  const fields = defData?.definition.fields ?? [];
  const previewKeys = fields.filter((f) => f.type !== "image").slice(0, 4).map((f) => f.key);

  const rows: RecordRow[] = recData?.records ?? [];

  /**
   * Virtualized + sortable table. This page previously rendered every record
   * as a full `<Card>` with no pagination, so a collection with a few thousand
   * records froze the tab.
   */
  const columns = useMemo<ColumnDef<RecordRow, unknown>[]>(() => {
    const cols: ColumnDef<RecordRow, unknown>[] = previewKeys.map((k) => ({
      accessorKey: k,
      header: fields.find((f) => f.key === k)?.label ?? k,
      cell: ({ row }) => (
        <span className="truncate max-w-[16rem]">
          {String((row.original.data as Record<string, unknown>)?.[k] ?? "—")}
        </span>
      ),
    }));

    cols.push({
      id: "updatedAt",
      accessorKey: "updatedAt",
      header: t("common.date"),
      cell: ({ row }) => (
        <time
          className="whitespace-nowrap text-xs text-muted-foreground"
          dateTime={String(row.original.updatedAt)}
        >
          {new Date(row.original.updatedAt).toLocaleString()}
        </time>
      ),
    });

    cols.push({
      id: "actions",
      header: t("admin.actions"),
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${t("common.viewRecord")}: ${row.original.id}`}
            title={t("common.viewRecord")}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`${navBase}/${row.original.id}`);
            }}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${t("common.editRecord")}: ${row.original.id}`}
            title={t("common.editRecord")}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`${navBase}/${row.original.id}/edit`);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {canEdit && (
            <DestructiveActionButton
              trigger={<Trash2 className="h-4 w-4" />}
              triggerLabel={`${t("common.deleteRecord")}: ${row.original.id}`}
              triggerClassName="text-destructive"
              title={t("records.deleteTitle")}
              description={t("destructive.body")}
              subject={`#${row.original.id}`}
              onSelect={async () => {
                await deleteMutation.mutateAsync(row.original.id);
              }}
            />
          )}
        </div>
      ),
      enableSorting: false,
    });

    return cols;
  }, [previewKeys, fields, navBase, navigate, canEdit, deleteMutation, t]);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate(navBack)}>
              <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" /> {t("common.back")}
            </Button>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              {defData?.definition.name ?? t("nav.records")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {fields.length} {t("nav.records")}
            </p>
          </div>
          <Button onClick={() => navigate(`${navBase}/new`)}>
            <Plus className="h-4 w-4 mr-1" /> {t("records.editBtn")}
          </Button>
        </div>

        {defId ? (
          <RecordsToolbar definitionId={defId} canEdit={canEdit} q={q} onQueryChange={setQ} />
        ) : null}

        {defLoading || recLoading ? (
          <div className="flex justify-center py-12" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : defError || recError ? (
          <ErrorState
            title={t("common.errorTitle")}
            description={t("records.loadFailed")}
            action={
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    void refetchDef();
                    void refetchRec();
                  }}
                  disabled={isFetching}
                >
                  {t("common.retry")}
                </Button>
                <Button variant="outline" onClick={() => navigate(navBack)}>
                  {t("common.back")}
                </Button>
              </div>
            }
          />
        ) : (
          <DataTable<RecordRow>
            data={rows}
            columns={columns}
            getRowId={(row) => String(row.id)}
            storageKey={`records-${defId}`}
            searchable={false}
            emptyState={
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  {t("records.noRecords")}
                </CardContent>
              </Card>
            }
            className="border rounded-lg"
          />
        )}
      </div>
    </Layout>
  );
}