import { useState, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
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

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (patients: Record<string, unknown>[]) => Promise<{ imported: number; failed: number; errors?: string[] }>;
};

type Phase = "idle" | "files" | "mapping" | "importing" | "done";

const SKIP_VALUE = "__skip__";
const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportableField[];
type FilterRuleState = ImportFilterRule & { keywordText: string };

function emptyFilterRule(): FilterRuleState {
  return { column: "", keywords: [], keywordText: "" };
}

export function ExcelImportDialog({ open, onOpenChange, onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "urls">("upload");
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ file: File; parsed: ParsedImport; isProcessing: boolean; error?: string }>>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentImportedCount, setCurrentImportedCount] = useState(0);
  const [result, setResult] = useState<{ imported: number; failed: number; errors?: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlResults, setUrlResults] = useState<{ imported: number; failed: number; errors?: string[] } | null>(null);
  const [userMapping, setUserMapping] = useState<Record<string, ImportableField | null>>({});
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterRules, setFilterRules] = useState<FilterRuleState[]>([emptyFilterRule()]);

  const currentParsed = uploadedFiles[currentFileIndex]?.parsed;

  function reset() {
    setPhase("idle");
    setUploadedFiles([]);
    setCurrentFileIndex(0);
    setFileName("");
    setProgress(0);
    setCurrentImportedCount(0);
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

    const newFiles = [];
    for (const file of Array.from(selectedFiles)) {
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
          error: (err as Error).message || "Failed to parse",
        });
      }
    }

    setUploadedFiles(newFiles);
    if (newFiles.length > 0 && newFiles[0].parsed.rawRows.length > 0) {
      setPhase("files");
    } else {
      setParseError("No valid data found");
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

  async function handleImport() {
    if (!currentParsed) return;
    if (filterConfigured && filteredRawRows.length === 0) return;
    setPhase("importing");
    setProgress(0);

    const mappedRows = applyColumnMapping(filteredRawRows, userMapping);
    const patients = mappedRows.map(rowToPatient);
    const total = patients.length;
    let done = 0;
    let failed = 0;
    const errors: string[] = [];

    const BATCH = 5;
    for (let i = 0; i < total; i += BATCH) {
      const slice = patients.slice(i, i + BATCH);
      try {
        const res = await onImport(slice);
        done += res.imported;
        failed += res.failed;
        if (res.errors) errors.push(...res.errors);
      } catch (err) {
        failed += slice.length;
        errors.push((err as Error).message || "Unknown error");
      }
      setProgress(Math.round(((done + failed) / total) * 100));
      setCurrentImportedCount(done + failed);
    }

    setResult({ imported: done, failed, errors });
    setPhase("done");
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
      const errors: string[] = [];

      const BATCH = 5;
      for (let i = 0; i < patients.length; i += BATCH) {
        const slice = patients.slice(i, i + BATCH);
        try {
          const res = await onImport(slice);
          done += res.imported;
          failed += res.failed;
          if (res.errors) errors.push(...res.errors);
        } catch (err) {
          failed += slice.length;
          errors.push((err as Error).message || "Unknown error");
        }
        setProgress(Math.round(((done + failed) / patients.length) * 100));
        setCurrentImportedCount(done + failed);
      }

      setUrlResults({ imported: done, failed, errors });
      setPhase("done");
    } catch (err) {
      setUrlResults({ imported: 0, failed: 1, errors: [(err as Error).message || "Failed to fetch URL"] });
      setPhase("done");
    }
  }

  const filterSampleValues = useMemo(
    () => filteredRawRows.slice(0, 3).map((row) =>
      activeFilterRules.map((rule) => `${rule.column}: ${String(row[rule.column] ?? "").trim()}`).join(" · "),
    ),
    [filteredRawRows, activeFilterRules],
  );
  const excludedSampleValues = useMemo(
    () => (currentParsed?.rawRows ?? [])
      .filter((row) => !filteredRawRows.includes(row))
      .slice(0, 3)
      .map((row) => activeFilterRules.map((rule) => `${rule.column}: ${String(row[rule.column] ?? "").trim() || "empty"}`).join(" · ")),
    [currentParsed?.rawRows, filteredRawRows, activeFilterRules],
  );

  const importedCount = result?.imported ?? urlResults?.imported ?? 0;
  const failedCount = result?.failed ?? urlResults?.failed ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[95vh] flex flex-col" style={{ minWidth: "320px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Import from Excel
          </DialogTitle>
          <DialogDescription>
            Upload Excel files or import from URL. Headers are auto-detected — map columns and filter rows before importing.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab as any} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Upload Files
            </TabsTrigger>
            <TabsTrigger value="urls" className="cursor-pointer">
              <Link className="w-4 h-4 mr-2" />
              Import from URL
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="flex-1 flex flex-col">

            {/* File Selection */}
            {(phase === "idle" || phase === "files") && (
              <div className="space-y-4 py-4 flex-1 flex flex-col justify-center items-center">
                <div 
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary hover:text-primary transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="font-medium mb-1">Click to select Excel files</p>
                  <p className="text-xs text-muted-foreground">Support multiple files (.xlsx or .xls)</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  onChange={handleFile}
                  multiple
                />
              </div>
            )}

            {/* Uploaded Files List */}
            {phase === "files" && uploadedFiles.length > 0 && (
              <div className="space-y-3 py-4">
                <h4 className="text-sm font-medium">
                  {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} selected ({uploadedFiles.reduce((sum, f) => sum + f.parsed.rawRows.length, 0)} total rows)
                </h4>

                {uploadedFiles.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 border rounded bg-muted/20">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div className="text-sm flex-1">
                      <span className="font-medium block truncate">{item.file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.parsed.rawRows.length} rows • {item.parsed.columnMap.length} columns
                        {item.error && <span className="text-destructive"> • Error: {item.error}</span>}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{idx + 1} / {uploadedFiles.length}</span>
                  </div>
                ))}

                <Button onClick={() => uploadedFiles[0].parsed.rawRows.length > 0 ? setPhase("mapping") : setParseError("No valid data found in the first file.")}>
                  <FileDown className="w-4 h-4 mr-2" />
                  Continue to Column Mapping
                </Button>
                <Button variant="outline" onClick={() => setPhase("idle")}>
                  Select Different Files
                </Button>
              </div>
            )}

            {/* Column Mapping - Single File Mode */}
            {phase === "mapping" && currentParsed && (
              <div className="flex flex-col gap-3 flex-1 min-h-0">

                {/* File info */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="font-medium text-foreground truncate">{uploadedFiles[currentFileIndex].file.name}</span>
                  <span>·</span>
                  <span>{currentParsed.rawRows.length} rows</span>
                </div>

                {/* Missing required warning */}
                {missingRequired.length > 0 && (
                  <Alert variant="destructive" className="shrink-0 py-2">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      <strong>Assign required columns:</strong>{" "}
                      {missingRequired.map((f) => FIELD_LABELS[f]).join(" and ")}{" "}
                      must be mapped before you can import.
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
                      Filter rows before import
                    </label>
                  </div>

                  {filterEnabled && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Each rule matches any of its keywords. A row must match every rule to be imported.
                      </p>
                      {filterRules.map((rule, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-14 shrink-0">Rule {index + 1}</span>
                          <Select value={rule.column} onValueChange={(value) => updateFilterRule(index, { column: value })}>
                            <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                              <SelectValue placeholder="Choose a column" />
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
                            aria-label={`Keywords for filter rule ${index + 1}`}
                            value={rule.keywordText}
                            onChange={(e) => updateFilterRule(index, {
                              keywordText: e.target.value,
                              keywords: e.target.value.split(/[,;\n]+/).map((keyword) => keyword.trim()).filter(Boolean),
                            })}
                            placeholder="Keywords, separated by commas"
                            className="h-8 flex-1 min-w-[120px] text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeFilterRule(index)}
                            disabled={filterRules.length === 1}
                            aria-label={`Remove filter rule ${index + 1}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addFilterRule}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add filter
                      </Button>
                    </div>
                  )}

                  {filterEnabled && (
                    <div className="text-xs">
                      {activeFilterRules.length === 0 ? (
                        <span className="text-muted-foreground">
                          Choose a column and enter keywords for at least one rule.
                        </span>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium text-emerald-700">{filteredRawRows.length} included</span>
                            <span className="text-muted-foreground">{excludedRowCount} excluded</span>
                            <span className="text-muted-foreground">(all rules must match; keywords within a rule use OR)</span>
                          </div>
                          {filterConfigured && filteredRawRows.length === 0 && (
                            <Alert variant="destructive" className="mt-2 py-2">
                              <AlertTriangle className="w-4 h-4" />
                              <AlertDescription className="text-xs">
                                No rows match these keywords. Change the filter before importing.
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
                    <thead className="sticky top-0 bg-muted z-10">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[40%]">Excel Column</th>
                        <th className="text-center px-1 py-2 text-muted-foreground">→</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[40%]">Patient Field</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[200px] hidden sm:table-cell">Sample Value</th>
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
                                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                      : currentField === null
                                      ? "border-dashed text-muted-foreground"
                                      : ""
                                  }`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-72 text-xs">
                                  <SelectItem value={SKIP_VALUE} className="text-muted-foreground italic">
                                    — Skip this column —
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
                              {sampleVal || <span className="italic opacity-50">empty</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-muted-foreground shrink-0">
                  Fields marked <strong>*</strong> are required. All other fields are optional.
                </p>
              </div>
            )}

            {/* Importing */}
            {phase === "importing" && (
              <div className="py-8 space-y-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                  <span className="text-sm">Importing {currentImportedCount} record{(currentImportedCount !== 1 ? "s" : "")} in batches of 5…</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{progress}%</p>
              </div>
            )}
          </TabsContent>

          {/* URL Tab */}
          <TabsContent value="urls" className="flex-1 flex flex-col">
            <div className="space-y-4 py-2 flex-1 flex flex-col">
              <div>
                <Label>Excel File URL</Label>
                <textarea
                  placeholder="https://example.com/data.xlsx&#10;Paste one URL per line"
                  className="w-full h-32 p-3 border rounded-md font-mono text-sm"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Paste the URL to an Excel file (.xlsx or .xls).
                </p>
              </div>

              {urlResults && (
                <div className="text-sm">
                  {urlResults.imported > 0 ? (
                    <span className="text-emerald-600">
                      {urlResults.imported} record{(urlResults.imported !== 1 ? "s" : "")} imported
                      {urlResults.failed > 0 && <span className="text-destructive"> - {urlResults.failed} failed</span>}
                    </span>
                  ) : (
                    <span className="text-destructive">Import failed: {urlResults.errors?.[0] || "Unknown error"}</span>
                  )}
                </div>
              )}

              <Button onClick={handleUrlImport} disabled={phase === "importing" || urlInput.trim() === ""}>
                Import from URL
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 pt-2 border-t">
          {phase === "idle" || phase === "files" ? (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          ) : phase === "mapping" ? (
            <>
              <Button variant="outline" onClick={() => setPhase("files")}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Files
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
                    ? `Assign ${missingRequired.map((f) => FIELD_LABELS[f]).join(" and ")} first`
                    : filterConfigured && filteredRawRows.length === 0
                    ? "Change the filter so at least one row matches"
                    : undefined
                }
              >
                Import {filterConfigured ? filteredRawRows.length : currentParsed!.rawRows.length} record{filterConfigured ? filteredRawRows.length : currentParsed!.rawRows.length !== 1 ? "s" : ""}
              </Button>
            </>
          ) : phase === "done" ? (
            <Button onClick={handleClose}>Done</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}