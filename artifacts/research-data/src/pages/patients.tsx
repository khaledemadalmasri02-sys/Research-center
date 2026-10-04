import { useState, useMemo, useRef, useEffect, useDeferredValue, useTransition } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DestructiveActionButton, ConfirmDestructive } from "@/components/confirm-destructive";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Plus, Trash2, ImageOff, Pencil, Eye, FileSpreadsheet, Download, Archive, Loader2, FileJson, Upload, Image as ImageIcon, Layers, Box, ChevronDown, Check } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { recordsApi, useActiveDefinition, type FieldDef, type RecordDefinition } from "@/lib/records";
import { PATIENTS_DEFINITION_NAME } from "@/lib/records";
import { exportToExcel, type ExportPatient } from "@/lib/export-utils";
import { exportImagesAsZip } from "@/lib/export-zip-utils";
import { ExcelImportDialog } from "@/components/excel-import-dialog";
import { ImportImagesDialog } from "@/components/import-images-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { normalizeRadiologyImages, resolveImageSrc } from "@/lib/radiology-images";
import { useDesktopNav } from "@/lib/desktop-nav";
import { useTranslation } from "react-i18next";
import { useLiveAnnouncer } from "@/components/live-region";
import { ErrorState, NoDataState } from "@/components/ui/states";
import { CrossFade, FadeIn } from "@/lib/page-motion";
import { Skeleton } from "@/components/ui/skeleton";

type PatientRow = {
  id: number;
  definitionId?: number;
  collectionName?: string;
  patientId?: string;
  patientName?: string;
  age?: number | string;
  sex?: string;
  collectionType?: string;
  dateOfVisit?: string;
  radiologyImages?: string[];
  createdAt?: string;
  [key: string]: unknown;
};

function resolveFirstImageSrc(images?: string | null | string[]): string | null {
  const list = normalizeRadiologyImages(images);
  for (const v of list) {
    const src = resolveImageSrc(v);
    if (src) return src;
  }
  return null;
}

