import { useState } from "react";
import { ArrowLeft, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ImperativePanelHandle } from "react-resizable-panels";
import { useRef } from "react";
import { AnalysisOutput } from "@/components/analysis-output";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { FadeIn } from "@/lib/page-motion";
import { downloadFile } from "./api";
import type {
  AnalysisOptions,
  AnalysisResultFull,
  AnalysisVariable,
  DatasetDetail,
} from "./types";
import { AnalysisBuilder } from "./AnalysisBuilder";
import { VariablePalette } from "./VariablePalette";

const LAYOUT_KEY = "analysis-dataset-layout"
const COLLAPSED_KEY = "analysis-dataset-palette-collapsed"
const MAIN_DEFAULT = 70
const PALETTE_DEFAULT = 30
const PALETTE_MIN = 18
const PALETTE_MAX = 45

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

  // ---- Resizable layout ----
  const paletteRef = useRef<ImperativePanelHandle | null>(null);
  const [mainSize, setMainSize] = useState<number>(() => {
    if (typeof window === "undefined") return MAIN_DEFAULT;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const n = Number(JSON.parse(raw).main);
        if (Number.isFinite(n) && n > 0 && n < 100) return n;
      }
    } catch {
      /* ignore */
    }
    return MAIN_DEFAULT;
  });
  const [paletteCollapsed, setPaletteCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const onLayout = (sizes: number[]) => {
    if (sizes.length >= 1) {
      const main = Math.round(sizes[0]);
      setMainSize(main);
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ main }));
      } catch {
        /* ignore */
      }
    }
  };

  const togglePalette = () => {
    const panel = paletteRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setPaletteCollapsed(false);
      try {
        localStorage.setItem(COLLAPSED_KEY, "0");
      } catch {
        /* ignore */
      }
    } else {
      panel.collapse();
      setPaletteCollapsed(true);
      try {
        localStorage.setItem(COLLAPSED_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onBack();
          }}
        >
          <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" /> {t("analysis.back")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePalette}
          aria-pressed={paletteCollapsed}
          aria-label={
            paletteCollapsed ? t("analysis.expandPalette") : t("analysis.collapsePalette")
          }
        >
          {paletteCollapsed ? (
            <>
              <PanelRightOpen className="me-2 h-4 w-4" /> {t("analysis.expandPalette")}
            </>
          ) : (
            <>
              <PanelRightClose className="me-2 h-4 w-4" /> {t("analysis.collapsePalette")}
            </>
          )}
        </Button>
      </div>

      <ResizablePanelGroup
        direction="horizontal"
        className="min-h-[60vh] rounded-lg"
        onLayout={onLayout}
        autoSaveId={LAYOUT_KEY}
      >
        <ResizablePanel
          defaultSize={MAIN_DEFAULT}
          minSize={45}
          order={1}
        >
          <FadeIn>
            {/* Variables editor + export */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {detail.dataset.name}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({t("analysis.rowsCount", { count: detail.dataset.rowCount })})
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
                {busyVars && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />}
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
                          {t("analysis.noRows")}
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
          </FadeIn>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          ref={paletteRef}
          defaultSize={PALETTE_DEFAULT}
          minSize={PALETTE_MIN}
          maxSize={PALETTE_MAX}
          collapsible
          collapsedSize={0}
          order={2}
          id="variable-palette"
        >
          <aside className="space-y-3 p-1">
            <VariablePalette variables={allVars} onAssign={onAssign} />
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}
