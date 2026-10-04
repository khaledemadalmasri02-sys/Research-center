import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Search, Download, Bookmark, Trash2, Save, Loader2 } from "lucide-react";
import {
  useSavedViews,
  useSaveView,
  useDeleteView,
  describeView,
} from "@/lib/saved-views";
import { downloadAuthenticated } from "@/lib/export-download";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { useToast } from "@/hooks/use-toast";
import { EmptySavedViews } from "@/components/empty-saved-views";

export function RecordsToolbar({
  definitionId,
  canEdit,
  q,
  onQueryChange,
  sex,
  onSexChange,
  type,
  onTypeChange,
}: {
  definitionId: number;
  canEdit: boolean;
  q: string;
  onQueryChange: (q: string) => void;
  sex?: string;
  onSexChange?: (v: string) => void;
  type?: string;
  onTypeChange?: (v: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [viewToDelete, setViewToDelete] = useState<{ id: number; name: string } | null>(null);

  const views = useSavedViews(definitionId);
  const saveView = useSaveView(definitionId);
  const deleteView = useDeleteView(definitionId);

  const activeFilters =
    (q ? 1 : 0) + (sex && sex !== "all" ? 1 : 0) + (type && type !== "all" ? 1 : 0);

  async function runExport(url: string, filename: string) {
    try {
      await downloadAuthenticated(url, filename);
    } catch (e) {
      toast({
        title: t("patients.exportFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  function applyView(v: { q?: string; sex?: string; type?: string }) {
    onQueryChange(v.q ?? "");
    onSexChange?.(v.sex ?? "all");
    onTypeChange?.(v.type ?? "all");
  }

  const exportTitle = activeFilters
    ? t("records.exportFiltered", { count: activeFilters })
    : t("records.exportCsv");

  const exportUrl = (format: "csv" | "excel") => {
    // The export must respect the active filter: previously it always dumped
    // the whole collection, so a user who had filtered down to one patient
    // still downloaded — and could leak — the entire dataset.
    const params = new URLSearchParams({ format });
    if (q.trim()) params.set("q", q.trim());
    if (sex && sex !== "all") params.set("sex", sex);
    if (type && type !== "all") params.set("type", type);
    return `/api/records/${definitionId}/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("records.search")}
          aria-label={t("records.search")}
          className="ps-8 h-9"
        />
      </div>

      {canEdit && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runExport(exportUrl("csv"), `records-${definitionId}.csv`)
            }
            title={exportTitle}
          >
            <Download className="h-4 w-4 mr-1" /> {t("records.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runExport(exportUrl("excel"), `records-${definitionId}.xlsx`)
            }
          >
            <Download className="h-4 w-4 mr-1" /> {t("records.exportExcel")}
          </Button>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={t("savedViews.menu")}>
            <Bookmark className="h-4 w-4 mr-1" /> {t("savedViews.menu")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t("savedViews.menu")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {views.isError ? (
            <div className="px-2 py-3 text-sm text-destructive" role="alert">
              {t("savedViews.loadFailed")}
            </div>
          ) : views.data?.views.length ? (
            views.data.views.map((v) => {
              const summary = describeView(v, t);
              return (
                /* Previously this item wrapped TWO <button>s (apply + delete).
                 * Radix menus trap Tab and activate with Enter/Space, so a
                 * keyboard user could never reach either button. The item is
                 * now the apply action and delete lives in a submenu. */
                <DropdownMenuItem
                  key={v.id}
                  className="flex items-center justify-between gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    applyView(v);
                  }}
                >
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block truncate">{v.name}</span>
                    {summary && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {summary}
                      </span>
                    )}
                  </span>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      aria-label={t("savedViews.delete")}
                      className="ms-auto shrink-0"
                      onSelect={(e) => e.preventDefault()}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={(e) => {
                          e.preventDefault();
                          setViewToDelete({ id: v.id, name: v.name });
                        }}
                      >
                        {t("savedViews.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuItem>
              );
            })
          ) : (
            <EmptySavedViews />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <div className="flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("savedViews.namePlaceholder")}
            aria-label={t("savedViews.name")}
            className="h-9 w-32"
          />
          <Button
            size="sm"
            aria-label={t("savedViews.save")}
            title={t("savedViews.save")}
            disabled={!name.trim() || saveView.isPending}
            onClick={() => {
              saveView.mutate(
                { name: name.trim(), q, sex, type },
                {
                  onSuccess: () => setName(""),
                  onError: (e) =>
                    toast({
                      title: t("savedViews.saveFailed"),
                      description: (e as Error).message,
                      variant: "destructive",
                    }),
                },
              );
            }}
          >
            {saveView.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}

      <ConfirmDestructive
        open={viewToDelete !== null}
        onOpenChange={(v) => {
          if (!v) setViewToDelete(null);
        }}
        title={t("savedViews.deleteTitle")}
        description={t("savedViews.deleteBody", { name: viewToDelete?.name ?? "" })}
        confirmLabel={t("savedViews.delete")}
        onConfirm={async () => {
          if (!viewToDelete) return;
          await deleteView.mutateAsync(viewToDelete.id);
          setViewToDelete(null);
        }}
      />
    </div>
  );
}