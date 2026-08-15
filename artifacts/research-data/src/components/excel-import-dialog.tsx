import { useState, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, FileSpreadsheet, Loader2, Upload, AlertTriangle, ChevronRight, Filter, Plus, Trash2 } from "lucide-react";
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

type Phase = "idle" | "mapping" | "importing" | "done";

const SKIP_VALUE = "__skip__";
const ALL_FIELDS = Object.keys(FIELD_LABELS) as ImportableField[];
type FilterRuleState = ImportFilterRule & { keywordText: string };

function emptyFilterRule(): FilterRuleState {
  return { column: "", keywords: [], keywordText: "" };
}

export function ExcelImportDialog({ open, onOpenChange, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase,      setPhase]      = useState<Phase>("idle");
  const [parsed,     setParsed]     = useState<ParsedImport | null>(null);
  const [fileName,   setFileName]   = useState("");
  const [progress,   setProgress]   = useState(0);
  const [result,     setResult]     = useState<{ imported: number; failed: number; errors?: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // User-editable column mapping: Excel header → ImportableField | null
  const [userMapping, setUserMapping] = useState<Record<string, ImportableField | null>>({});
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterRules, setFilterRules] = useState<FilterRuleState[]>([emptyFilterRule()]);

  function reset() {
    setPhase("idle");
    setParsed(null);
    setFileName("");
    setProgress(0);
    setResult(null);
    setParseError(null);
    setUserMapping({});
    setFilterEnabled(false);
    setFilterRules([emptyFilterRule()]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    if (phase === "importing") return;
    onOpenChange(false);
    setTimeout(reset, 300);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    try {
      const result = await parseExcelFile(file);
      if (result.rawRows.length === 0) {
        setParseError("No data rows found. Make sure the first row contains column headers.");
        return;
      }
      // Build initial user mapping from auto-detection
      const initial: Record<string, ImportableField | null> = {};
      for (const col of result.columnMap) {
        initial[col.header] = col.field;
      }
      setUserMapping(initial);
      setFilterRules([emptyFilterRule()]);
      setFilterEnabled(false);
      setParsed(result);
      setPhase("mapping");
    } catch (err) {
      setParseError((err as Error).message || "Failed to parse file.");
    }
  }

  function setColField(header: string, field: ImportableField | null) {
    setUserMapping((prev) => ({ ...prev, [header]: field }));
  }

  // Derive which required fields are currently mapped
  const mappedFields = new Set(
    Object.values(userMapping).filter((v): v is ImportableField => v !== null)
  );
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));

  // First data row values for preview
  const firstRaw = parsed?.rawRows[0] ?? {};

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
    () => filterImportRows(parsed?.rawRows ?? [], { enabled: filterEnabled, filters: parsedFilterRules }),
    [parsed?.rawRows, filterEnabled, parsedFilterRules],
  );
  const excludedRowCount = (parsed?.rawRows.length ?? 0) - filteredRawRows.length;
  const filterSampleValues = useMemo(
    () => filteredRawRows.slice(0, 3).map((row) =>
      activeFilterRules.map((rule) => `${rule.column}: ${String(row[rule.column] ?? "").trim()}`).join(" · "),
    ),
    [filteredRawRows, activeFilterRules],
  );
  const excludedSampleValues = useMemo(
    () => (parsed?.rawRows ?? [])
      .filter((row) => !filteredRawRows.includes(row))
      .slice(0, 3)
      .map((row) => activeFilterRules.map((rule) => `${rule.column}: ${String(row[rule.column] ?? "").trim() || "empty"}`).join(" · ")),
    [parsed?.rawRows, filteredRawRows, activeFilterRules],
  );

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
    if (!parsed) return;
    if (filterConfigured && filteredRawRows.length === 0) return;
    setPhase("importing");
    setProgress(0);

    // Apply user mapping to produce properly-keyed rows
    const mappedRows  = applyColumnMapping(filteredRawRows, userMapping);
    const patients    = mappedRows.map(rowToPatient);
    const total       = patients.length;
    let done   = 0;
    let failed = 0;
    const errors: string[] = [];

    const BATCH = 5;
    for (let i = 0; i < total; i += BATCH) {
      const slice = patients.slice(i, i + BATCH);
      try {
        const res = await onImport(slice);
        done   += res.imported;
        failed += res.failed;
        if (res.errors) errors.push(...res.errors);
      } catch (err) {
        failed += slice.length;
        errors.push((err as Error).message || "Unknown error");
      }
      setProgress(Math.round(((done + failed) / total) * 100));
    }

    setResult({ imported: done, failed, errors });
    setPhase("done");
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Import from Excel
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx / .xls). Headers are auto-detected — you can fix mapping and optionally filter rows before importing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ── Idle / pick file ──────────────────────────────────────────── */}
          {(phase === "idle" || parseError) && (
            <div className="space-y-4 py-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-lg p-10 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
              >
                <Upload className="w-8 h-8" />
                <span className="font-medium">Click to select a file</span>
                <span className="text-xs">.xlsx or .xls</span>
              </button>
              {parseError && (
                <Alert variant="destructive">
                  <XCircle className="w-4 h-4" />
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="sr-only"
                onChange={handleFile}
              />
            </div>
          )}

          {/* ── Column mapping ────────────────────────────────────────────── */}
          {phase === "mapping" && parsed && (
            <div className="flex flex-col gap-3 min-h-0 flex-1">

              {/* File info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
                <span className="font-medium text-foreground truncate">{fileName}</span>
                <span>·</span>
                <span>{parsed.rawRows.length} rows</span>
                {parsed.headerRowIndex > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">headers detected on row {parsed.headerRowIndex + 1}</span>
                  </>
                )}
              </div>

              {/* Missing required warning */}
              {missingRequired.length > 0 && (
                <Alert variant="destructive" className="shrink-0 py-2">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription className="text-xs">
                    <strong>Assign required columns:</strong>{" "}
                    {missingRequired.map((f) => FIELD_LABELS[f]).join(" and ")}{" "}
                    must be mapped before you can import.
                    Use the dropdowns below to assign the correct columns.
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
                            {parsed.columnMap.map((col) => (
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
                          className="h-8 flex-1 min-w-0 text-xs"
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
                        Choose a column and enter keywords for at least one rule. Separate keywords with commas.
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
                        {filterConfigured && filteredRawRows.length > 0 && (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
                            <div className="truncate" title={filterSampleValues.join(" · ")}>
                              <span className="font-medium text-foreground">Included:</span>{" "}
                              {filterSampleValues.join(" · ") || "—"}
                            </div>
                            <div className="truncate" title={excludedSampleValues.join(" · ")}>
                              <span className="font-medium text-foreground">Excluded:</span>{" "}
                              {excludedSampleValues.join(" · ") || "none"}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Mapping table */}
              <ScrollArea className="flex-1 min-h-0 border rounded-lg" style={{ maxHeight: "calc(90vh - 260px)" }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[40%]">Excel Column</th>
                      <th className="text-center px-1 py-2 text-muted-foreground">→</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[40%]">Patient Field</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Sample Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsed.columnMap.map((col) => {
                      const currentField = userMapping[col.header] ?? null;
                      const isRequired   = REQUIRED_FIELDS.includes(currentField as ImportableField);
                      const sampleVal    = firstRaw[col.header] ?? "";

                      return (
                        <tr
                          key={col.header}
                          className={currentField === null ? "opacity-50 bg-muted/20" : ""}
                        >
                          {/* Original header */}
                          <td className="px-3 py-1.5 font-mono text-xs truncate max-w-0" title={col.header}>
                            <span className={`inline-block max-w-full truncate ${REQUIRED_FIELDS.includes(currentField as ImportableField) ? "text-foreground font-semibold" : ""}`}>
                              {col.header}
                            </span>
                          </td>

                          <td className="px-1 py-1.5 text-center text-muted-foreground/40">
                            <ChevronRight className="w-3 h-3 inline" />
                          </td>

                          {/* Field selector */}
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

                          {/* Sample value */}
                          <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-[120px] hidden sm:table-cell" title={sampleVal}>
                            {sampleVal || <span className="italic opacity-50">empty</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>

              <p className="text-xs text-muted-foreground shrink-0">
                Fields marked <strong>*</strong> are required. All other fields are optional.
              </p>
            </div>
          )}

          {/* ── Importing ────────────────────────────────────────────────── */}
          {phase === "importing" && (
            <div className="py-8 space-y-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                <span className="text-sm">Importing {parsed?.rawRows.length} records in batches of 5…</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-right">{progress}%</p>
            </div>
          )}

          {/* ── Done ─────────────────────────────────────────────────────── */}
          {phase === "done" && result && (
            <div className="py-4 space-y-3">
              <div className="flex items-center gap-3">
                {result.imported > 0
                  ? <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
                  : <XCircle className="w-7 h-7 text-destructive shrink-0" />}
                <div>
                  <p className="font-semibold">Import complete</p>
                  <p className="text-sm text-muted-foreground">
                    {result.imported} record{result.imported !== 1 ? "s" : ""} imported successfully.
                    {result.failed > 0 && (
                      <span className="text-destructive"> {result.failed} failed.</span>
                    )}
                  </p>
                </div>
              </div>

              {result.failed > 0 && result.errors && result.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1 text-xs">Failure reason{result.errors.length > 1 ? "s" : ""}:</p>
                    <ScrollArea className="max-h-28">
                      <ul className="text-xs space-y-0.5 list-disc list-inside">
                        {[...new Set(result.errors)].slice(0, 10).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {result.errors.length > 10 && (
                          <li>…and {result.errors.length - 10} more</li>
                        )}
                      </ul>
                    </ScrollArea>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

        </div>{/* end flex-1 */}

        <DialogFooter className="shrink-0 pt-2 border-t">
          {phase === "idle" || parseError ? (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          ) : phase === "mapping" ? (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
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
                Import {filterConfigured ? filteredRawRows.length : parsed!.rawRows.length} record{(filterConfigured ? filteredRawRows.length : parsed!.rawRows.length) !== 1 ? "s" : ""}
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
