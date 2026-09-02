import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { apiJson } from "./api";
import { DatasetView } from "./DatasetView";
import { LandingView } from "./LandingView";
import { assignVariable, buildOptions, defaultOpts } from "./options";
import type {
  AnalysisOptions,
  AnalysisResultFull,
  DatasetDetail,
  DatasetSummary,
} from "./types";

/**
 * Data-analysis page (refactored into a folder of per-panel files).
 *
 *   - types.ts     - shared TS interfaces
 *   - api.ts       - apiJson / downloadFile
 *   - options.ts   - ANALYSIS_TYPES, defaultOpts, buildOptions, assignVariable
 *   - VariableSelect.tsx  - VarSelect, VariableMultiSelect
 *   - AnalysisBuilder.tsx - the form per analysis type
 *   - VariablePalette.tsx - right-side SPSS-like palette
 *   - LandingView.tsx     - import + build + datasets list
 *   - DatasetView.tsx     - variables + preview + builder + results
 *   - index.tsx           - this file (orchestrator only)
 *
 * The orchestrator owns the page state. The panels are presentational and
 * receive everything they need through props.
 */
export default function DataAnalysis() {
  const { t } = useTranslation();

  // ---- List + loading ----
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Selected dataset + detail ----
  const [selected, setSelected] = useState<DatasetSummary | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);

  // ---- Import panel ----
  const [file, setFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importFormat, setImportFormat] = useState("");
  const [busyImport, setBusyImport] = useState(false);

  // ---- Build-from-query panel ----
  const [buildName, setBuildName] = useState("");
  const [buildColumns, setBuildColumns] = useState("");
  const [buildSex, setBuildSex] = useState("");
  const [buildType, setBuildType] = useState("");
  const [buildSearch, setBuildSearch] = useState("");
  const [busyBuild, setBusyBuild] = useState(false);

  // ---- Variables editor ----
  const [varDraft, setVarDraft] = useState<
    Record<string, { label: string; measure: string }>
  >({});
  const [busyVars, setBusyVars] = useState(false);

  // ---- Analysis builder ----
  const [analysisType, setAnalysisType] = useState<string>("descriptive");
  const [opts, setOpts] = useState<AnalysisOptions>(defaultOpts("descriptive"));
  const [busyAnalyze, setBusyAnalyze] = useState(false);
  const [result, setResult] = useState<AnalysisResultFull | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------
  const loadDatasets = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiJson<DatasetSummary[]>("/api/analysis/datasets");
      setDatasets(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatasets();
  }, []);

  const openDataset = async (ds: DatasetSummary) => {
    setSelected(ds);
    setResult(null);
    setError(null);
    try {
      const d = await apiJson<DatasetDetail>(`/api/analysis/datasets/${ds.id}`);
      setDetail(d);
      const draft: Record<string, { label: string; measure: string }> = {};
      d.variables.forEach((v) => {
        draft[v.name] = { label: v.label ?? "", measure: v.measure };
      });
      setVarDraft(draft);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // -----------------------------------------------------------------------
  // Import + build
  // -----------------------------------------------------------------------
  const importFile = async () => {
    if (!file) return;
    setBusyImport(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (importName) fd.append("name", importName);
      if (importFormat) fd.append("format", importFormat);
      const res = await fetch("/api/analysis/datasets", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Import failed");
      setFile(null);
      setImportName("");
      setImportFormat("");
      await loadDatasets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyImport(false);
    }
  };

  const buildQuery = async () => {
    setBusyBuild(true);
    setError(null);
    try {
      const columns = buildColumns
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      await apiJson("/api/analysis/datasets/from-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: buildName || undefined,
          columns: columns.length ? columns : undefined,
          sex: buildSex || undefined,
          collectionType: buildType || undefined,
          search: buildSearch || undefined,
        }),
      });
      setBuildName("");
      setBuildColumns("");
      setBuildSex("");
      setBuildType("");
      setBuildSearch("");
      await loadDatasets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyBuild(false);
    }
  };

  // -----------------------------------------------------------------------
  // Variables
  // -----------------------------------------------------------------------
  const saveVariables = async () => {
    if (!detail) return;
    setBusyVars(true);
    setError(null);
    try {
      const updates = detail.variables.map((v) => ({
        name: v.name,
        label: varDraft[v.name]?.label ?? null,
        measure: (varDraft[v.name]?.measure as string) ?? "scale",
        missingValues: v.missingValues ?? null,
        valueLabels: v.valueLabels ?? null,
      }));
      await apiJson(`/api/analysis/datasets/${detail.dataset.id}/variables`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await openDataset(detail.dataset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyVars(false);
    }
  };

  // -----------------------------------------------------------------------
  // Analysis
  // -----------------------------------------------------------------------
  const runAnalysis = async () => {
    if (!detail) return;
    setBusyAnalyze(true);
    setError(null);
    try {
      const data = await apiJson<AnalysisResultFull>(
        `/api/analysis/datasets/${detail.dataset.id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: analysisType, options: buildOptions(analysisType, opts) }),
        },
      );
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAnalyze(false);
    }
  };

  const assignVariableFromPalette = (vname: string) => {
    setOpts((prev) => assignVariable(analysisType, prev, vname));
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" /> {t("analysis.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("analysis.subtitle")}</p>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {!selected && (
          <LandingView
            datasets={datasets}
            loading={loading}
            busyImport={busyImport}
            busyBuild={busyBuild}
            file={file}
            importName={importName}
            importFormat={importFormat}
            setFile={setFile}
            setImportName={setImportName}
            setImportFormat={setImportFormat}
            onImport={importFile}
            buildName={buildName}
            buildColumns={buildColumns}
            buildSex={buildSex}
            buildType={buildType}
            buildSearch={buildSearch}
            setBuildName={setBuildName}
            setBuildColumns={setBuildColumns}
            setBuildSex={setBuildSex}
            setBuildType={setBuildType}
            setBuildSearch={setBuildSearch}
            onBuild={buildQuery}
            onOpen={openDataset}
          />
        )}

        {selected && detail && (
          <DatasetView
            detail={detail}
            varDraft={varDraft}
            setVarDraft={setVarDraft}
            busyVars={busyVars}
            onSaveVariables={saveVariables}
            onBack={() => {
              setSelected(null);
              setDetail(null);
              setResult(null);
            }}
            analysisType={analysisType}
            opts={opts}
            setAnalysisType={(t) => {
              setAnalysisType(t);
              setOpts(defaultOpts(t));
              setResult(null);
            }}
            setOpts={setOpts}
            busyAnalyze={busyAnalyze}
            onRun={runAnalysis}
            result={result}
            onAssign={assignVariableFromPalette}
            setError={setError}
          />
        )}
      </div>
    </Layout>
  );
}
