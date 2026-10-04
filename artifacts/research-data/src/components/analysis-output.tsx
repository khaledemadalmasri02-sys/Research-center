import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLiveAnnouncer } from "@/components/live-region";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CrossFade } from "@/lib/page-motion";
import {
  HistogramChart,
  FreqBarChart,
  ScatterChartView,
  BoxPlotChart,
  CorrelationHeatmap,
} from "@/components/stat-charts";
import type { AnalysisResult } from "@/lib/stats-types";

type AnyOpts = Record<string, any>;

/**
 * Humanize the raw API keys.
 *
 * The stats grid rendered `p_value`, `t_statistic`, `df_between` verbatim, so
 * a researcher had to know the server's field names to read a result. Unknown
 * keys still fall through to a title-cased version of the key itself.
 */
/**
 * Raw API key -> i18n key. This used to be a key -> English-label map baked into
 * the component, so a researcher running an analysis in Arabic read the whole
 * statistics grid in English. Values are now bundle keys resolved through
 * `t()` at render time; unknown keys still fall through to a title-cased
 * version of the key itself.
 */
const STAT_LABEL_KEYS: Record<string, string> = {
  n: "statLabels.n",
  n1: "statLabels.n1",
  n2: "statLabels.n2",
  nA: "statLabels.nA",
  nB: "statLabels.nB",
  mean: "statLabels.mean",
  meanA: "statLabels.meanA",
  meanB: "statLabels.meanB",
  mean1: "statLabels.mean1",
  mean2: "statLabels.mean2",
  sd: "statLabels.sd",
  sdA: "statLabels.sdA",
  sdB: "statLabels.sdB",
  variance: "statLabels.variance",
  median: "statLabels.median",
  stdErr: "statLabels.stdErr",
  tStatistic: "statLabels.tStatistic",
  t_statistic: "statLabels.tStatistic",
  tCritical: "statLabels.tCritical",
  pValue: "statLabels.pValue",
  p_value: "statLabels.pValue",
  pAdj: "statLabels.pAdj",
  fStatistic: "statLabels.fStatistic",
  f_statistic: "statLabels.fStatistic",
  chiSquare: "statLabels.chiSquare",
  wStatistic: "statLabels.wStatistic",
  hStatistic: "statLabels.hStatistic",
  uStatistic: "statLabels.uStatistic",
  rho: "statLabels.rho",
  r: "statLabels.r",
  rs: "statLabels.rho",
  slope: "statLabels.slope",
  intercept: "statLabels.intercept",
  rSquared: "statLabels.rSquared",
  adjRSquared: "statLabels.adjRSquared",
  df: "statLabels.df",
  dfBetween: "statLabels.dfBetween",
  dfWithin: "statLabels.dfWithin",
  dfTotal: "statLabels.dfTotal",
  dof: "statLabels.dof",
  statistic: "statLabels.statistic",
  criticalValue: "statLabels.criticalValue",
  significant: "statLabels.significant",
  normality: "statLabels.normality",
  shapiro: "statLabels.shapiro",
  icc: "statLabels.icc",
  count: "statLabels.count",
  percentile: "statLabels.percentile",
  min: "statLabels.min",
  max: "statLabels.max",
  q1: "statLabels.q1",
  q3: "statLabels.q3",
  iqr: "statLabels.iqr",
  outliers: "statLabels.outliers",
  sum: "statLabels.sum",
  se: "statLabels.se",
};

export function humanizeStatKey(key: string, t?: (k: string, d?: string) => string): string {
  const bundleKey = STAT_LABEL_KEYS[key];
  if (bundleKey && t) return t(bundleKey, key);
  if (bundleKey) return bundleKey;
  // snake_case -> Sentence case, so an unmapped key is still readable.
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Request failed");
  return data as T;
}

interface Props {
  result: AnalysisResult;
  analysisType: string;
  options: AnyOpts;
  datasetId: number;
}

interface ChartState {
  histogram?: { variable: string; bins: { label: string; count: number }[] };
  box?: { groups: { group: string; stats: any }[] };
  scatter?: { x: string; y: string; points: { x: number; y: number }[] };
  bar?: { variable: string; bars: { label: string; value: number; percent: number }[] };
  correlation?: { labels: string[]; matrix: number[][] };
  histograms?: { variable: string; bins: { label: string; count: number }[] }[];
}

