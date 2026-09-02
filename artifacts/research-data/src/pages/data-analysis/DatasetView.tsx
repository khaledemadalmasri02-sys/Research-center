import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalysisOutput } from "@/components/analysis-output";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadFile } from "./api";
import type {
  AnalysisOptions,
  AnalysisResultFull,
  AnalysisVariable,
  DatasetDetail,
} from "./types";
import { AnalysisBuilder } from "./AnalysisBuilder";
import { VariablePalette } from "./VariablePalette";

interface DatasetViewProps {
  detail: DatasetDetail;
  varDraft: Record<string, { label: string; measure: string }>;
  setVarDraft: (
    fn: (prev: Record<string, { label: string; measure: string }>) => Record<string, { label: string; measure: string }>,
  ) => void;
  busyVars: boolean;
  onSaveVariables: () => void;
  onBack: () => void;
  // Analysis builder props (forwarded)
  analysisType: string;
  opts: AnalysisOptions;
  setAnalysisType: (t: string) => void;
  setOpts: (
    value: AnalysisOptions | ((prev: AnalysisOptions) => AnalysisOptions),
  ) => void;
  busyAnalyze: boolean;
  onRun: () => void;
  // Result
  result: AnalysisResultFull | null;
  // Palette
  onAssign: (name: string) => void;
  // Error
  setError: (msg: string) => void;
}

export function DatasetView(props: DatasetViewProps) {
  const { t } = useTranslation();
  const {
    detail,
    varDraft,
    setVarDraft,
    busyVars,
    onSaveVariables,
    onBack,
    analysisType,
    opts,
    setAnalysisType,
    setOpts,
    busyAnalyze,
    onRun,
    result,
    onAssign,
    setError,
  } = props;

  const allVars: AnalysisVariable[] = detail.variables;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onBack();
        }}
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> {t("analysis.back")}
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6 min-w-0">
          {/* Variables editor + export */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {detail.dataset.name}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({detail.dataset.rowCount} rows)
                </span>
              </CardTitle>
              <Select
                defaultValue="csv"
                onValueChange={(f) =>
                  downloadFile(
                    `/api/analysis/datasets/${detail.dataset.id}/export`,
                    { format: f },
                    `dataset-${detail.dataset.id}.${f}`,
                  ).catch((e) => setError(e.message))
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t("analysis.exportDataset")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="sav">SAV</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("analysis.variable")}</TableHead>
                      <TableHead>{t("analysis.label")}</TableHead>
                      <TableHead>{t("analysis.measure")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allVars.map((v) => (
                      <TableRow key={v.name}>
                        <TableCell className="font-medium">{v.name}</TableCell>
                        <TableCell>
                          <Input
                            value={varDraft[v.name]?.label ?? ""}
                            onChange={(e) =>
                              setVarDraft((prev) => ({
                                ...prev,
                                [v.name]: {
                                  ...prev[v.name],
                                  label: e.target.value,
                                },
                              }))
                            }
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={varDraft[v.name]?.measure ?? v.measure}
                            onValueChange={(m) =>
                              setVarDraft((prev) => ({
                                ...prev,
                                [v.name]: {
                                  ...prev[v.name],
                                  measure: m,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scale">{t("analysis.scale")}</SelectItem>
                              <SelectItem value="ordinal">{t("analysis.ordinal")}</SelectItem>
                              <SelectItem value="nominal">{t("analysis.nominal")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button className="mt-3" disabled={busyVars} onClick={onSaveVariables}>
                {busyVars && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("analysis.saveVariables")}
              </Button>
            </CardContent>
          </Card>

          {/* Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("analysis.preview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {allVars.map((v) => (
                        <TableHead key={v.name}>{v.label || v.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.preview.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((c, j) => (
                          <TableCell key={j}>{c === null ? "" : String(c)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {detail.preview.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={allVars.length}
                          className="text-center text-muted-foreground py-4"
                        >
                          No rows.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Analysis builder */}
          <AnalysisBuilder
            variables={allVars}
            analysisType={analysisType}
            opts={opts}
            setAnalysisType={setAnalysisType}
            setOpts={setOpts}
            busy={busyAnalyze}
            hasResult={!!result}
            resultId={result?.id}
            onRun={onRun}
            onExportRun={() => {
              if (!result?.id) return;
              downloadFile(
                `/api/analysis/runs/${result.id}/export`,
                { format: "csv" },
                `run-${result.id}.csv`,
              ).catch((e) => setError(e.message));
            }}
          />

          {/* Results */}
          {result && (
            <AnalysisOutput
              result={result}
              analysisType={analysisType}
              options={opts}
              datasetId={detail.dataset.id}
            />
          )}
        </div>

        {/* Variable palette */}
        <aside className="space-y-3">
          <VariablePalette variables={allVars} onAssign={onAssign} />
        </aside>
      </div>
    </>
  );
}
