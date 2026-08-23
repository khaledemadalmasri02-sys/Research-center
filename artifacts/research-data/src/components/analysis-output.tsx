import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HistogramChart,
  FreqBarChart,
  ScatterChartView,
  BoxPlotChart,
  CorrelationHeatmap,
} from "@/components/stat-charts";
import type { AnalysisResult } from "@/lib/stats-types";

type AnyOpts = Record<string, any>;

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
  const [charts, setCharts] = useState<ChartState>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCharts({});
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
        if (!cancelled) setCharts(next);
      } catch {
        if (!cancelled) setCharts(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [result, analysisType, datasetId]);

  if (!result) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{result.summary ? "Output Viewer" : "Output"}</CardTitle>
        {result.summary && (
          <span className="rounded-md bg-primary/10 border border-primary/20 px-3 py-1 text-sm font-medium">
            {result.summary}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Charts */}
        {loading && <Skeleton className="h-48 w-full" />}
        {charts.histogram && (
          <ChartBlock title={`Histogram — ${charts.histogram.variable}`}>
            <HistogramChart bins={charts.histogram.bins} />
          </ChartBlock>
        )}
        {charts.histograms?.map((h) => (
          <ChartBlock key={h.variable} title={`Histogram — ${h.variable}`}>
            <HistogramChart bins={h.bins} />
          </ChartBlock>
        ))}
        {charts.bar && (
          <ChartBlock title={`Frequencies — ${charts.bar.variable}`}>
            <FreqBarChart bars={charts.bar.bars} />
          </ChartBlock>
        )}
        {charts.box && (
          <ChartBlock title="Distribution by group">
            <BoxPlotChart groups={charts.box.groups} />
          </ChartBlock>
        )}
        {charts.scatter && (
          <ChartBlock title={`Scatter — ${charts.scatter.x} vs ${charts.scatter.y}`}>
            <ScatterChartView points={charts.scatter.points} xLabel={charts.scatter.x} yLabel={charts.scatter.y} />
          </ChartBlock>
        )}
        {charts.correlation && (
          <ChartBlock title="Correlation matrix">
            <CorrelationHeatmap labels={charts.correlation.labels} matrix={charts.correlation.matrix} />
          </ChartBlock>
        )}

        {/* Statistics grid */}
        {result.stats && Object.keys(result.stats).length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Statistics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(result.stats).map(([k, v]) => {
                if (v && typeof v === "object") return null;
                return (
                  <div key={k} className="rounded-md border px-3 py-2">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="font-medium">{v === null ? "—" : String(v)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tables */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Tables</h3>
          <div className="space-y-4">
            {result.tables.map((tbl, i) => (
              <div key={i} className="overflow-x-auto border rounded-md">
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
