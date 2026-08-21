import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, ImageOff, Pencil, Eye, FileSpreadsheet, Download, Archive, Loader2, FileJson, Upload, Image as ImageIcon, Database, Check, Layers } from "lucide-react";
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
  const src = resolveFirstImageSrc(images);
  if (!src) return <span className="text-muted-foreground/40"><ImageOff className="w-5 h-5" /></span>;
  return (
    <img
      src={src}
      alt="Radiology"
      className="w-12 h-12 object-cover rounded border bg-muted"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

function TypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  const cls =
    type === "Normal"
      ? "bg-green-100 text-green-800"
      : type === "Abnormal"
      ? "bg-red-100 text-red-800"
      : "bg-yellow-100 text-yellow-800";
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{type}</span>;
}

function renderCell(value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) return value.length ? value.join(", ") : <span className="text-muted-foreground">—</span>;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function Patients() {
  const { data: def } = useActiveDefinition();
  const activeDefId = def?.id;
  const [, navigate] = useLocation();
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
  const [sexFilter, setSexFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<number | null>(null);
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
      toast({ title: "Nothing to export", variant: "destructive" });
      return;
    }
    try {
      await exportToExcel(exportTarget.map((r) => toExportPatient(r)) as unknown as ExportPatient[], selectedDefs[0]?.name ?? "patients");
      toast({ title: "Export complete", description: `${exportTarget.length} record(s) exported.` });
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleExportZip() {
    if (exportTarget.length === 0) {
      toast({ title: "Nothing to export", variant: "destructive" });
      return;
    }
    const withImages = exportTarget.filter((p) => {
      const imgs = (p as Record<string, unknown>).radiologyImages;
      return Array.isArray(imgs) && (imgs as string[]).length > 0;
    });
    if (withImages.length === 0) {
      toast({ title: "No images to export", description: "None of the selected records have radiology images.", variant: "destructive" });
      return;
    }
    setIsZipExporting(true);
    setZipProgress({ done: 0, total: 0 });
    try {
      const res = await exportImagesAsZip(withImages.map(toZipPatient), (done, total) =>
        setZipProgress({ done, total }),
      );
      toast({
        title: "Images exported",
        description: `${res.downloaded} downloaded, ${res.skipped} skipped.`,
      });
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setIsZipExporting(false);
      setZipProgress(null);
    }
  }

  function handleJsonExport() {
    if (exportTarget.length === 0) {
      toast({ title: "Nothing to export", variant: "destructive" });
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
    toast({ title: "JSON exported", description: `${exportTarget.length} record(s) saved.` });
  }

  async function handleExcelImport(patients: Record<string, unknown>[]) {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];
    const targetId = primaryDefId;
    if (targetId == null) {
      toast({ title: "No collection selected", variant: "destructive" });
      return { imported: 0, failed: 0, errors: [] };
    }
    for (const p of patients) {
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
        errors.push((e as Error).message);
      }
    }
    qc.invalidateQueries({ queryKey: ["records", targetId] });
    toast({
      title: `Imported ${imported} record(s)`,
      description: failed > 0 ? `${failed} failed.` : undefined,
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
      toast({ title: "No collection selected", variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast({ title: "Import failed", description: "The file is not valid JSON.", variant: "destructive" });
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
        toast({ title: "Import failed", description: `All ${failed} record(s) failed.`, variant: "destructive" });
      } else {
        toast({
          title: "Import complete",
          description: `${imported} imported${failed ? `, ${failed} failed — ${[...new Set(errors)].slice(0, 2).join("; ")}` : ""}.`,
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    } finally {
      setIsImporting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((p) => {
        if (singlePatients) {
          if (sexFilter !== "all" && p.sex !== sexFilter) return false;
          if (typeFilter !== "all" && p.collectionType !== typeFilter) return false;
        }
        if (q) {
          const hay = [p.collectionName, ...Object.values(p)].filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [rows, search, sexFilter, typeFilter, sortKey, sortDir, singlePatients]);

  const exportTarget = selectedIds.size > 0 ? filtered.filter((p) => selectedIds.has(p.id)) : filtered;

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/40 inline" />;
    return sortDir === "asc" ? <ChevronUp className="ml-1 h-3.5 w-3.5 inline" /> : <ChevronDown className="ml-1 h-3.5 w-3.5 inline" />;
  }

  const allIds = filtered.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }
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
      toast({ title: "Deleted", description: "Record removed." });
    } catch {
      toast({ title: "Error", description: "Failed to delete record.", variant: "destructive" });
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
      title: `Deleted ${deleted} record(s)`,
      description: failed > 0 ? `${failed} could not be deleted.` : undefined,
      variant: failed > 0 ? "default" : "default",
    });
  }

  const newHref = primaryIsPatients ? "/patients/new" : primaryDefId != null ? `/records/${primaryDefId}/new` : "/patients/new";
  const viewHref = (p: PatientRow) =>
    p.definitionId === patientsDefId ? `/patients/${p.id}` : `/records/${p.definitionId}/${p.id}`;
  const editHref = (p: PatientRow) =>
    p.definitionId === patientsDefId ? `/patients/${p.id}/edit` : `/records/${p.definitionId}/${p.id}`;

  const title =
    selectedDefs.length === 1
      ? selectedDefs[0].name
      : selectedDefs.length === 0
      ? "Patient Directory"
      : `${selectedDefs.length} collections`;

  const baseCols = 1 + (hasImageCol ? 1 : 0) + (singlePatients ? 6 : 1 + unionFields.length);
  const fullCols = baseCols + 1;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1">{filtered.length} record(s)</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              <span className="hidden sm:inline">Collections:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-9 justify-between gap-2 min-w-[200px]">
                    <span className="truncate">
                      {viewCollections.length === 0
                        ? "Select collections"
                        : `${viewCollections.length} collection${viewCollections.length > 1 ? "s" : ""}`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2">
                  <div className="max-h-72 overflow-auto space-y-1">
                    {selectableDefs.length === 0 && (
                      <p className="text-sm text-muted-foreground px-2 py-1">No collections available.</p>
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
                          <span className="flex-1 text-left truncate">{c.name}</span>
                          {c.isActive && <span className="text-[10px] uppercase text-emerald-600">viewed</span>}
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
            <Button variant="outline" onClick={handleExportExcel} disabled={exportTarget.length === 0}>
              <Download className="w-4 h-4 mr-2 text-blue-600" />
              {selectedIds.size > 0 ? `Excel (${selectedIds.size})` : `Excel (${filtered.length})`}
            </Button>
            <Button variant="outline" onClick={handleExportZip} disabled={isZipExporting || exportTarget.length === 0}>
              {isZipExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Archive className="w-4 h-4 mr-2 text-violet-600" />}
              {isZipExporting && zipProgress && zipProgress.total > 0
                ? `${zipProgress.done}/${zipProgress.total} images…`
                : selectedIds.size > 0
                ? `Images ZIP (${selectedIds.size})`
                : `Images ZIP (${filtered.length})`}
            </Button>
            <Button variant="outline" onClick={handleJsonExport} disabled={exportTarget.length === 0}>
              <FileJson className="w-4 h-4 mr-2" />
              {selectedIds.size > 0 ? `JSON (${selectedIds.size})` : `JSON (${filtered.length})`}
            </Button>
            <Button variant="outline" onClick={() => setExcelOpen(true)}>
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" /> Import Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImageImportOpen(true)}>
              <ImageIcon className="w-4 h-4 mr-1.5" /> Import Images
            </Button>
            <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={isImporting}>
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2 text-orange-600" />}
              {isImporting ? "Importing…" : "Import JSON"}
            </Button>
            <input ref={importInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={handleJsonImport} />
            <Button onClick={() => navigate(newHref)}>
              <Plus className="w-4 h-4 mr-2" /> {primaryIsPatients ? "New Patient" : "New Record"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          {singlePatients && (
            <>
              <Select value={sexFilter} onValueChange={setSexFilter}>
                <SelectTrigger className="sm:w-40"><SelectValue placeholder="Sex" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sexes</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="sm:w-44"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="Abnormal">Abnormal</SelectItem>
                  <SelectItem value="Suspicious">Suspicious</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-secondary/50 border rounded-md px-3 py-2">
            <span className="text-sm">{selectedIds.size} selected</span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isDeletingSelected}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selectedIds.size} record(s)?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteSelected} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                </TableHead>
                {hasImageCol && <TableHead className="w-14">Img</TableHead>}
                {singlePatients ? (
                  <>
                    <TableHead className="w-14 cursor-pointer" onClick={() => toggleSort("patientId")}>Patient ID <SortIcon col="patientId" /></TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("patientName")}>Name <SortIcon col="patientName" /></TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("age")}>Age <SortIcon col="age" /></TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("sex")}>Sex <SortIcon col="sex" /></TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("collectionType")}>Type <SortIcon col="collectionType" /></TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("dateOfVisit")}>Date of Visit <SortIcon col="dateOfVisit" /></TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("collectionName")}>Collection <SortIcon col="collectionName" /></TableHead>
                    {unionFields.map((f) => (
                      <TableHead key={f.key} className="cursor-pointer" onClick={() => toggleSort(f.key)}>
                        {f.label} <SortIcon col={f.key} />
                      </TableHead>
                    ))}
                  </>
                )}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={fullCols}><Skeleton className="h-10 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={fullCols} className="text-center text-muted-foreground py-10">No records found.</TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={`${p.definitionId}-${p.id}`} data-state={selectedIds.has(p.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleOne(p.id)} aria-label="Select row" />
                    </TableCell>
                    {hasImageCol && (
                      <TableCell><RadiologyThumb images={p[imageFieldKey!] as string | string[] | null} /></TableCell>
                    )}
                    {singlePatients ? (
                      <>
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            className="text-left text-blue-600 hover:underline underline-offset-2 font-medium"
                            onClick={() => navigate(viewHref(p))}
                            title="Open record"
                          >
                            {p.patientId ?? "—"}
                          </button>
                        </TableCell>
                        <TableCell>{p.patientName ?? "—"}</TableCell>
                        <TableCell>{p.age ?? "—"}</TableCell>
                        <TableCell>{p.sex ?? "—"}</TableCell>
                        <TableCell><TypeBadge type={p.collectionType} /></TableCell>
                        <TableCell>{p.dateOfVisit ?? "—"}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="font-medium">{p.collectionName ?? "—"}</TableCell>
                        {unionFields.map((f) => (
                          <TableCell key={f.key} className="max-w-[220px] truncate">
                            {f.type === "image"
                              ? renderCell(p[f.key])
                              : (() => {
                                  const v = p[f.key];
                                  if (f.key === "patientId" || f.key === "name" || f.key === "title") {
                                    return (
                                      <button
                                        type="button"
                                        className="text-left text-blue-600 hover:underline underline-offset-2 font-medium max-w-full truncate block"
                                        onClick={() => navigate(viewHref(p))}
                                        title="Open record"
                                      >
                                        {v == null || v === "" ? "—" : String(v)}
                                      </button>
                                    );
                                  }
                                  return renderCell(v);
                                })()}
                          </TableCell>
                        ))}
                      </>
                    )}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => navigate(viewHref(p))} title="View">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate(editHref(p))} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive" title="Delete">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteOne(p.id)} className="bg-destructive text-destructive-foreground">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

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
