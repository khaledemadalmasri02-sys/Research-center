import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  CartesianGrid,
} from "recharts";
import type { BoxStats } from "@/lib/stats-types";
import { useTranslation } from "react-i18next";
import { useChartAnimation } from "@/lib/page-motion";

/**
 * Chart accessibility contract.
 *
 * Every chart here is a purely visual encoding with **no non-text
 * alternative**: no `role="img"`, no `aria-label`, no `<caption>` on the
 * heatmap table, and no legend for the hand-rolled `BoxSvg` (so a sighted user
 * cannot tell circle=mean from line=median either). Recharts renders an
 * unlabelled `<svg>`; a screen-reader user gets nothing.
 *
 * The pattern used from here on is:
 *   <figure>
 *     <figcaption className="sr-only">…key numbers…</figcaption>
 *     <div role="img" aria-label="…"> …chart… </div>
 *     <p className="visible legend">…legend…</p>
 *   </figure>
 *
 * Axis ticks were 10px; they are now 12px (WCAG 1.4.4 does not mandate a size,
 * but 10px CJK/Arabic-adjacent labels in a clinical tool are not legible).
 */

const AXIS_TICK = { fontSize: 12 };

export function HistogramChart({
  bins,
  variable,
}: {
  bins: { label: string; count: number }[];
  variable?: string;
}) {
  const { t } = useTranslation();
  // recharts animates bars for 1.5s by default and has no reduced-motion
  // awareness of its own; this shortens it and switches it off entirely when
  // the user has asked for reduced motion.
  const chart = useChartAnimation();
  const data = bins.map((b) => ({ label: b.label, count: b.count }));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);
  const label = variable ?? t("charts.category");

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {t("charts.distribution", { variable: label })} —{" "}
        {t("charts.distributionSummary", {
          n: total,
          min: data[0]?.label ?? "—",
          max: data[data.length - 1]?.label ?? "—",
          median: "—",
          mean: total ? (total / Math.max(data.length, 1)).toFixed(1) : "—",
        })}
      </figcaption>
      <div
        role="img"
        aria-label={`${t("charts.distribution", { variable: label })}. n=${total}, peak ${max}.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" />
            <YAxis tick={AXIS_TICK} allowDecimals={false} />
            <Tooltip />
            <Bar
              dataKey="count"
              fill="hsl(var(--primary))"
              name={t("charts.count")}
              isAnimationActive={chart.isAnimationActive}
              animationDuration={chart.animationDuration}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function FreqBarChart({
  bars,
  variable,
}: {
  bars: { label: string; value: number; percent: number }[];
  variable?: string;
}) {
  const { t } = useTranslation();
  const chart = useChartAnimation();
  const total = bars.reduce((s, b) => s + b.value, 0);
  const label = variable ?? t("charts.category");
  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {t("charts.distribution", { variable: label })} —{" "}
        {bars.map((b) => `${b.label}: ${b.value}`).join(", ")}.
      </figcaption>
      <div
        role="img"
        aria-label={`${t("charts.distribution", { variable: label })}. n=${total}.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={bars} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} width={120} />
            <Tooltip />
            <Bar
              dataKey="value"
              fill="hsl(var(--primary))"
              name={t("charts.count")}
              isAnimationActive={chart.isAnimationActive}
              animationDuration={chart.animationDuration}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ScatterChartView({
  points,
  xLabel,
  yLabel,
}: {
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
}) {
  const { t } = useTranslation();
  const chart = useChartAnimation();
  const summary = `${xLabel} (${t("charts.axisVariable")}) × ${yLabel} (${t("charts.axisVariable")}), n=${points.length}`;
  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {summary}. {t("charts.correlationSummary")}
      </figcaption>
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" dataKey="x" name={xLabel} tick={AXIS_TICK} />
            <YAxis type="number" dataKey="y" name={yLabel} tick={AXIS_TICK} />
            <ZAxis range={[40, 40]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter
              data={points}
              fill="hsl(var(--primary))"
              isAnimationActive={chart.isAnimationActive}
              animationDuration={chart.animationDuration}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Shared visible legend — the box plot previously had none. */
export function ChartLegend() {
  const { t } = useTranslation();
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t("charts.legendTitle")}:</span>
      <span aria-hidden className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r="4" fill="currentColor" className="text-destructive" />
        </svg>
        {t("charts.legendMean")}
      </span>
      <span aria-hidden className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden>
          <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="2" className="text-primary" />
        </svg>
        {t("charts.legendMedian")}
      </span>
      <span aria-hidden className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r="2" fill="currentColor" className="text-destructive/70" />
        </svg>
        {t("charts.legendOutliers")}
      </span>
    </p>
  );
}