function RadiologyThumb({ images }: { images?: string | null | string[] }) {
  const { t } = useTranslation();
  const src = resolveFirstImageSrc(images);
  if (!src) return <span className="text-muted-foreground/40"><ImageOff className="w-5 h-5" aria-hidden /></span>;
  return (
    <img
      src={src}
      alt={t("patients.thumbAlt")}
      loading="lazy"
      decoding="async"
      className="h-12 w-12 object-cover rounded border bg-muted"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

function TypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  const cls =
    type === "Normal"
      ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
      : type === "Abnormal"
      ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
      : "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200";
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{type}</span>;
}

function renderCell(value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) return value.length ? value.join(", ") : <span className="text-muted-foreground">—</span>;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function Patients() {
  const { t } = useTranslation();
  const { announce } = useLiveAnnouncer();
  const { data: def } = useActiveDefinition();
  const activeDefId = def?.id;
  const dn = useDesktopNav();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: collections } = useQuery({
    queryKey: ["collections-list"],
    queryFn: () => recordsApi.listDefinitions(),
  });

  // Only collections that haven't been deactivated are selectable in the directory.
  const selectableDefs = useMemo(
    () => (collections?.definitions ?? []).filter((d) => !d.deactivated),
    [collections],
  );
  const defMap = useMemo(
    () => new Map<number, RecordDefinition>((collections?.definitions ?? []).map((d) => [d.id, d])),
    [collections],
  );
  const patientsDefId = useMemo(
    () => (collections?.definitions ?? []).find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [collections],
  );

  // Which collections are shown in the directory. Defaults to the active one.
  const [viewCollections, setViewCollections] = useState<number[]>([]);
  useEffect(() => {
    if (viewCollections.length === 0 && activeDefId != null) {
      setViewCollections([activeDefId]);
    }
    // Drop any collection that has been deactivated so its records never show.
    setViewCollections((prev) => {
      const next = prev.filter((id) => !defMap.get(id)?.deactivated);
      return next.length === prev.length ? prev : next;
    });
  }, [activeDefId, viewCollections.length, defMap]);

  const selectedDefs = useMemo(
    () => viewCollections.map((id) => defMap.get(id)).filter((d): d is RecordDefinition => !!d && !d.deactivated),
    [viewCollections, defMap],
  );
  const singlePatients = selectedDefs.length === 1 && selectedDefs[0]?.name === PATIENTS_DEFINITION_NAME;

  const unionFields = useMemo(() => {
    const map = new Map<string, FieldDef>();
    selectedDefs.forEach((d) => (d.fields ?? []).forEach((f) => {
      if (f.type !== "image" && !map.has(f.key)) map.set(f.key, f);
    }));
    return [...map.values()];
  }, [selectedDefs]);

  const imageFieldKey = useMemo(() => {
    for (const d of selectedDefs) {
      const img = (d.fields ?? []).find((f) => f.type === "image");
      if (img) return img.key;
    }
    return undefined;
  }, [selectedDefs]);
  const hasImageCol = imageFieldKey !== undefined;

  const primaryDefId = viewCollections[0] ?? activeDefId;
  const primaryIsPatients = primaryDefId != null && primaryDefId === patientsDefId;

  const recordResults = useQueries({
    queries: viewCollections.map((id) => ({
      queryKey: ["records", id, "directory"],
      queryFn: () => recordsApi.listRecords(id),
      enabled: !!id,
    })),
  });

  const isLoading = recordResults.some((r) => r.isLoading);
  const isFetchingMore = recordResults.some((r) => r.isFetching);
  const loadErrors = recordResults
    .filter((r) => r.isError)
    .map((r) => (r.error as Error | null)?.message ?? t("common.errorTitle"));
  const isError = loadErrors.length > 0;

  const rows: PatientRow[] = useMemo(() => {
    const list: PatientRow[] = [];
    recordResults.forEach((res) => {
      (res.data?.records ?? []).forEach((r) => {
        if (defMap.get(r.definitionId)?.deactivated) return;
        list.push({
          id: r.id,
          definitionId: r.definitionId,
          collectionName: defMap.get(r.definitionId)?.name ?? "",
          ...(r.data as Record<string, unknown>),
          createdAt: r.createdAt,
        } as PatientRow);
      });
    });
    return list;
  }, [recordResults, defMap]);

  const [search, setSearch] = useState("");
  /* Filtering runs over every field of every record; keep the input
   * responsive by rendering the deferred value. Without this the directory
   * janked on every keystroke once a few thousand records were loaded. */
  const deferredSearch = useDeferredValue(search);
  const [isFiltering, startFiltering] = useTransition();
  const [sexFilter, setSexFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [imageImportOpen, setImageImportOpen] = useState(false);
  const [isZipExporting, setIsZipExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  function toExportPatient(r: PatientRow) {
    const d = r as Record<string, unknown>;
    const out: Record<string, unknown> = {
      id: r.id,
      collection: r.collectionName ?? "",
    };
    for (const k of Object.keys(d)) {
      if (k === "id" || k === "collectionName" || k === "definitionId") continue;
      out[k] = d[k];
    }
    out.radiologyImages = JSON.stringify(normalizeRadiologyImages(d.radiologyImages));
    return out;
  }

  function toZipPatient(r: PatientRow) {
    const d = r as Record<string, unknown>;
    return {
      patientId: (d.patientId as string) ?? String(r.id ?? ""),
      patientName: (d.patientName as string) ?? "",
      radiologyImages: JSON.stringify(normalizeRadiologyImages(d.radiologyImages)),
    };
  }

  async function handleExportExcel() {
    if (exportTarget.length === 0) {
      toast({ title: t("patients.nothingToExport"), variant: "destructive" });
      return;
    }
    try {
      await exportToExcel(
        exportTarget.map((r) => toExportPatient(r)) as unknown as ExportPatient[],
        selectedDefs[0]?.name ?? "patients",
      );
      toast({
        title: t("patients.exportComplete"),
        description: t("patients.exportCompleteBody", { count: exportTarget.length }),
      });
    } catch (e) {
      toast({ title: t("patients.exportFailed"), description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleExportZip() {
    if (exportTarget.length === 0) {
      toast({ title: t("patients.nothingToExport"), variant: "destructive" });
      return;
    }
    const withImages = exportTarget.filter((p) => {
      const imgs = (p as Record<string, unknown>).radiologyImages;
      return Array.isArray(imgs) && (imgs as string[]).length > 0;
    });
    if (withImages.length === 0) {
      toast({
        title: t("patients.noImagesToExport"),
        description: t("patients.noImagesToExportBody"),
        variant: "destructive",
      });
      return;
    }
    setIsZipExporting(true);
    setZipProgress({ done: 0, total: 0 });
    try {
      const res = await exportImagesAsZip(withImages.map(toZipPatient), (done, total) =>
        setZipProgress({ done, total }),
      );
      toast({
        title: t("patients.imagesExported"),
        description: t("patients.imagesExportedBody", {
          downloaded: res.downloaded,
          skipped: res.skipped,
        }),
      });
    } catch (e) {
      toast({ title: t("patients.exportFailed"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setIsZipExporting(false);
      setZipProgress(null);
    }
  }

  function handleJsonExport() {
    if (exportTarget.length === 0) {
      toast({ title: t("patients.nothingToExport"), variant: "destructive" });
      return;
    }
    const clean = exportTarget.map(toExportPatient);
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedDefs[0]?.name ?? "patients"}_${format(new Date(), "yyyy-MM-dd")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({
      title: t("patients.jsonExported"),
      description: t("patients.exportCompleteBody", { count: exportTarget.length }),
    });
  }

  async function handleExcelImport(patients: Record<string, unknown>[]) {
    let imported = 0;
    let failed = 0;
    // Row numbers are reported so the Excel dialog can name the failing row.
    // These errors used to be collected and then thrown away, so a user had
    // no way to find out which rows had not imported.
    const errors: { row: number; reason: string }[] = [];
    const targetId = primaryDefId;
    if (targetId == null) {
      toast({ title: t("patients.noCollectionSelected"), variant: "destructive" });
      return { imported: 0, failed: 0, errors: [] };
    }
    for (const [i, p] of patients.entries()) {
      try {
        const data: Record<string, unknown> = { ...p };
        if (typeof data.radiologyImages === "string") {
          try {
            data.radiologyImages = JSON.parse(data.radiologyImages);
          } catch {
            data.radiologyImages = [];
          }
        }
        delete data.radiologyImageFilePathOrLink;
        await recordsApi.createRecord(targetId, data);
        imported++;
      } catch (e) {
        failed++;
        errors.push({ row: i + 1, reason: (e as Error).message || t("common.unknown") });
      }
    }
    qc.invalidateQueries({ queryKey: ["records", targetId] });
    toast({
      title: t("patients.importSummary", { imported }),
      description: failed > 0 ? t("patients.importFailedBody", { failed }) : undefined,
      variant: failed > 0 ? "destructive" : "default",
    });
    return { imported, failed, errors };
  }

  function normalizeForRecord(rec: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...rec };
    delete out.id;
    delete out.createdAt;
    delete out.updatedAt;
    delete out.radiologyImageFilePathOrLink;

    if (Array.isArray(out.radiologyImages)) {
      // keep as array
    } else if (typeof out.radiologyImages === "string") {
      try {
        const parsed = JSON.parse(out.radiologyImages);
        out.radiologyImages = Array.isArray(parsed) ? parsed : [out.radiologyImages];
      } catch {
        out.radiologyImages = out.radiologyImages ? [out.radiologyImages] : [];
      }
    } else if (out.radiologyImages) {
      out.radiologyImages = [String(out.radiologyImages)];
    } else {
      out.radiologyImages = [];
    }

    if (typeof out.age === "string") {
      const n = parseFloat(out.age);
      out.age = !isNaN(n) ? Math.round(n) : null;
    }
    return out;
  }

  async function handleJsonImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const targetId = primaryDefId;
    if (targetId == null) {
      toast({ title: t("patients.noCollectionSelected"), variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast({
          title: t("destructive.failed"),
          description: t("importExcel.urlFailed"),
          variant: "destructive",
        });
        return;
      }
      const records = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const rec of records) {
        try {
          await recordsApi.createRecord(targetId, normalizeForRecord(rec));
          imported++;
        } catch (err) {
          failed++;
          errors.push((err as Error).message || "Unknown error");
        }
      }
      qc.invalidateQueries({ queryKey: ["records", targetId] });
      if (failed > 0 && imported === 0) {
        toast({
          title: t("destructive.failed"),
          description: t("importExcel.resultFailedCount", { count: failed }),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("importExcel.resultOk", { count: imported }),
          description: failed
            ? `${t("importExcel.resultFailedCount", { count: failed })} — ${[...new Set(errors)].slice(0, 2).join("; ")}`
            : undefined,
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    } finally {
      setIsImporting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q && !search.trim()) return rows.filter((p) => {
      if (singlePatients) {
        if (sexFilter !== "all" && p.sex !== sexFilter) return false;
        if (typeFilter !== "all" && p.collectionType !== typeFilter) return false;
      }
      return true;
    });
    return rows.filter((p) => {
      if (singlePatients) {
        if (sexFilter !== "all" && p.sex !== sexFilter) return false;
        if (typeFilter !== "all" && p.collectionType !== typeFilter) return false;
      }
      if (q) {
        const hay = [p.collectionName, ...Object.values(p)].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Sorting is now handled by <DataTable>.
  }, [rows, deferredSearch, search, sexFilter, typeFilter, singlePatients]);

  const exportTarget = selectedIds.size > 0 ? filtered.filter((p) => selectedIds.has(p.id)) : filtered;

  const allIds = filtered.map((p) => p.id);

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteOne(id: number) {
    try {
      await recordsApi.deleteRecord(id);
      qc.invalidateQueries({ queryKey: ["records"] });
      toast({ title: t("records.deleted"), description: t("records.deletedBody") });
    } catch (e) {
      toast({
        title: t("destructive.failed"),
        description: (e as Error).message || t("records.deleteFailed"),
        variant: "destructive",
      });
      throw e;
    }
    setRowToDelete(null);
  }

  async function deleteSelected() {
    setIsDeletingSelected(true);
    let deleted = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await recordsApi.deleteRecord(id);
        deleted++;
      } catch {
        failed++;
      }
    }
    qc.invalidateQueries({ queryKey: ["records"] });
    setSelectedIds(new Set());
    setIsDeletingSelected(false);
    toast({
      title: t("common.rowsCount", { count: deleted }),
      description: failed > 0 ? t("importExcel.resultFailedCount", { count: failed }) : undefined,
      variant: failed > 0 ? "destructive" : "default",
    });
    announce(t("a11y.resultsAnnounced", { count: deleted }));
  }

  const newHref = primaryIsPatients ? "/patients/new" : primaryDefId != null ? `/records/${primaryDefId}/new` : "/patients/new";
  const viewHref = (p: PatientRow) =>
    p.definitionId === patientsDefId ? `/patients/${p.id}` : `/records/${p.definitionId}/${p.id}`;
  const editHref = (p: PatientRow) =>
    p.definitionId === patientsDefId ? `/patients/${p.id}/edit` : `/records/${p.definitionId}/${p.id}`;

  const viewAppId = (p: PatientRow) => (p.definitionId === patientsDefId ? "patient-view" : "record-detail");
  const editAppId = (p: PatientRow) => (p.definitionId === patientsDefId ? "patient-edit" : "record-detail");
  const openView = (p: PatientRow) => dn.open(viewAppId(p), viewHref(p));
  const openEdit = (p: PatientRow) => dn.open(editAppId(p), editHref(p));

  // Build the <DataTable> column definitions dynamically. The table is
  // virtualized + sortable inside <DataTable>; this component only owns
  // the row data and selection state.
  const columns: ColumnDef<PatientRow, unknown>[] = useMemo(() => {
    const cols: ColumnDef<PatientRow, unknown>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
            aria-label={t("patients.selectAllRows")}
            className="translate-y-[1px]"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label={t("patients.selectRow")}
            className="translate-y-[1px]"
            onClick={(e) => {
              // Selection is driven entirely by TanStack's row model. Stop the
              // click here so the (soon to be) row-level onRowClick handler
              // does not also navigate when the checkbox is used.
              e.stopPropagation();
            }}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ];

    if (hasImageCol) {
      cols.push({
        accessorKey: "radiologyImages",
        id: "image",
        header: t("patients.colImage"),
        cell: ({ row }) => <RadiologyThumb images={row.original[imageFieldKey!] as string | string[] | null} />,
        enableSorting: false,
        size: 56,
      });
    }

    if (singlePatients) {
      cols.push(
        {
          accessorKey: "patientId",
          header: t("patients.colPatientId") ?? t("common.patientId"),
          cell: ({ row }) => (
            <button
              type="button"
              className="text-start text-primary hover:underline underline-offset-2 font-medium"
              onClick={() => openView(row.original)}
              aria-label={`${t("common.viewRecord")}: ${row.original.patientId ?? row.original.id}`}
            >
              {row.original.patientId ?? "—"}
            </button>
          ),
        },
        { accessorKey: "patientName", header: t("common.patientName"), cell: ({ row }) => row.original.patientName ?? "—" },
        { accessorKey: "age", header: t("patients.colAge"), cell: ({ row }) => row.original.age ?? "—" },
        { accessorKey: "sex", header: t("patients.colSex"), cell: ({ row }) => row.original.sex ?? "—" },
        {
          accessorKey: "collectionType",
          header: t("patients.colType"),
          cell: ({ row }) => <TypeBadge type={row.original.collectionType} />,
        },
        { accessorKey: "dateOfVisit", header: t("patients.colDateOfVisit"), cell: ({ row }) => row.original.dateOfVisit ?? "—" },
      );
    } else {
      cols.push(
        { accessorKey: "collectionName", header: t("patients.colCollection"), cell: ({ row }) => row.original.collectionName ?? "—" },
        ...unionFields.map((f) => ({
          accessorKey: f.key,
          header: f.label,
          cell: ({ row }: { row: { original: PatientRow } }) => {
            const v = row.original[f.key];
            if (f.key === "patientId" || f.key === "name" || f.key === "title") {
              return (
                <button
                  type="button"
                  className="text-start text-primary hover:underline underline-offset-2 font-medium max-w-full truncate block"
                  onClick={() => openView(row.original)}
                  aria-label={`${t("common.openRecord")}: ${String(v ?? row.original.id)}`}
                >
                  {v == null || v === "" ? "—" : String(v)}
                </button>
              );
            }
            return renderCell(v);
          },
        })),
      );
    }

    cols.push({
      id: "actions",
      header: t("patients.colActions"),
      cell: ({ row }) => {
        const label = String(row.original.patientId ?? row.original.id);
        return (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                openView(row.original);
              }}
              title={t("common.viewRecord")}
              aria-label={`${t("common.viewRecord")}: ${label}`}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row.original);
              }}
              title={t("common.editRecord")}
              aria-label={`${t("common.editRecord")}: ${label}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <DestructiveActionButton
              trigger={<Trash2 className="h-4 w-4" />}
              triggerLabel={`${t("common.deleteRecord")}: ${label}`}
              triggerClassName="text-destructive"
              title={t("records.deleteTitle")}
              description={t("destructive.body")}
              subject={`${row.original.patientName ?? label} · ${label}`}
              confirmLabel={t("common.delete")}
              onSelect={async () => {
                await deleteOne(row.original.id);
              }}
            />
          </div>
        );
      },
      enableSorting: false,
    });

    return cols;
  }, [t, selectedDefs, unionFields, hasImageCol, imageFieldKey, openView, openEdit, deleteOne]);

  // Bridge external Set<number> selection into the table's row model.
  const rowSelectionState: Record<string, boolean> = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const id of selectedIds) m[String(id)] = true;
    return m;
  }, [selectedIds]);

  const title =
    selectedDefs.length === 1
      ? selectedDefs[0].name
      : selectedDefs.length === 0
      ? t("patients.title")
      : t("patients.collectionsTitle", { count: selectedDefs.length });

  /**
   * The exports operate on `exportTarget`, which is the *filtered* set (or the
   * selection). Previously the button said nothing about scope, so a user who
   * had filtered down to one patient could not tell that "Excel (128)" would
   * still write the whole collection. Make the scope explicit.
   */
  const exportScopeTitle =
    selectedIds.size > 0
      ? t("common.selectedCount", { count: selectedIds.size })
      : search.trim() || (singlePatients && (sexFilter !== "all" || typeFilter !== "all"))
      ? t("patients.exportingFiltered", { count: filtered.length })
      : t("common.rowsCount", { count: filtered.length });

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1 tabular-nums">
              {t("common.rowsCount", { count: filtered.length })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="outline"
              className="h-9 gap-1.5"
              disabled={filtered.length === 0}
              onClick={() => {
                const firstId = filtered[0]?.id;
                if (firstId == null) return;
                dn.open("patient-workspace", `/patients/spatial/${firstId}`);
              }}
            >
              <Box className="h-4 w-4" /> Spatial View
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-1.5"
              disabled={filtered.length === 0}
              onClick={() => dn.open("patient-corridor", "/patients/vr")}
            >
              <Box className="h-4 w-4" /> 2D Scroll
            </Button>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              <span className="hidden sm:inline">{t("patients.collectionsLabel")}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-9 justify-between gap-2 min-w-[200px]">
                    <span className="truncate">
                      {viewCollections.length === 0
                        ? t("patients.selectCollections")
                        : t("patients.selectedCollections", { count: viewCollections.length })}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2">
                  <div className="max-h-72 overflow-auto space-y-1">
                    {selectableDefs.length === 0 && (
                      <p className="text-sm text-muted-foreground px-2 py-1">
                        {t("patients.noCollections")}
                      </p>
                    )}
                    {selectableDefs.map((c) => {
                      const checked = viewCollections.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setViewCollections((prev) =>
                              prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                            )
                          }
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
                        >
                          <span className={cn("flex h-4 w-4 items-center justify-center rounded border", checked ? "bg-primary border-primary text-primary-foreground" : "border-input")}>
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          <span className="flex-1 text-start truncate">{c.name}</span>
                          {c.isActive && <span className="text-xs uppercase text-emerald-600">viewed</span>}
                        </button>
                      );
                    })}
                  </div>
                  {viewCollections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setViewCollections([])}
                      className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear selection
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={exportTarget.length === 0}
              title={exportScopeTitle}
            >
              <Download className="w-4 h-4 mr-2 text-blue-600" />
              {selectedIds.size > 0
                ? `${t("patients.exportExcel")} (${selectedIds.size})`
                : `${t("patients.exportExcel")} (${filtered.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportZip}
              disabled={isZipExporting || exportTarget.length === 0}
              title={exportScopeTitle}
            >
              {isZipExporting ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Archive className="w-4 h-4 mr-2 text-violet-600" />
              )}
              {isZipExporting && zipProgress && zipProgress.total > 0
                ? `${zipProgress.done}/${zipProgress.total}`
                : selectedIds.size > 0
                ? `${t("patients.exportZip")} (${selectedIds.size})`
                : `${t("patients.exportZip")} (${filtered.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={handleJsonExport}
              disabled={exportTarget.length === 0}
              title={exportScopeTitle}
            >
              <FileJson className="w-4 h-4 mr-2" />
              {selectedIds.size > 0
                ? `${t("patients.exportJson")} (${selectedIds.size})`
                : `${t("patients.exportJson")} (${filtered.length})`}
            </Button>
            <Button variant="outline" onClick={() => setExcelOpen(true)}>
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" /> {t("patients.importExcel")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImageImportOpen(true)}>
              <ImageIcon className="w-4 h-4 mr-1.5" /> {t("patients.importImages")}
            </Button>
            <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={isImporting}>
              {isImporting ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2 text-orange-600" />
              )}
              {isImporting ? t("patients.importing") : t("patients.importJson")}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label={t("patients.importJson")}
              onChange={handleJsonImport}
            />
            <Button onClick={() => dn.open(primaryIsPatients ? "patients/new" : "records/:definitionId/new", newHref)}>
              <Plus className="w-4 h-4 mr-2" />{" "}
              {primaryIsPatients ? t("patients.newPatient") : t("patients.newRecord")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => startFiltering(() => setSearch(e.target.value))}
              placeholder={t("patients.search")}
              aria-label={t("patients.search")}
              className="ps-8"
            />
          </div>
          {singlePatients && (
            <>
              <Select value={sexFilter} onValueChange={setSexFilter}>
                <SelectTrigger className="sm:w-40" aria-label={t("patients.colSex")}>
                  <SelectValue placeholder={t("patients.colSex")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("patients.allSexes")}</SelectItem>
                  <SelectItem value="Male">{t("patients.male")}</SelectItem>
                  <SelectItem value="Female">{t("patients.female")}</SelectItem>
                  <SelectItem value="Other">{t("patients.other")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="sm:w-44" aria-label={t("patients.colType")}>
                  <SelectValue placeholder={t("patients.colType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("patients.allTypes")}</SelectItem>
                  <SelectItem value="Normal">{t("patients.normal")}</SelectItem>
                  <SelectItem value="Abnormal">{t("patients.abnormal")}</SelectItem>
                  <SelectItem value="Suspicious">{t("patients.suspicious")}</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>

{selectedIds.size > 0 && (
          <div
            role="region"
            aria-label={t("a11y.rowActions")}
            className="flex items-center gap-3 bg-secondary/50 border rounded-md px-3 py-2"
          >
            <span className="text-sm">{t("common.selectedCount", { count: selectedIds.size })}</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeletingSelected}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> {t("patients.deleteSelected")}
            </Button>
          </div>
        )}

        </FadeIn>

        <ConfirmDestructive
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          title={t("patients.deleteSelectedTitle", { count: selectedIds.size })}
          description={t("destructive.body")}
          confirmLabel={isDeletingSelected ? t("common.deleting") : t("common.delete")}
          onConfirm={deleteSelected}
        />

        {/*
          isError-first. Without this a 500 produced the same empty table as an
          empty collection, and a radiologist could read "no patients" off a
          failed request.
        */}
        {isError ? (
          <ErrorState
            title={t("common.errorTitle")}
            description={loadErrors.join(" · ")}
            action={
              <Button
                onClick={() => {
                  for (const q of recordResults) void q.refetch();
                }}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          /*
           * NO per-row entrance animation here, deliberately. This table is
           * virtualized and can hold 2,000 rows; a stagger would either run for
           * minutes or have to be capped so hard that it does nothing. The
           * cross-fade below is the whole of the motion budget for this page.
           */
          <CrossFade
            loading={isLoading}
            label={t("common.loading")}
            skeleton={
              <div className="space-y-2 rounded-lg border p-3">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            }
          >
          <DataTable<PatientRow>
            data={filtered}
          columns={columns}
          getRowId={(row) => String(row.id)}
          storageKey="patients-directory-v2"
          searchable={false}
          enableRowSelection
          /* The actions column is the primary route from the table to a
           * record. It was defaulted to hidden, so the only way to reach a
           * patient was to open the Columns menu — and the hidden state was
           * persisted, so it stayed that way forever. */
          initialColumnVisibility={{ actions: true }}
          rowSelection={rowSelectionState}
          onRowSelectionChange={(updater) => {
            // TanStack passes an *updater function* (or, when controlled by an
            // object, a plain RowSelectionState). Resolving both forms keeps
            // this compiling against either signature of DataTable's prop.
            const next = (
              typeof updater === "function"
                ? (updater as (old: Record<string, boolean>) => Record<string, boolean>)(rowSelectionState)
                : updater
            ) as Record<string, boolean> | undefined;
            const ids = new Set<number>();
            for (const key of Object.keys(next ?? {})) {
              const num = Number(key);
              if (!Number.isNaN(num)) ids.add(num);
            }
            setSelectedIds(ids);
          }}
          emptyState={
            <NoDataState
              title={t("patients.noRecords")}
              description={t("patients.noRecordsDesc")}
            />
          }
          className="border rounded-lg"
        />
          </CrossFade>
        )}

        <ExcelImportDialog open={excelOpen} onOpenChange={setExcelOpen} onImport={handleExcelImport} />
        <ImportImagesDialog
          open={imageImportOpen}
          onOpenChange={(v) => {
            setImageImportOpen(v);
            if (!v) qc.invalidateQueries({ queryKey: ["records"] });
          }}
        />
      </div>
    </Layout>
  );
}
