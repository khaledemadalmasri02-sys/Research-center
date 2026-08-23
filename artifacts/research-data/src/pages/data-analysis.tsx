import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  BarChart3,
  Database,
  Download,
  Loader2,
  Play,
  Upload,
  Boxes,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalysisOutput } from "@/components/analysis-output";
import type { AnalysisResult } from "@/lib/stats-types";

type Cell = number | string | null;

interface AnalysisVariable {
  name: string;
  label?: string | null;
  dataType: string;
  measure: string;
  missingValues?: (string | number)[] | null;
  valueLabels?: Record<string, string> | null;
}

interface DatasetSummary {
  id: number;
  name: string;
  source: string;
  format: string;
  rowCount: number;
  createdAt?: string;
}

interface DatasetDetail {
  dataset: DatasetSummary;
  variables: AnalysisVariable[];
  preview: Cell[][];
}

interface ResultTable {
  title?: string;
  columns: string[];
  rows: (number | string | null)[][];
}

interface AnalysisResultFull extends AnalysisResult {
  id: number;
}

const ANALYSIS_TYPES = [
  { value: "descriptive", label: "Descriptive" },
  { value: "ttest", label: "T-Test" },
  { value: "anova", label: "ANOVA" },
  { value: "chisquare", label: "Chi-Square" },
  { value: "correlation", label: "Correlation" },
  { value: "regression", label: "Linear Regression" },
  { value: "normality", label: "Normality" },
  { value: "mannwhitney", label: "Mann–Whitney U" },
  { value: "wilcoxon", label: "Wilcoxon" },
  { value: "kruskalwallis", label: "Kruskal–Wallis" },
  { value: "friedman", label: "Friedman" },
  { value: "logistic", label: "Logistic Regression" },
  { value: "reliability", label: "Reliability (α)" },
  { value: "pca", label: "PCA / Factor" },
] as const;

async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Request failed");
  return data as T;
}

async function downloadFile(url: string, body: unknown, filename: string) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || "Export failed");
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function defaultOpts(type: string): Record<string, any> {
  switch (type) {
    case "ttest":
      return { mode: "independent", equalVariance: true, alpha: 0.05 };
    case "anova":
      return { alpha: 0.05 };
    case "chisquare":
      return { alpha: 0.05 };
    case "correlation":
      return { method: "pearson", variables: [], alpha: 0.05 };
    case "regression":
      return { independent: [], intercept: true, alpha: 0.05 };
    case "normality":
      return { variables: [], alpha: 0.05 };
    case "mannwhitney":
      return { dependent: undefined, group: undefined, groupA: undefined, groupB: undefined, alpha: 0.05 };
    case "wilcoxon":
      return { pairedA: undefined, pairedB: undefined, alpha: 0.05 };
    case "kruskalwallis":
      return { dependent: undefined, group: undefined, alpha: 0.05 };
    case "friedman":
      return { variables: [] };
    case "logistic":
      return { dependent: undefined, independent: [], intercept: true, alpha: 0.05 };
    case "reliability":
      return { variables: [] };
    case "pca":
      return { variables: [], components: 0, rotation: "none" };
    default:
      return {};
  }
}

const MULTI_TYPES = new Set(["normality", "friedman", "reliability", "pca", "correlation"]);