function BoxSvg({ stats, label }: { stats: BoxStats; label: string }) {
  const { t } = useTranslation();
  const all = [
    stats.min,
    stats.max,
    stats.q1,
    stats.q3,
    stats.median,
    stats.mean,
    ...stats.outliers,
  ];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const sx = (v: number) => ((v - min) / (max - min)) * 240 + 20;
  const mid = 60;
  const n = stats.n;
  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {t("charts.boxSummary", {
          n,
          median: stats.median.toFixed(2),
          mean: stats.mean.toFixed(2),
        })}{" "}
        {t("charts.distributionSummary", {
          n,
          min: stats.min.toFixed(2),
          median: stats.median.toFixed(2),
          max: stats.max.toFixed(2),
          mean: stats.mean.toFixed(2),
        })}
      </figcaption>
      <svg
        viewBox="0 0 280 100"
        className="h-[140px] w-full"
        role="img"
        aria-label={`${t("charts.box", { variable: label })}. ${t("charts.boxSummary", {
          n,
          median: stats.median.toFixed(2),
          mean: stats.mean.toFixed(2),
        })}`}
      >
        <line x1={20} y1={mid} x2={260} y2={mid} className="stroke-muted" />
        {/* whiskers */}
        <line x1={sx(stats.min)} y1={mid} x2={sx(stats.q1)} y2={mid} className="stroke-foreground" />
        <line x1={sx(stats.q3)} y1={mid} x2={sx(stats.max)} y2={mid} className="stroke-foreground" />
        <line x1={sx(stats.min)} y1={mid - 14} x2={sx(stats.min)} y2={mid + 14} className="stroke-foreground" />
        <line x1={sx(stats.max)} y1={mid - 14} x2={sx(stats.max)} y2={mid + 14} className="stroke-foreground" />
        {/* box */}
        <rect
          x={sx(stats.q1)}
          y={mid - 22}
          width={sx(stats.q3) - sx(stats.q1)}
          height={44}
          className="fill-primary/30 stroke-primary"
          strokeWidth={1.5}
        />
        {/* median */}
        <line
          x1={sx(stats.median)}
          y1={mid - 22}
          x2={sx(stats.median)}
          y2={mid + 22}
          className="stroke-primary"
          strokeWidth={2}
        />
        {/* mean */}
        <circle cx={sx(stats.mean)} cy={mid} r={3} className="fill-destructive" />
        {/* outliers — stable keys: value, not array index */}
        {stats.outliers.map((o, i) => (
          <circle key={`${o}-${i}`} cx={sx(o)} cy={mid} r={2.5} className="fill-destructive/70" />
        ))}
        <text x={sx(stats.median)} y={mid + 40} fontSize={12} textAnchor="middle" className="fill-muted-foreground">
          {label}
        </text>
        <text x={20} y={mid + 40} fontSize={12} className="fill-muted-foreground">
          min {stats.min.toFixed(1)}
        </text>
        <text x={210} y={mid + 40} fontSize={12} className="fill-muted-foreground">
          max {stats.max.toFixed(1)}
        </text>
      </svg>
    </figure>
  );
}

export function BoxPlotChart({ groups }: { groups: { group: string; stats: BoxStats }[] }) {
  if (groups.length === 0) return null;
  if (groups.length === 1)
    return (
      <>
        <BoxSvg stats={groups[0].stats} label={groups[0].group} />
        <ChartLegend />
      </>
    );
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.group} className="rounded-md border p-2">
            <BoxSvg stats={g.stats} label={g.group} />
          </div>
        ))}
      </div>
      <ChartLegend />
    </>
  );
}

export function CorrelationHeatmap({
  labels,
  matrix,
}: {
  labels: string[];
  matrix: number[][];
}) {
  const { t } = useTranslation();
  const color = (v: number) => {
    const a = Math.abs(v);
    if (v >= 0) return `rgba(34,139,230,${0.15 + a * 0.85})`;
    return `rgba(220,70,70,${0.15 + a * 0.85})`;
  };
  // Strongest off-diagonal pairs — the actual finding in a heatmap.
  const strongest = matrix
    .flatMap((row, i) =>
      row.map((v, j) => ({ a: labels[i], b: labels[j], v, i, j })),
    )
    .filter((c) => c.i < c.j)
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
    .slice(0, 5);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {t("charts.correlationSummary")}{" "}
        {strongest.map((c) => `${c.a} ~ ${c.b}: ${c.v.toFixed(2)}`).join(", ")}.
      </figcaption>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <caption className="sr-only">{t("charts.correlation")}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1">
                <span className="sr-only">{t("charts.axisVariable")}</span>
              </th>
              {labels.map((l) => (
                <th key={l} scope="col" className="whitespace-nowrap p-1 font-medium">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={labels[i]}>
                <th scope="row" className="whitespace-nowrap p-1 text-start font-medium">
                  {labels[i]}
                </th>
                {row.map((v, j) => (
                  <td key={labels[j]} className="p-0">
                    <div
                      className="flex h-8 w-12 items-center justify-center text-foreground/90"
                      style={{ backgroundColor: color(v) }}
                      title={`${labels[i]} ~ ${labels[j]}: ${v.toFixed(2)}`}
                    >
                      {v.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}