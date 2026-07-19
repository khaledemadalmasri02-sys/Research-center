import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { parseExcelFile, rowToPatient, FIELD_LABELS, type ParsedImport } from "@/lib/import-utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (patients: Record<string, unknown>[]) => Promise<{ imported: number; failed: number }>;
};

type Phase = "idle" | "preview" | "importing" | "done";

export function ExcelImportDialog({ open, onOpenChange, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setParsed(null);
    setFileName("");
    setProgress(0);
    setResult(null);
    setParseError(null);
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
      if (result.rows.length === 0) {
        setParseError("No data rows found in the file. Make sure the first row contains column headers.");
        return;
      }
      const mapped = result.columnMap.filter((c) => c.field !== null);
      if (mapped.length === 0) {
        setParseError("No recognisable columns found. Make sure column headers match the expected field names.");
        return;
      }
      setParsed(result);
      setPhase("preview");
    } catch (err) {
      setParseError((err as Error).message || "Failed to parse file.");
    }
  }

  async function handleImport() {
    if (!parsed) return;
    setPhase("importing");
    setProgress(0);

    const patients = parsed.rows.map(rowToPatient);
    let done = 0;
    let failed = 0;

    // Import in small batches so the progress bar updates
    for (const patient of patients) {
      try {
        const res = await onImport([patient]);
        done += res.imported;
        failed += res.failed;
      } catch {
        failed++;
      }
      setProgress(Math.round(((done + failed) / patients.length) * 100));
    }

    setResult({ imported: done, failed });
    setPhase("done");
  }

  const mappedCols   = parsed?.columnMap.filter((c) => c.field) ?? [];
  const skippedCols  = parsed?.columnMap.filter((c) => !c.field) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Import from Excel
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx / .xls). Column headers are auto-detected and mapped to patient fields.
          </DialogDescription>
        </DialogHeader>

        {/* ── Idle / pick file ── */}
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
              <p className="text-sm text-destructive flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {parseError}
              </p>
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

        {/* ── Preview ── */}
        {phase === "preview" && parsed && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="w-4 h-4" />
              <span className="truncate font-medium text-foreground">{fileName}</span>
              <span>·</span>
              <span>{parsed.rows.length} rows</span>
            </div>

            {/* Mapped columns */}
            <div>
              <p className="text-sm font-semibold mb-2">
                Detected columns{" "}
                <Badge variant="secondary" className="ml-1">{mappedCols.length}</Badge>
              </p>
              <ScrollArea className="h-48 rounded border p-2">
                <div className="space-y-1">
                  {mappedCols.map((col) => (
                    <div key={col.header} className="flex items-center justify-between text-sm gap-2">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]" title={col.header}>
                        {col.header}
                      </span>
                      <span className="text-muted-foreground/50">→</span>
                      <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 shrink-0">
                        {FIELD_LABELS[col.field!]}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Skipped columns */}
            {skippedCols.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-1 text-muted-foreground">
                  Skipped (unrecognised){" "}
                  <Badge variant="secondary" className="ml-1">{skippedCols.length}</Badge>
                </p>
                <div className="flex flex-wrap gap-1">
                  {skippedCols.map((col) => (
                    <Badge key={col.header} variant="secondary" className="text-xs font-mono">
                      {col.header}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Row preview */}
            {parsed.rows.length > 0 && (
              <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3">
                <span className="font-medium text-foreground">First row preview: </span>
                {(() => {
                  const first = parsed.rows[0]!;
                  const preview = mappedCols
                    .slice(0, 4)
                    .map((c) => first[c.field!])
                    .filter(Boolean)
                    .join(" · ");
                  return preview || "—";
                })()}
              </div>
            )}
          </div>
        )}

        {/* ── Importing ── */}
        {phase === "importing" && (
          <div className="py-8 space-y-4">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
              <span className="text-sm">Importing {parsed?.rows.length} records…</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{progress}%</p>
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && result && (
          <div className="py-6 space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
              <div>
                <p className="font-semibold">Import complete</p>
                <p className="text-sm text-muted-foreground">
                  {result.imported} record{result.imported !== 1 ? "s" : ""} imported successfully.
                  {result.failed > 0 && (
                    <span className="text-destructive"> {result.failed} failed (duplicate ID or validation error).</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === "idle" || parseError ? (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          ) : phase === "preview" ? (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={handleImport}>
                Import {parsed!.rows.length} record{parsed!.rows.length !== 1 ? "s" : ""}
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
