import { useState, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { useLiveAnnouncer } from "@/components/live-region";
import { CheckCircle2, XCircle, FileSpreadsheet, Loader2, Upload, AlertTriangle, ChevronRight, Filter, Plus, Trash2, Link, FileDown } from "lucide-react";
import { filterImportRows, isImportBlocked, type ImportFilterRule } from "@/lib/import-filter";
import {
  parseExcelFile,
  applyColumnMapping,
  rowToPatient,
  detectField,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  type ParsedImport,
  type ImportableField,
} from "@/lib/import-utils";

export interface ImportRowError {
  /** 1-based row number within the submitted batch slice. */
  row?: number;
  reason: string;
}

type ImportOutcome = { imported: number; failed: number; errors?: ImportRowError[] | string[] };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (
    patients: Record<string, unknown>[],
  ) => Promise<{ imported: number; failed: number; errors?: ImportRowError[] | string[] }>;
};

type Phase = "idle" | "files" | "mapping" | "importing" | "done";

const SKIP_VALUE = "__skip__";
const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportableField[];
type FilterRuleState = ImportFilterRule & { keywordText: string };

function emptyFilterRule(): FilterRuleState {
  return { column: "", keywords: [], keywordText: "" };
}

export function ExcelImportDialog({ open, onOpenChange, onImport }: Props) {
  const { t } = useTranslation();
  const { announce } = useLiveAnnouncer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "urls">("upload");
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; parsed: ParsedImport; isProcessing: boolean; error?: string }>>([]);
  const [progress, setProgress] = useState(0);
  const [currentImportedCount, setCurrentImportedCount] = useState(0);
  /** Per-file import progress, keyed by file name. */
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlResults, setUrlResults] = useState<ImportOutcome | null>(null);
  const [userMapping, setUserMapping] = useState<Record<string, ImportableField | null>>({});
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterRules, setFilterRules] = useState<FilterRuleState[]>([emptyFilterRule()]);

  const currentParsed = uploadedFiles[0]?.parsed;
  const totalRows = uploadedFiles.reduce((sum, f) => sum + f.parsed.rawRows.length, 0);

  function reset() {
    setPhase("idle");
    setUploadedFiles([]);
    setProgress(0);
    setCurrentImportedCount(0);
    setFileProgress({});
    setResult(null);
    setParseError(null);
    setUserMapping({});
    setFilterEnabled(false);
    setFilterRules([emptyFilterRule()]);
    setUrlInput("");
    setUrlResults(null);
    setTab("upload");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    if (phase === "importing") return;
    onOpenChange(false);
    setTimeout(reset, 300);
  }

  async function handleFiles(selectedFiles: FileList | null) {
    if (!selectedFiles || selectedFiles.length === 0) return;

    const incoming = Array.from(selectedFiles);

    // SAFETY: the mapping + filter UI is built around a single sheet, and the
    // previous implementation silently imported ONLY `uploadedFiles[0]` while
    // the header said "N files selected (M total rows)". Anything beyond the
    // first file would have been discarded without a trace, so we refuse the
    // selection instead of quietly dropping data.
    if (incoming.length > 1) {
      setParseError(
        t("importExcel.onlyOneFile", { name: incoming.slice(1).map((f) => f.name).join(", ") }),
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const newFiles = [];
    for (const file of incoming) {
      try {
        const result = await parseExcelFile(file);
        newFiles.push({
          file,
          parsed: result,
          isProcessing: false,
        });
      } catch (err) {
        newFiles.push({
          file,
          parsed: { columnMap: [], rows: [], rawRows: [], skippedHeaders: [], headerRowIndex: 0 },
          isProcessing: false,
          error: (err as Error).message || t("common.unknown"),
        });
      }
    }

    setUploadedFiles(newFiles);
    if (newFiles.length > 0 && newFiles[0].parsed.rawRows.length > 0) {
      setPhase("files");
    } else {
      setParseError(t("importExcel.noValidData"));
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    await handleFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function setColField(header: string, field: ImportableField | null) {
    setUserMapping((prev) => ({ ...prev, [header]: field }));
  }

  const mappedFields = new Set(
    Object.values(userMapping).filter((v): v is ImportableField => v !== null)
  );
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));

  const firstRaw = currentParsed?.rawRows[0] ?? {};

  const parsedFilterRules = useMemo(
    () => filterRules.map((rule) => ({
      column: rule.column,
      keywords: rule.keywordText.split(/[,;\n]+/).map((keyword) => keyword.trim()).filter(Boolean),
    })),
    [filterRules],
  );
  const activeFilterRules = useMemo(
    () => parsedFilterRules.filter((rule) => rule.column && rule.keywords.length > 0),
    [parsedFilterRules],
  );
  const filterConfigured = filterEnabled && activeFilterRules.length > 0;
  const filteredRawRows = useMemo(
    () => filterImportRows(currentParsed?.rawRows ?? [], { enabled: filterEnabled, filters: parsedFilterRules }),
    [currentParsed?.rawRows, filterEnabled, parsedFilterRules],
  );
  const excludedRowCount = (currentParsed?.rawRows.length ?? 0) - filteredRawRows.length;

  function updateFilterRule(index: number, update: Partial<FilterRuleState>) {
    setFilterRules((previous) => previous.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ...update } : rule,
    ));
  }

  function addFilterRule() {
    setFilterRules((previous) => [...previous, emptyFilterRule()]);
  }

  function removeFilterRule(index: number) {
    setFilterRules((previous) => {
      const next = previous.filter((_, ruleIndex) => ruleIndex !== index);
      return next.length > 0 ? next : [emptyFilterRule()];
    });
  }

  /**
   * Import EVERY selected file, one after another, tracking per-file
   * progress. Row numbers in the reported errors are re-based onto the
   * spreadsheet (1 = first data row) so an admin can find the offending row.
   */
  async function handleImport() {
    if (!uploadedFiles.length) return;
    setPhase("importing");
    setProgress(0);
    setFileProgress({});

    let done = 0;
    let failed = 0;
    const errors: ImportRowError[] = [];
    const grandTotal = uploadedFiles.reduce(
      (sum, f) => sum + (filterConfigured ? filteredRawRowsFor(f).length : f.parsed.rawRows.length),
      0,
    );
    if (grandTotal === 0) return;

    const BATCH = 5;
    for (const entry of uploadedFiles) {
      const rows = filterConfigured ? filteredRawRowsFor(entry) : entry.parsed.rawRows;
      const patients = applyColumnMapping(rows, userMapping).map(rowToPatient);
      const total = patients.length;
      let fileDone = 0;

      for (let i = 0; i < total; i += BATCH) {
        const slice = patients.slice(i, i + BATCH);
        try {
          const res = await onImport(slice);
          done += res.imported;
          failed += res.failed;
          fileDone += res.imported + res.failed;
          for (const e of res.errors ?? []) {
            errors.push(
              typeof e === "string"
                ? { row: i + 1, reason: e }
                : { row: i + (e.row ?? 1), reason: e.reason },
            );
          }
        } catch (err) {
          failed += slice.length;
          fileDone += slice.length;
          errors.push({ row: i + 1, reason: (err as Error).message || t("common.unknown") });
        }
        const overall = Math.round(((done + failed) / grandTotal) * 100);
        setProgress(overall);
        setCurrentImportedCount(done + failed);
        setFileProgress((prev) => ({ ...prev, [entry.file.name]: total ? Math.round((fileDone / total) * 100) : 100 }));
      }
      setFileProgress((prev) => ({ ...prev, [entry.file.name]: 100 }));
    }

    setResult({ imported: done, failed, errors });
    setPhase("done");
    announce(t("importExcel.resultOk", { count: done }));
  }

  /** Filter the given file's raw rows with the shared filter config. */
  function filteredRawRowsFor(entry: { parsed: ParsedImport }) {
    return filterImportRows(entry.parsed.rawRows ?? [], {
      enabled: filterEnabled,
      filters: parsedFilterRules,
    });
  }

  async function handleUrlImport() {
    const urls = urlInput.split('\n').map(l => l.trim()).filter(l => l);
    if (urls.length === 0) return;

    setPhase("importing");
    setProgress(0);

    try {
      const response = await fetch(urls[0], { credentials: "include" });
      const file = await response.blob();
      const fileObj = new File([file], urls[0].split('/').pop() || 'import.xlsx', { type: file.type });

      const parsed = await parseExcelFile(fileObj);
      const mappedRows = applyColumnMapping(parsed.rawRows, userMapping);
      const patients = mappedRows.map(rowToPatient);

      let done = 0;
      let failed = 0;
      const errors: ImportRowError[] = [];

      const BATCH = 5;
      for (let i = 0; i < patients.length; i += BATCH) {
        const slice = patients.slice(i, i + BATCH);
        try {
          const res = await onImport(slice);
          done += res.imported;
          failed += res.failed;
          for (const e of res.errors ?? []) {
            errors.push(
              typeof e === "string" ? { row: i + 1, reason: e } : { row: i + (e.row ?? 1), reason: e.reason },
            );
          }
        } catch (err) {
          failed += slice.length;
          errors.push({ row: i + 1, reason: (err as Error).message || t("common.unknown") });
        }
        setProgress(Math.round(((done + failed) / patients.length) * 100));
        setCurrentImportedCount(done + failed);
      }

      setUrlResults({ imported: done, failed, errors });
      setPhase("done");
      announce(t("importExcel.resultOk", { count: done }));
    } catch (err) {
      setUrlResults({
        imported: 0,
        failed: 1,
        errors: [{ row: 1, reason: (err as Error).message || t("importExcel.urlFailed") }],
      });
      setPhase("done");
    }
  }

  const filterSampleValues = useMemo(
    () => filteredRawRows.slice(0, 3).map((row) =>
      activeFilterRules.map((rule) => `${rule.column}: ${String(row[rule.column] ?? "").trim()}`).join(" · "),
    ),
    [filteredRawRows, activeFilterRules],
  );
  const rowErrors: ImportRowError[] = [
    ...((result?.errors ?? []) as ImportRowError[]),
    ...((urlResults?.errors ?? []) as ImportRowError[]),
  ].filter((e) => e && typeof e === "object" && "reason" in e);

  const importedCount = result?.imported ?? urlResults?.imported ?? 0;
  const failedCount = result?.failed ?? urlResults?.failed ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[95vh] flex flex-col" style={{ minWidth: "320px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            {t("importExcel.title")}
          </DialogTitle>
          <DialogDescription>{t("importExcel.description")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab as any} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              {t("importExcel.uploadTab")}
            </TabsTrigger>
            <TabsTrigger value="urls" className="cursor-pointer">
              <Link className="w-4 h-4 mr-2" />
              {t("importExcel.urlsTab")}
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="flex-1 flex flex-col">

            {/* File Selection */}
            {(phase === "idle" || phase === "files") && (
              <div className="space-y-4 py-4 flex-1 flex flex-col justify-center items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-auto flex-col gap-2 border-2 border-dashed border-border py-8 hover:border-primary hover:text-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <span className="font-medium">{t("importExcel.chooseFiles")}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("importExcel.chooseFilesHint")}
                  </span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  aria-label={t("importExcel.chooseFiles")}
                  onChange={handleFile}
                />
              </div>
            )}

            {/* Uploaded Files List */}
            {phase === "files" && uploadedFiles.length > 0 && (
              <div className="space-y-3 py-4">
                <h4 className="text-sm font-medium">
                  {t("importExcel.fileSummary", { count: uploadedFiles.length, rows: totalRows })}
                </h4>

                {parseError && (
                  <Alert variant="destructive" className="py-2" role="alert">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{parseError}</AlertDescription>
                  </Alert>
                )}

                <ul className="space-y-2">
                  {uploadedFiles.map((item) => (
                    <li
                      key={item.file.name}
                      className="flex items-center gap-3 p-3 border rounded bg-muted/20"
                    >
                      <FileSpreadsheet className="h-5 w-5 text-emerald-600 shrink-0" />
                      <div className="text-sm flex-1 min-w-0">
                        <span className="font-medium block truncate">{item.file.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("importExcel.rowsColumns", {
                            rows: item.parsed.rawRows.length,
                            cols: item.parsed.columnMap.length,
                          })}
                          {item.error && (
                            <span className="text-destructive">
                              {" "}• {t("importExcel.fileError", { message: item.error })}
                            </span>
                          )}
                        </span>
                      </div>
                      {fileProgress[item.file.name] !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {fileProgress[item.file.name]}%
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() =>
                    uploadedFiles[0].parsed.rawRows.length > 0
                      ? setPhase("mapping")
                      : setParseError(t("importExcel.noValidData"))
                  }
                >
                  <FileDown className="w-4 h-4 mr-2" />
                  {t("importExcel.continueMapping")}
                </Button>
                <Button variant="outline" onClick={() => setPhase("idle")}>
                  {t("importExcel.selectDifferent")}
                </Button>
              </div>
            )}

            {/* Column Mapping - Single File Mode */}
            {phase === "mapping" && currentParsed && (
              <div className="flex flex-col gap-3 flex-1 min-h-0">

                {/* File info */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="font-medium text-foreground truncate">{uploadedFiles[0].file.name}</span>
                  <span aria-hidden>·</span>
                  <span>{currentParsed.rawRows.length}</span>
                </div>

                {/* Missing required warning */}
                {missingRequired.length > 0 && (
                  <Alert variant="destructive" className="shrink-0 py-2">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      {t("importExcel.mappingRequired", {
                        fields: missingRequired.map((f) => FIELD_LABELS[f]).join(" + "),
                      })}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Optional row filter */}
                <div className="shrink-0 rounded-lg border bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="enable-import-filter"
                      checked={filterEnabled}
                      onCheckedChange={(checked) => setFilterEnabled(checked === true)}
                    />
                    <label htmlFor="enable-import-filter" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <Filter className="w-4 h-4 text-primary" />
                      {t("importExcel.filterToggle")}
                    </label>
                  </div>

                  {filterEnabled && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t("importExcel.filterHint")}
                      </p>
                      {filterRules.map((rule, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16 shrink-0">
                            {t("importExcel.ruleN", { n: index + 1 })}
                          </span>
                          <Select value={rule.column} onValueChange={(value) => updateFilterRule(index, { column: value })}>
                            <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                              <SelectValue placeholder={t("importExcel.chooseColumn")} />
                            </SelectTrigger>
                            <SelectContent className="max-h-72 text-xs">
                              {currentParsed.columnMap.map((col) => (
                                <SelectItem key={col.header} value={col.header}>
                                  {col.header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            aria-label={t("importExcel.keywordsLabel", { n: index + 1 })}
                            value={rule.keywordText}
                            onChange={(e) => updateFilterRule(index, {
                              keywordText: e.target.value,
                              keywords: e.target.value.split(/[,;\n]+/).map((keyword) => keyword.trim()).filter(Boolean),
                            })}
                            placeholder={t("importExcel.keywordsPlaceholder")}
                            className="h-8 flex-1 min-w-[120px] text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeFilterRule(index)}
                            disabled={filterRules.length === 1}
                            aria-label={t("importExcel.removeRule", { n: index + 1 })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addFilterRule}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> {t("importExcel.addFilter")}
                      </Button>
                    </div>
                  )}

                  {filterEnabled && (
                    <div className="text-xs">
                      {activeFilterRules.length === 0 ? (
                        <span className="text-muted-foreground">
                          {t("importExcel.noRulesYet")}
                        </span>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">
                              {t("importExcel.included", { count: filteredRawRows.length })}
                            </span>
                            <span className="text-muted-foreground">
                              {t("importExcel.excluded", { count: excludedRowCount })}
                            </span>
                            <span className="text-muted-foreground">
                              {t("importExcel.andExplanation")}
                            </span>
                          </div>
                          {filterConfigured && filteredRawRows.length === 0 && (
                            <Alert variant="destructive" className="mt-2 py-2">
                              <AlertTriangle className="w-4 h-4" />
                              <AlertDescription className="text-xs">
                                {t("importExcel.noMatches")}
                              </AlertDescription>
                            </Alert>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Column Mapping Table with vertical scroll */}
                <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 border rounded-lg" style={{ maxHeight: "calc(95vh - 300px)" }}>
                  <table className="w-[min(100%,1200px)] text-sm">
                    <caption className="sr-only">{t("importExcel.mappingRequired", { fields: "" })}</caption>
                    <thead className="sticky top-0 bg-muted z-10">
                      <tr>
                        <th scope="col" className="text-start px-3 py-2 font-medium text-muted-foreground w-[40%]">{t("importExcel.excelColumn")}</th>
                        <th scope="col" className="text-center px-1 py-2 text-muted-foreground"><span aria-hidden>→</span><span className="sr-only">{t("importExcel.patientField")}</span></th>
                        <th scope="col" className="text-start px-3 py-2 font-medium text-muted-foreground w-[40%]">{t("importExcel.patientField")}</th>
                        <th scope="col" className="text-start px-3 py-2 font-medium text-muted-foreground w-[200px] hidden sm:table-cell">{t("importExcel.sampleValue")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentParsed.columnMap.map((col) => {
                        const currentField = userMapping[col.header] ?? null;
                        const isRequired = REQUIRED_FIELDS.includes(currentField as ImportableField);
                        const sampleVal = firstRaw[col.header] ?? "";

                        return (
                          <tr
                            key={col.header}
                            className={currentField === null ? "opacity-50 bg-muted/20" : ""}
                          >
                            <td className="px-3 py-1.5 font-mono text-xs truncate max-w-0" title={col.header}>
                              <span className={`inline-block max-w-full truncate ${REQUIRED_FIELDS.includes(currentField as ImportableField) ? "text-foreground font-semibold" : ""}`}>
                                {col.header}
                              </span>
                            </td>

                            <td className="px-1 py-1.5 text-center text-muted-foreground/40">
                              <ChevronRight className="w-3 h-3 inline" />
                            </td>

                            <td className="px-3 py-1.5">
                              <Select
                                value={currentField ?? SKIP_VALUE}
                                onValueChange={(v) =>
                                  setColField(col.header, v === SKIP_VALUE ? null : v as ImportableField)
                                }
                              >
                                <SelectTrigger
                                  className={`h-7 text-xs ${
                                    missingRequired.includes(currentField as ImportableField) && currentField === null
                                      ? ""
                                      : isRequired
                                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                      : currentField === null
                                      ? "border-dashed text-muted-foreground"
                                      : ""
                                  }`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-72 text-xs">
                                  <SelectItem value={SKIP_VALUE} className="text-muted-foreground italic">
                                    {t("importExcel.skipColumn")}
                                  </SelectItem>
                                  {ALL_FIELDS.map((f) => (
                                    <SelectItem
                                      key={f}
                                      value={f}
                                      className={REQUIRED_FIELDS.includes(f) ? "font-semibold" : ""}
                                    >
                                      {FIELD_LABELS[f]}
                                      {REQUIRED_FIELDS.includes(f) ? " *" : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>

                            <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[120px] hidden sm:table-cell" title={sampleVal}>
                              {sampleVal || (
                                <span className="italic opacity-50">{t("importExcel.empty")}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-muted-foreground shrink-0">
                  {t("importExcel.requiredFootnote")}
                </p>
              </div>
            )}

            {/* Importing */}
            {phase === "importing" && (
              <div className="py-8 space-y-4">
                <div
                  className="flex items-center gap-3 text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                  <span className="text-sm">
                    {t("importExcel.progress", { done: currentImportedCount, total: totalRows })}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-end">{progress}%</p>
                {uploadedFiles.length > 1 && (
                  <ul className="space-y-1.5">
                    {uploadedFiles.map((f) => (
                      <li key={f.file.name} className="flex items-center gap-2 text-xs">
                        <span className="truncate flex-1">{f.file.name}</span>
                        <span className="text-muted-foreground">
                          {fileProgress[f.file.name] ?? 0}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </TabsContent>

          {/* URL Tab */}
          <TabsContent value="urls" className="flex-1 flex flex-col">
            <div className="space-y-4 py-2 flex-1 flex flex-col">
              <FormRow label={t("importExcel.urlLabel")}>
                <textarea
                  placeholder={"https://example.com/data.xlsx"}
                  aria-label={t("importExcel.urlLabel")}
                  className="w-full h-32 p-3 border rounded-md font-mono text-sm"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </FormRow>
              <p className="text-xs text-muted-foreground">{t("importExcel.urlHint")}</p>

              {urlResults && (
                <div className="text-sm">
                  {urlResults.imported > 0 ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      {t("importExcel.resultOk", { count: urlResults.imported })}
                      {urlResults.failed > 0 && (
                        <span className="text-destructive">
                          {" — "}
                          {t("importExcel.resultFailedCount", { count: urlResults.failed })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-destructive">
                      {t("importExcel.urlFailed")}: {rowErrors[0]?.reason ?? t("common.unknown")}
                    </span>
                  )}
                </div>
              )}

              <Button onClick={handleUrlImport} disabled={phase === "importing" || urlInput.trim() === ""}>
                {t("importExcel.urlImport")}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {phase === "done" && (
          <div className="space-y-2 shrink-0 max-h-40 overflow-y-auto">
            <p className="text-sm" role="status" aria-live="polite">
              <span className="text-emerald-700 dark:text-emerald-400">
                {t("importExcel.resultOk", { count: importedCount })}
              </span>
              {failedCount > 0 && (
                <span className="text-destructive ms-2">
                  {t("importExcel.resultFailedCount", { count: failedCount })}
                </span>
              )}
            </p>
            {rowErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2">
                <p className="text-xs font-semibold text-destructive">
                  {t("importExcel.rowErrorsTitle", { count: rowErrors.length })}
                </p>
                <ul className="mt-1 max-h-24 overflow-y-auto text-xs space-y-0.5">
                  {rowErrors.slice(0, 100).map((e, i) => (
                    <li key={`${e.row}-${i}`} className="truncate">
                      {t("importExcel.rowError", { row: e.row ?? "?", reason: e.reason })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0 pt-2 border-t">
          {phase === "idle" || phase === "files" ? (
            <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
          ) : phase === "mapping" ? (
            <>
              <Button variant="outline" onClick={() => setPhase("files")}>
                <Upload className="w-4 h-4 mr-2" />
                {t("importExcel.uploadTab")}
              </Button>
              <Button
                onClick={handleImport}
                disabled={isImportBlocked({
                  missingRequiredCount: missingRequired.length,
                  filterConfigured,
                  matchingRowCount: filteredRawRows.length,
                })}
                title={
                  missingRequired.length > 0
                    ? t("importExcel.assignFirst", {
                        fields: missingRequired.map((f) => FIELD_LABELS[f]).join(" + "),
                      })
                    : filterConfigured && filteredRawRows.length === 0
                    ? t("importExcel.changeFilter")
                    : undefined
                }
              >
                {t("importExcel.importBtn", {
                  count: filterConfigured ? filteredRawRows.length : (currentParsed?.rawRows.length ?? 0),
                })}
              </Button>
            </>
          ) : phase === "done" ? (
            <Button onClick={handleClose}>{t("importExcel.done")}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}