export default function DataAnalysis() {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<DatasetSummary | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importFormat, setImportFormat] = useState("");
  const [busyImport, setBusyImport] = useState(false);

  const [buildName, setBuildName] = useState("");
  const [buildColumns, setBuildColumns] = useState("");
  const [buildSex, setBuildSex] = useState("");
  const [buildType, setBuildType] = useState("");
  const [buildSearch, setBuildSearch] = useState("");
  const [busyBuild, setBusyBuild] = useState(false);

  const [varDraft, setVarDraft] = useState<Record<string, { label: string; measure: string }>>({});
  const [busyVars, setBusyVars] = useState(false);

  const [analysisType, setAnalysisType] = useState<string>("descriptive");
  const [opts, setOpts] = useState<Record<string, any>>(defaultOpts("descriptive"));
  const [busyAnalyze, setBusyAnalyze] = useState(false);
  const [result, setResult] = useState<AnalysisResultFull | null>(null);
  const [lastOptions, setLastOptions] = useState<Record<string, any>>({});

  const loadDatasets = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiJson<DatasetSummary[]>("/api/analysis/datasets");
      setDatasets(list);
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    }
  };

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setFile(null);
      setImportName("");
      setImportFormat("");
      await loadDatasets();
    } catch (e: any) {
      setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyBuild(false);
    }
  };

  const saveVariables = async () => {
    if (!detail) return;
    setBusyVars(true);
    setError(null);
    try {
      const updates = detail.variables.map((v) => ({
        name: v.name,
        label: varDraft[v.name]?.label ?? null,
        measure: (varDraft[v.name]?.measure as any) ?? "scale",
        missingValues: v.missingValues ?? null,
        valueLabels: v.valueLabels ?? null,
      }));
      await apiJson(`/api/analysis/datasets/${detail.dataset.id}/variables`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await openDataset(detail.dataset);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyVars(false);
    }
  };

  const buildOptions = (): Record<string, any> => {
    const o: Record<string, any> = {};
    switch (analysisType) {
      case "descriptive":
        o.variable = opts.variable;
        break;
      case "ttest":
        o.mode = opts.mode;
        o.equalVariance = opts.equalVariance;
        o.alpha = Number(opts.alpha) || 0.05;
        if (opts.mode === "paired") {
          o.pairedA = opts.pairedA;
          o.pairedB = opts.pairedB;
        } else {
          o.dependent = opts.dependent;
          o.groupVariable = opts.groupVariable;
          o.groupA = opts.groupA;
          o.groupB = opts.groupB;
        }
        break;
      case "anova":
        o.dependent = opts.dependent;
        o.group = opts.group;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "chisquare":
        o.row = opts.row;
        o.column = opts.column;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "correlation":
        o.method = opts.method;
        o.variables = opts.variables ?? [];
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "regression":
        o.dependent = opts.dependent;
        o.independent = opts.independent ?? [];
        o.intercept = opts.intercept;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "normality":
        o.variables = opts.variables ?? [];
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "mannwhitney":
        o.dependent = opts.dependent;
        o.group = opts.group;
        o.groupA = opts.groupA;
        o.groupB = opts.groupB;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "wilcoxon":
        o.pairedA = opts.pairedA;
        o.pairedB = opts.pairedB;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "kruskalwallis":
        o.dependent = opts.dependent;
        o.group = opts.group;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "friedman":
        o.variables = opts.variables ?? [];
        break;
      case "logistic":
        o.dependent = opts.dependent;
        o.independent = opts.independent ?? [];
        o.intercept = opts.intercept;
        o.alpha = Number(opts.alpha) || 0.05;
        break;
      case "reliability":
        o.variables = opts.variables ?? [];
        break;
      case "pca":
        o.variables = opts.variables ?? [];
        o.components = Number(opts.components) || undefined;
        o.rotation = opts.rotation;
        break;
    }
    return o;
  };

  const runAnalysis = async () => {
    if (!detail) return;
    setBusyAnalyze(true);
    setError(null);
    const options = buildOptions();
    setLastOptions(options);
    try {
      const data = await apiJson<AnalysisResultFull & { id: number }>(
        `/api/analysis/datasets/${detail.dataset.id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: analysisType, options }),
        },
      );
      setResult({ ...data, id: data.id });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyAnalyze(false);
    }
  };

  /** Click a variable in the Variable View to fill the next relevant field. */
  const assignVariable = (vname: string) => {
    setOpts((prev) => {
      const p = { ...prev };
      const has = (x: any) => x !== undefined && x !== "";
      switch (analysisType) {
        case "descriptive":
          p.variable = vname;
          break;
        case "normality":
        case "reliability":
        case "friedman":
        case "pca": {
          const cur = (p.variables as string[]) ?? [];
          p.variables = cur.includes(vname) ? cur.filter((x) => x !== vname) : [...cur, vname];
          break;
        }
        case "correlation": {
          const cur = (p.variables as string[]) ?? [];
          p.variables = cur.includes(vname) ? cur.filter((x) => x !== vname) : [...cur, vname];
          break;
        }
        case "regression": {
          const cur = (p.independent as string[]) ?? [];
          if (!has(p.dependent)) p.dependent = vname;
          else p.independent = cur.includes(vname) ? cur.filter((x) => x !== vname) : [...cur, vname];
          break;
        }
        case "logistic": {
          const cur = (p.independent as string[]) ?? [];
          if (!has(p.dependent)) p.dependent = vname;
          else p.independent = cur.includes(vname) ? cur.filter((x) => x !== vname) : [...cur, vname];
          break;
        }
        case "ttest":
          if (p.mode === "paired") {
            if (!has(p.pairedA)) p.pairedA = vname;
            else if (!has(p.pairedB)) p.pairedB = vname;
          } else {
            if (!has(p.dependent)) p.dependent = vname;
            else if (!has(p.groupVariable)) p.groupVariable = vname;
          }
          break;
        case "anova":
        case "kruskalwallis":
        case "mannwhitney":
          if (!has(p.dependent)) p.dependent = vname;
          else if (!has(p.group)) p.group = vname;
          break;
        case "wilcoxon":
          if (!has(p.pairedA)) p.pairedA = vname;
          else if (!has(p.pairedB)) p.pairedB = vname;
          break;
        case "chisquare":
          if (!has(p.row)) p.row = vname;
          else if (!has(p.column)) p.column = vname;
          break;
      }
      return p;
    });
  };

  const scaleVars = useMemo(
    () => (detail?.variables.filter((v) => v.measure === "scale") ?? []),
    [detail],
  );
  const catVars = useMemo(
    () => (detail?.variables.filter((v) => v.measure !== "scale") ?? []),
    [detail],
  );
  const allVars = useMemo(() => (detail?.variables ?? []), [detail]);

  const setOpt = (k: string, v: any) => setOpts((prev) => ({ ...prev, [k]: v }));
  const toggleMulti = (k: string, name: string) =>
    setOpts((prev) => {
      const cur = (prev[k] as string[]) ?? [];
      return {
        ...prev,
        [k]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name],
      };
    });

  const measureBadge = (m: string) =>
    m === "scale" ? (
      <Badge variant="secondary" className="text-[10px]">{t("analysis.scale")}</Badge>
    ) : m === "ordinal" ? (
      <Badge variant="outline" className="text-[10px]">{t("analysis.ordinal")}</Badge>
    ) : (
      <Badge variant="outline" className="text-[10px]">{t("analysis.nominal")}</Badge>
    );

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
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="h-4 w-4" /> {t("analysis.importFile")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>{t("analysis.datasetName")}</Label>
                    <Input value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="My dataset" />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("analysis.file")}</Label>
                    <Input type="file" accept=".csv,.xlsx,.sav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("analysis.format")}</Label>
                    <Select value={importFormat} onValueChange={setImportFormat}>
                      <SelectTrigger><SelectValue placeholder="auto" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="csv">CSV</SelectItem>
                        <SelectItem value="xlsx">XLSX</SelectItem>
                        <SelectItem value="sav">SAV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button disabled={!file || busyImport} onClick={importFile}>
                    {busyImport && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("analysis.import")}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" /> {t("analysis.buildFromQuery")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>{t("analysis.datasetName")}</Label>
                    <Input value={buildName} onChange={(e) => setBuildName(e.target.value)} placeholder="Patient dataset" />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("analysis.columns")}</Label>
                    <Input value={buildColumns} onChange={(e) => setBuildColumns(e.target.value)} placeholder="age, sex, finalConfirmedDiagnosis" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>{t("analysis.sex")}</Label>
                      <Input value={buildSex} onChange={(e) => setBuildSex(e.target.value)} placeholder="male" />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("analysis.collectionType")}</Label>
                      <Input value={buildType} onChange={(e) => setBuildType(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("analysis.search")}</Label>
                    <Input value={buildSearch} onChange={(e) => setBuildSearch(e.target.value)} />
                  </div>
                  <Button disabled={busyBuild} onClick={buildQuery}>
                    {busyBuild && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("analysis.build")}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("analysis.datasets")}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : datasets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("analysis.noDatasets")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Format</TableHead>
                          <TableHead>Rows</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {datasets.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.id}</TableCell>
                            <TableCell className="font-medium">{d.name}</TableCell>
                            <TableCell>{d.source}</TableCell>
                            <TableCell>{d.format}</TableCell>
                            <TableCell>{d.rowCount}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="secondary" onClick={() => openDataset(d)}>
                                {t("analysis.open")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {selected && detail && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setDetail(null); setResult(null); }}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {t("analysis.back")}
            </Button>

            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              <div className="space-y-6 min-w-0">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      {detail.dataset.name}{" "}
                      <span className="text-sm font-normal text-muted-foreground">({detail.dataset.rowCount} rows)</span>
                    </CardTitle>
                    <Select
                      defaultValue="csv"
                      onValueChange={(f) =>
                        downloadFile(`/api/analysis/datasets/${detail.dataset.id}/export`, { format: f }, `dataset-${detail.dataset.id}.${f}`).catch((e) => setError(e.message))
                      }
                    >
                      <SelectTrigger className="w-40"><SelectValue placeholder={t("analysis.exportDataset")} /></SelectTrigger>
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
                          {detail.variables.map((v) => (
                            <TableRow key={v.name}>
                              <TableCell className="font-medium">{v.name}</TableCell>
                              <TableCell>
                                <Input
                                  value={varDraft[v.name]?.label ?? ""}
                                  onChange={(e) => setVarDraft((prev) => ({ ...prev, [v.name]: { ...prev[v.name], label: e.target.value } }))}
                                  className="h-8"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={varDraft[v.name]?.measure ?? v.measure}
                                  onValueChange={(m) => setVarDraft((prev) => ({ ...prev, [v.name]: { ...prev[v.name], measure: m } }))}
                                >
                                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
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
                    <Button className="mt-3" disabled={busyVars} onClick={saveVariables}>
                      {busyVars && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t("analysis.saveVariables")}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t("analysis.preview")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {detail.variables.map((v) => (
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
                              <TableCell colSpan={detail.variables.length} className="text-center text-muted-foreground py-4">No rows.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Analysis builder */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Boxes className="h-4 w-4" /> {t("analysis.runAnalysis")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1 max-w-xs">
                      <Label>{t("analysis.analysisType")}</Label>
                      <Select
                        value={analysisType}
                        onValueChange={(ty) => { setAnalysisType(ty); setOpts(defaultOpts(ty)); setResult(null); }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ANALYSIS_TYPES.map((a) => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {analysisType === "descriptive" && (
                        <VarSelect label={t("analysis.variable")} vars={scaleVars} value={opts.variable} onChange={(v) => setOpt("variable", v)} />
                      )}

                      {analysisType === "ttest" && (
                        <>
                          <div className="space-y-1">
                            <Label>{t("analysis.mode")}</Label>
                            <Select value={opts.mode} onValueChange={(m) => setOpt("mode", m)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="independent">{t("analysis.independent")}</SelectItem>
                                <SelectItem value="paired">{t("analysis.paired")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {opts.mode === "paired" ? (
                            <>
                              <VarSelect label={t("analysis.pairedA")} vars={allVars} value={opts.pairedA} onChange={(v) => setOpt("pairedA", v)} />
                              <VarSelect label={t("analysis.pairedB")} vars={allVars} value={opts.pairedB} onChange={(v) => setOpt("pairedB", v)} />
                            </>
                          ) : (
                            <>
                              <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                              <VarSelect label={t("analysis.groupVariable")} vars={catVars} value={opts.groupVariable} onChange={(v) => setOpt("groupVariable", v)} />
                              <div className="space-y-1">
                                <Label>{t("analysis.groupA")}</Label>
                                <Input value={opts.groupA ?? ""} onChange={(e) => setOpt("groupA", e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <Label>{t("analysis.groupB")}</Label>
                                <Input value={opts.groupB ?? ""} onChange={(e) => setOpt("groupB", e.target.value)} />
                              </div>
                              <div className="flex items-end gap-2">
                                <input type="checkbox" id="eqvar" checked={!!opts.equalVariance} onChange={(e) => setOpt("equalVariance", e.target.checked)} />
                                <Label htmlFor="eqvar">{t("analysis.equalVariance")}</Label>
                              </div>
                            </>
                          )}
                        </>
                      )}

                      {analysisType === "anova" && (
                        <>
                          <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                          <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group} onChange={(v) => setOpt("group", v)} />
                        </>
                      )}

                      {analysisType === "chisquare" && (
                        <>
                          <VarSelect label={t("analysis.row")} vars={allVars} value={opts.row} onChange={(v) => setOpt("row", v)} />
                          <VarSelect label={t("analysis.column")} vars={allVars} value={opts.column} onChange={(v) => setOpt("column", v)} />
                        </>
                      )}

                      {analysisType === "correlation" && (
                        <>
                          <div className="space-y-1">
                            <Label>{t("analysis.method")}</Label>
                            <Select value={opts.method} onValueChange={(m) => setOpt("method", m)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pearson">Pearson</SelectItem>
                                <SelectItem value="spearman">Spearman</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <VariableMultiSelect label={`${t("analysis.variables")}`} vars={allVars} selected={opts.variables ?? []} onToggle={(n) => toggleMulti("variables", n)} />
                        </>
                      )}

                      {analysisType === "regression" && (
                        <>
                          <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                          <VariableMultiSelect label={t("analysis.independent")} vars={scaleVars} selected={opts.independent ?? []} onToggle={(n) => toggleMulti("independent", n)} />
                          <div className="flex items-end gap-2">
                            <input type="checkbox" id="intercept" checked={!!opts.intercept} onChange={(e) => setOpt("intercept", e.target.checked)} />
                            <Label htmlFor="intercept">{t("analysis.intercept")}</Label>
                          </div>
                        </>
                      )}

                      {analysisType === "normality" && (
                        <VariableMultiSelect label={t("analysis.variables")} vars={allVars} selected={opts.variables ?? []} onToggle={(n) => toggleMulti("variables", n)} />
                      )}

                      {analysisType === "mannwhitney" && (
                        <>
                          <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                          <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group} onChange={(v) => setOpt("group", v)} />
                          <div className="space-y-1"><Label>{t("analysis.groupA")}</Label><Input value={opts.groupA ?? ""} onChange={(e) => setOpt("groupA", e.target.value)} /></div>
                          <div className="space-y-1"><Label>{t("analysis.groupB")}</Label><Input value={opts.groupB ?? ""} onChange={(e) => setOpt("groupB", e.target.value)} /></div>
                        </>
                      )}

                      {analysisType === "wilcoxon" && (
                        <>
                          <VarSelect label={t("analysis.pairedA")} vars={allVars} value={opts.pairedA} onChange={(v) => setOpt("pairedA", v)} />
                          <VarSelect label={t("analysis.pairedB")} vars={allVars} value={opts.pairedB} onChange={(v) => setOpt("pairedB", v)} />
                        </>
                      )}

                      {analysisType === "kruskalwallis" && (
                        <>
                          <VarSelect label={t("analysis.dependent")} vars={scaleVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                          <VarSelect label={t("analysis.group")} vars={catVars} value={opts.group} onChange={(v) => setOpt("group", v)} />
                        </>
                      )}

                      {analysisType === "friedman" && (
                        <VariableMultiSelect label={t("analysis.variables")} vars={allVars} selected={opts.variables ?? []} onToggle={(n) => toggleMulti("variables", n)} />
                      )}

                      {analysisType === "logistic" && (
                        <>
                          <VarSelect label={t("analysis.dependent")} vars={allVars} value={opts.dependent} onChange={(v) => setOpt("dependent", v)} />
                          <VariableMultiSelect label={t("analysis.independent")} vars={allVars} selected={opts.independent ?? []} onToggle={(n) => toggleMulti("independent", n)} />
                          <div className="flex items-end gap-2">
                            <input type="checkbox" id="logit-intercept" checked={!!opts.intercept} onChange={(e) => setOpt("intercept", e.target.checked)} />
                            <Label htmlFor="logit-intercept">{t("analysis.intercept")}</Label>
                          </div>
                        </>
                      )}

                      {analysisType === "reliability" && (
                        <VariableMultiSelect label={t("analysis.variables")} vars={allVars} selected={opts.variables ?? []} onToggle={(n) => toggleMulti("variables", n)} />
                      )}

                      {analysisType === "pca" && (
                        <>
                          <VariableMultiSelect label={t("analysis.variables")} vars={scaleVars} selected={opts.variables ?? []} onToggle={(n) => toggleMulti("variables", n)} />
                          <div className="space-y-1">
                            <Label>{t("analysis.components")}</Label>
                            <Input type="number" min={1} value={opts.components ?? 0} onChange={(e) => setOpt("components", e.target.value)} placeholder="auto" />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("analysis.rotation")}</Label>
                            <Select value={opts.rotation} onValueChange={(r) => setOpt("rotation", r)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{t("analysis.none")}</SelectItem>
                                <SelectItem value="varimax">{t("analysis.varimax")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}

                      <div className="space-y-1">
                        <Label>{t("analysis.alpha")}</Label>
                        <Input type="number" step="0.01" value={opts.alpha ?? 0.05} onChange={(e) => setOpt("alpha", e.target.value)} />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button disabled={busyAnalyze} onClick={runAnalysis}>
                        {busyAnalyze && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <Play className="mr-2 h-4 w-4" /> {t("analysis.run")}
                      </Button>
                      {result && (
                        <Button variant="secondary" disabled={!result.id} onClick={() => downloadFile(`/api/analysis/runs/${result.id}/export`, { format: "csv" }, `run-${result.id}.csv`).catch((e) => setError(e.message))}>
                          <Download className="mr-2 h-4 w-4" /> {t("analysis.exportRun")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {result && (
                  <AnalysisOutput
                    result={result}
                    analysisType={analysisType}
                    options={lastOptions}
                    datasetId={detail.dataset.id}
                  />
                )}
              </div>

              {/* Variable View palette (SPSS-like) */}
              <aside className="space-y-3">
                <Card className="lg:sticky lg:top-4">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Boxes className="h-4 w-4" /> {t("analysis.variableView")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-2">Click a variable to assign it to the active analysis.</p>
                    <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                      {allVars.map((v) => (
                        <button
                          key={v.name}
                          onClick={() => assignVariable(v.name)}
                          className="w-full text-left rounded-md border px-2 py-1.5 hover:bg-accent transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{v.label || v.name}</span>
                            {measureBadge(v.measure)}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">{v.name}</div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function VarSelect({ label, vars, value, onChange }: { label: string; vars: AnalysisVariable[]; value?: string; onChange: (v: string) => void; }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {vars.map((v) => (
            <SelectItem key={v.name} value={v.name}>{v.label || v.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function VariableMultiSelect({ label, vars, selected, onToggle }: { label: string; vars: AnalysisVariable[]; selected: string[]; onToggle: (n: string) => void; }) {
  return (
    <div className="space-y-1 md:col-span-2">
      <Label>{label}</Label>
      <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
        {vars.map((v) => (
          <label key={v.name} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.includes(v.name)} onChange={() => onToggle(v.name)} />
            {v.label || v.name}
          </label>
        ))}
        {vars.length === 0 && <p className="text-xs text-muted-foreground">No variables.</p>}
      </div>
    </div>
  );
}
