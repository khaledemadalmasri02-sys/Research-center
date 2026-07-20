import { useListPatients, useCreatePatient, useDeletePatient, getListPatientsQueryKey, getGetPatientStatsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useMemo, useRef } from "react";
import { format } from "date-fns";
import { Search, Plus, ImageOff, FileSpreadsheet, Loader2, Download, Upload, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, ArchiveIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToExcel } from "@/lib/export-utils";
import { exportImagesAsZip } from "@/lib/export-zip-utils";
import { ExcelImportDialog } from "@/components/excel-import-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function RadiologyThumb({ value }: { value: string | null | undefined }) {
  const isStoredPath = value?.startsWith("/objects/");
  const isExternalUrl = value && (value.startsWith("http://") || value.startsWith("https://"));
  const src = isStoredPath ? `/api/storage${value}` : isExternalUrl ? value : null;

  if (!src) {
    return <span className="text-muted-foreground/40"><ImageOff className="w-5 h-5" /></span>;
  }

  return (
    <img
      src={src}
      alt="Radiology"
      className="w-12 h-12 object-cover rounded border bg-muted"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

export default function Patients() {
  const [search, setSearch] = useState("");
  const [sexFilter, setSexFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useListPatients({
    search,
    sex: sexFilter !== "all" ? sexFilter : undefined,
    collectionType: typeFilter !== "all" ? typeFilter : undefined,
    limit: 1000,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createPatient = useCreatePatient();
  const importInputRef = useRef<HTMLInputElement>(null);

  const deletePatient = useDeletePatient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isZipExporting, setIsZipExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [excelImportOpen, setExcelImportOpen] = useState(false);

  async function handleDeleteSelected() {
    setIsDeletingSelected(true);
    let deleted = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await deletePatient.mutateAsync({ id });
        deleted++;
      } catch {
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPatientStatsQueryKey() });
    setSelectedIds(new Set());
    setIsDeletingSelected(false);
    toast({
      title: `Deleted ${deleted} record(s)`,
      description: failed > 0 ? `${failed} could not be deleted.` : undefined,
      variant: failed > 0 ? "destructive" : "default",
    });
  }

  async function handleDelete(id: number) {
    try {
      await deletePatient.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPatientStatsQueryKey() });
      toast({ title: "Deleted", description: "Patient record removed." });
    } catch {
      toast({ title: "Error", description: "Failed to delete record.", variant: "destructive" });
    }
  }

  const patients = useMemo(() => {
    const list = data?.patients ?? [];
    return [...list].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/40 inline" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-1 h-3.5 w-3.5 inline" />
      : <ChevronDown className="ml-1 h-3.5 w-3.5 inline" />;
  }

  const allIds = useMemo(() => patients.map((p) => p.id), [patients]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedCount = selectedIds.size;
  const exportTarget = selectedCount > 0 ? patients.filter((p) => selectedIds.has(p.id)) : patients;

  async function handleZipExport() {
    if (exportTarget.length === 0) {
      toast({ title: "Nothing to export", variant: "destructive" });
      return;
    }
    const withImages = exportTarget.filter(
      (p) => (p as any).radiologyImages || p.radiologyImageFilePathOrLink
    );
    if (withImages.length === 0) {
      toast({ title: "No images found", description: "None of the selected patients have radiology images.", variant: "destructive" });
      return;
    }
    setIsZipExporting(true);
    setZipProgress({ done: 0, total: 0 });
    try {
      const { downloaded, skipped } = await exportImagesAsZip(
        withImages.map((p) => ({
          patientId: p.patientId,
          patientName: p.patientName,
          radiologyImageFilePathOrLink: p.radiologyImageFilePathOrLink,
          radiologyImages: (p as any).radiologyImages ?? null,
        })),
        (done, total) => setZipProgress({ done, total })
      );
      toast({
        title: "ZIP downloaded",
        description: `${downloaded} image${downloaded !== 1 ? "s" : ""} exported${skipped > 0 ? `, ${skipped} unavailable` : ""}.`,
      });
    } catch (err) {
      toast({ title: "ZIP export failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsZipExporting(false);
      setZipProgress(null);
    }
  }

  async function handleExcelExport() {
    if (exportTarget.length === 0) {
      toast({ title: "Nothing to export", variant: "destructive" });
      return;
    }
    setIsExporting(true);
    try {
      await exportToExcel(exportTarget, "patients");
      toast({ title: "Export complete", description: `${exportTarget.length} record(s) exported.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExcelImportBatch(
    patients: Record<string, unknown>[]
  ): Promise<{ imported: number; failed: number; errors?: string[] }> {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const rec of patients) {
      try {
        await createPatient.mutateAsync({ data: rec as any });
        imported++;
      } catch (err) {
        failed++;
        errors.push((err as Error).message || "Unknown error");
      }
    }
    if (imported > 0) {
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPatientStatsQueryKey() });
    }
    return { imported, failed, errors };
  }

  function handleJsonExport() {
    if (exportTarget.length === 0) {
      toast({ title: "Nothing to export", variant: "destructive" });
      return;
    }
    const clean = exportTarget.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `patients_${format(new Date(), "yyyy-MM-dd")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "JSON exported", description: `${exportTarget.length} record(s) saved.` });
  }

  async function handleJsonImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const records: any[] = Array.isArray(parsed) ? parsed : [parsed];

      let imported = 0;
      let failed = 0;
      for (const rec of records) {
        try {
          await createPatient.mutateAsync({ data: rec });
          imported++;
        } catch {
          failed++;
        }
      }

      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      toast({
        title: "Import complete",
        description: `${imported} imported${failed ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 ? "destructive" : "default",
      });
    } catch (err) {
      toast({ title: "Import failed", description: "Invalid JSON file.", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Patient Directory</h1>
            <p className="text-muted-foreground mt-1">Manage and search clinical research records.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleExcelExport}
              disabled={isExporting || isLoading || patients.length === 0}
            >
              {isExporting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />}
              {isExporting ? "Exporting…" : selectedCount > 0 ? `Excel (${selectedCount})` : `Excel (${patients.length})`}
            </Button>

            <Button
              variant="outline"
              onClick={handleZipExport}
              disabled={isZipExporting || isLoading || patients.length === 0}
              title="Export radiology images as ZIP, one folder per patient ID"
            >
              {isZipExporting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <ArchiveIcon className="mr-2 h-4 w-4 text-violet-600" />}
              {isZipExporting
                ? zipProgress && zipProgress.total > 0
                  ? `${zipProgress.done}/${zipProgress.total} images…`
                  : "Preparing…"
                : selectedCount > 0
                  ? `Images ZIP (${selectedCount})`
                  : `Images ZIP (${patients.length})`}
            </Button>

            <Button
              variant="outline"
              onClick={handleJsonExport}
              disabled={isLoading || patients.length === 0}
            >
              <Download className="mr-2 h-4 w-4 text-blue-600" />
              {selectedCount > 0 ? `JSON (${selectedCount})` : `JSON (${patients.length})`}
            </Button>

            <Button
              variant="outline"
              onClick={() => setExcelImportOpen(true)}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
              Import Excel
            </Button>

            <Button
              variant="outline"
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Upload className="mr-2 h-4 w-4 text-orange-600" />}
              {isImporting ? "Importing…" : "Import JSON"}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={handleJsonImport}
            />

            <Link href="/patients/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Patient
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center space-x-2 flex-1 max-w-sm">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search by ID, Name, Diagnosis..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Collection Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Normal">Normal</SelectItem>
              <SelectItem value="Abnormal">Abnormal</SelectItem>
              <SelectItem value="Suspicious">Suspicious</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sexFilter} onValueChange={setSexFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sex" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sexes</SelectItem>
              <SelectItem value="Male">Male</SelectItem>
              <SelectItem value="Female">Female</SelectItem>
            </SelectContent>
          </Select>
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedCount} of {patients.length} selected
                <button className="ml-2 text-primary underline text-sm" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
              </span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isDeletingSelected}>
                    {isDeletingSelected
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Trash2 className="mr-2 h-4 w-4" />}
                    {isDeletingSelected ? "Deleting…" : `Delete (${selectedCount})`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedCount} record{selectedCount > 1 ? "s" : ""}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove {selectedCount} selected patient record{selectedCount > 1 ? "s" : ""}. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteSelected}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-16">Radiology</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("patientId")}>
                  Patient ID <SortIcon col="patientId" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("patientName")}>
                  Name <SortIcon col="patientName" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("age")}>
                  Age <SortIcon col="age" />
                </TableHead>
                <TableHead>Sex</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("dateOfVisit")}>
                  Date of Visit <SortIcon col="dateOfVisit" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("collectionName")}>
                  Collection Name <SortIcon col="collectionName" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("collectionDate")}>
                  Collection Date <SortIcon col="collectionDate" />
                </TableHead>
                <TableHead>Provisional Diagnosis</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(11)].map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : patients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center h-24 text-muted-foreground">
                    No patients found.
                  </TableCell>
                </TableRow>
              ) : (
                patients.map((patient) => {
                  const isSelected = selectedIds.has(patient.id);
                  return (
                    <TableRow
                      key={patient.id}
                      className={`hover:bg-muted/50 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(patient.id)}
                          aria-label={`Select ${patient.patientName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/patients/${patient.id}`}>
                          <RadiologyThumb value={patient.radiologyImageFilePathOrLink} />
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/patients/${patient.id}`} className="text-primary hover:underline">
                          {patient.patientId}
                        </Link>
                      </TableCell>
                      <TableCell>{patient.patientName}</TableCell>
                      <TableCell>{patient.age ?? "-"}</TableCell>
                      <TableCell>{patient.sex ?? "-"}</TableCell>
                      <TableCell>
                        {(() => { try { const d = new Date(patient.dateOfVisit ?? ""); return !isNaN(d.getTime()) ? format(d, "MMM d, yyyy") : (patient.dateOfVisit || "-"); } catch { return patient.dateOfVisit || "-"; } })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(patient as any).collectionName || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(() => { try { const d = new Date((patient as any).collectionDate ?? ""); return (patient as any).collectionDate && !isNaN(d.getTime()) ? format(d, "MMM d, yyyy") : ((patient as any).collectionDate || "-"); } catch { return (patient as any).collectionDate || "-"; } })()}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {patient.provisionalDiagnosis ?? "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Link href={`/patients/${patient.id}/edit`}>
                            <Button variant="ghost" size="sm" className="text-xs h-7 px-2">Edit</Button>
                          </Link>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete patient record?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete <strong>{patient.patientName}</strong> ({patient.patientId}). This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(patient.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ExcelImportDialog
        open={excelImportOpen}
        onOpenChange={setExcelImportOpen}
        onImport={handleExcelImportBatch}
      />
    </Layout>
  );
}