export function AnalysisOutput({ result, analysisType, options, datasetId }: Props) {
  const { t } = useTranslation();
  const { announce } = useLiveAnnouncer();
  const [charts, setCharts] = useState<ChartState>({});
  const [loading, setLoading] = useState(false);
  /**
   * Chart fetches used to `catch {}` — a failed chart request rendered nothing
   * and the reader concluded the data said nothing. Collected and surfaced.
   */
  const [chartErrors, setChartErrors] = useState<string[]>([]);

  /* Provenance. A research result without the dataset, variables, n and
   * timestamp it came from is not reproducible, and this app's whole purpose
   * is research. */
  const provenance = useMemo(() => {
    const vars =
      (options.variables as string[] | undefined) ??
      [
        options.variable,
        options.dependent,
        ...((options.independent as string[] | undefined) ?? []),
        options.groupVariable ?? options.group,
        options.variableA,
        options.variableB,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);
    const unique = [...new Set(vars)];
    return {
      variables: unique,
      exclusions: (options.exclusions as string[] | undefined) ?? [],
      timestamp: new Date(),
    };
  }, [options]);

  useEffect(() => {
    let cancelled = false;
    setCharts({});
    setChartErrors([]);
    if (!result) return;
    const load = async () => {
      setLoading(true);
      const next: ChartState = {};
      try {
        const post = (kind: string, body: AnyOpts) =>
          apiJson(`/api/analysis/datasets/${datasetId}/chart`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, ...body }),
          });

        if (analysisType === "descriptive") {
          const v = options.variable;
          if (v) {
            try {
              const h = await post("bar", { variable: v });
              if (h.bins) next.histogram = { variable: v, bins: h.bins };
              else next.bar = { variable: v, bars: h.bars };
            } catch { /* numeric fallback */ }
          }
        } else if (analysisType === "ttest" || analysisType === "anova" || analysisType === "kruskalwallis" || analysisType === "mannwhitney") {
          const dep = options.dependent ?? options.variableA;
          const grp = options.groupVariable ?? options.group;
          if (dep && grp) next.box = await post("box", { variable: dep, group: grp });
        } else if (analysisType === "wilcoxon") {
          next.scatter = await post("scatter", { variable: options.pairedA, variable2: options.pairedB });
        } else if (analysisType === "regression") {
          const dep = options.dependent;
          const ind = (options.independent ?? [])[0];
          if (dep && ind) next.scatter = await post("scatter", { variable: ind, variable2: dep });
        } else if (analysisType === "correlation") {
          const vars = options.variables ?? [];
          next.correlation = await post("correlation", { variables: vars });
          if (vars.length >= 2) next.scatter = await post("scatter", { variable: vars[0], variable2: vars[1] });
        } else if (analysisType === "normality") {
          const vars: string[] = options.variables ?? [];
          next.histograms = [];
          for (const v of vars.slice(0, 6)) {
            try {
              const h = await post("bar", { variable: v });
              if (h.bins) next.histograms.push({ variable: v, bins: h.bins });
            } catch { /* skip */ }
          }
        }
        if (!cancelled) {
          setCharts(next);
          announce(t("a11y.operationComplete"));
        }
      } catch (e) {
        // Previously a bare `catch {}`: a 500 produced a result card with the
        // statistics and silently no charts, indistinguishable from "no data".
        if (!cancelled) {
          setCharts(next);
          setChartErrors([
            (e as Error).message || t("patients.exportFailed"),
          ]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [result, analysisType, datasetId, announce, t]);

  if (!result) return null;

  // NOTE: For large result tables, consider virtualization with
  // @tanstack/react-virtual or react-window to avoid rendering
  // thousands of DOM nodes. See P3.3 in IMPROVEMENT_PLAN.md.

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {result.summary ? t("analysis.outputViewer") : t("analysis.output")}
        </CardTitle>
        {result.summary && (
          <span className="rounded-md border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium">
            {result.summary}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provenance header — dataset, variables, n, exclusions, timestamp. */}
        <section aria-label={t("analysis.provenance")} className="rounded-md border bg-muted/20 p-3">
          <h3 className="text-sm font-semibold">{t("analysis.provenance")}</h3>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("analysis.dataset")}</dt>
              <dd className="font-mono">#{datasetId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("analysis.analysisType")}</dt>
              <dd>{t(`analysis.types.${analysisType}`, analysisType)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("analysis.variables")}</dt>
              <dd className="font-mono">{provenance.variables.join(", ") || "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("analysis.timestamp")}</dt>
              <dd>{provenance.timestamp.toLocaleString()}</dd>
            </div>
            {provenance.exclusions.length > 0 && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="text-muted-foreground">{t("analysis.exclusions")}</dt>
                <dd>{provenance.exclusions.join(", ")}</dd>
              </div>
            )}
          </dl>
        </section>

        {chartErrors.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("analysis.chartError")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                {chartErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Progress + completion announcement for a long analysis. */}
        <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {loading
            ? t("analysis.loadingCharts")
            : t("analysis.chartsReady", { count: Object.keys(charts).length })}
        </div>

        {/* Charts. The skeleton used to be removed outright the moment the
            charts landed, which made the card jump; it now cross-fades. */}
        <CrossFade
          loading={loading}
          skeleton={<Skeleton className="h-48 w-full" aria-hidden />}
        >
        {charts.histogram && (
          <ChartBlock title={`${t("analysis.histogram")} — ${charts.histogram.variable}`}>
            <HistogramChart bins={charts.histogram.bins} variable={charts.histogram.variable} />
          </ChartBlock>
        )}
        {charts.histograms?.map((h) => (
          <ChartBlock key={h.variable} title={t("analysis.histogramOf", { variable: h.variable })}>
            <HistogramChart bins={h.bins} variable={h.variable} />
          </ChartBlock>
        ))}
        {charts.bar && (
          <ChartBlock title={t("analysis.frequenciesOf", { variable: charts.bar.variable })}>
            <FreqBarChart bars={charts.bar.bars} variable={charts.bar.variable} />
          </ChartBlock>
        )}
        {charts.box && (
          <ChartBlock title={t("analysis.distributionByGroup")}>
            <BoxPlotChart groups={charts.box.groups} />
          </ChartBlock>
        )}
        {charts.scatter && (
          <ChartBlock
            title={`${t("analysis.scatter")} — ${charts.scatter.x} ${t("analysis.vsSuffix")} ${charts.scatter.y}`}
          >
            <ScatterChartView points={charts.scatter.points} xLabel={charts.scatter.x} yLabel={charts.scatter.y} />
          </ChartBlock>
        )}
        {charts.correlation && (
          <ChartBlock title={t("charts.correlation")}>
            <CorrelationHeatmap labels={charts.correlation.labels} matrix={charts.correlation.matrix} />
          </ChartBlock>
        )}
        </CrossFade>

        {/* Statistics grid */}
        {result.stats && Object.keys(result.stats).length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("analysis.statistics")}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(result.stats).map(([k, v]) => {
                if (v && typeof v === "object") return null;
                return (
                  <div key={k} className="rounded-md border px-3 py-2">
                    <div className="text-xs text-muted-foreground">{humanizeStatKey(k, (key2, dflt) => t(key2, dflt ?? k))}</div>
                    <div className="font-medium">{v === null ? "—" : String(v)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tables */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("analysis.tables")}</h3>
          <div className="space-y-4">
            {result.tables.map((tbl, i) => (
              /* Stable key: `tbl.title` when present, else position. */
              <div key={tbl.title ?? `table-${i}`} className="overflow-x-auto border rounded-md">
                {tbl.title && (
                  <div className="px-3 py-2 border-b bg-muted/40 text-sm font-medium">{tbl.title}</div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {tbl.columns.map((c, j) => (
                        <TableHead key={j}>{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tbl.rows.map((r, ri) => (
                      <TableRow key={ri}>
                        {r.map((c, ci) => (
                          <TableCell key={ci}>{c === null ? "" : String(c)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium mb-2">{title}</div>
      {children}
    </div>
  );
}
