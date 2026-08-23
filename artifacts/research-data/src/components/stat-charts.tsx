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

export function HistogramChart({ bins }: { bins: { label: string; count: number }[] }) {
  const data = bins.map((b) => ({ label: b.label, count: b.count }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FreqBarChart({ bars }: { bars: { label: string; value: number; percent: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={bars} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={90} />
        <Tooltip />
        <Bar dataKey="value" fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ScatterChartView({ points, xLabel, yLabel }: { points: { x: number; y: number }[]; xLabel: string; yLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" dataKey="x" name={xLabel} tick={{ fontSize: 10 }} />
        <YAxis type="number" dataKey="y" name={yLabel} tick={{ fontSize: 10 }} />
        <ZAxis range={[40, 40]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={points} fill="hsl(var(--primary))" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function BoxSvg({ stats, label }: { stats: BoxStats; label: string }) {
  const all = [stats.min, stats.max, stats.q1, stats.q3, stats.median, stats.mean, ...stats.outliers];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const sx = (v: number) => ((v - min) / (max - min)) * 240 + 20;
  const mid = 60;
  return (
    <svg viewBox="0 0 280 100" className="w-full h-[140px]">
      <line x1={20} y1={mid} x2={260} y2={mid} className="stroke-muted" />
      {/* whiskers */}
      <line x1={sx(stats.min)} y1={mid} x2={sx(stats.q1)} y2={mid} className="stroke-foreground" />
      <line x1={sx(stats.q3)} y1={mid} x2={sx(stats.max)} y2={mid} className="stroke-foreground" />
      <line x1={sx(stats.min)} y1={mid - 14} x2={sx(stats.min)} y2={mid + 14} className="stroke-foreground" />
      <line x1={sx(stats.max)} y1={mid - 14} x2={sx(stats.max)} y2={mid + 14} className="stroke-foreground" />
      {/* box */}
      <rect x={sx(stats.q1)} y={mid - 22} width={sx(stats.q3) - sx(stats.q1)} height={44} className="fill-primary/30 stroke-primary" strokeWidth={1.5} />
      {/* median */}
      <line x1={sx(stats.median)} y1={mid - 22} x2={sx(stats.median)} y2={mid + 22} className="stroke-primary" strokeWidth={2} />
      {/* mean */}
      <circle cx={sx(stats.mean)} cy={mid} r={3} className="fill-destructive" />
      {/* outliers */}
      {stats.outliers.map((o, i) => (
        <circle key={i} cx={sx(o)} cy={mid} r={2.5} className="fill-destructive/70" />
      ))}
      <text x={sx(stats.median)} y={mid + 40} fontSize={10} textAnchor="middle" className="fill-muted-foreground">{label}</text>
      <text x={20} y={mid + 40} fontSize={9} className="fill-muted-foreground">min {stats.min.toFixed(1)}</text>
      <text x={210} y={mid + 40} fontSize={9} className="fill-muted-foreground">max {stats.max.toFixed(1)}</text>
    </svg>
  );
}

export function BoxPlotChart({ groups }: { groups: { group: string; stats: BoxStats }[] }) {
  if (groups.length === 0) return null;
  if (groups.length === 1) return <BoxSvg stats={groups[0].stats} label={groups[0].group} />;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <div key={g.group} className="rounded-md border p-2">
          <BoxSvg stats={g.stats} label={g.group} />
        </div>
      ))}
    </div>
  );
}

export function CorrelationHeatmap({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const color = (v: number) => {
    const a = Math.abs(v);
    if (v >= 0) return `rgba(34,139,230,${0.15 + a * 0.85})`;
    return `rgba(220,70,70,${0.15 + a * 0.85})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="p-1" />
            {labels.map((l) => (
              <th key={l} className="p-1 font-medium whitespace-nowrap">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="p-1 font-medium whitespace-nowrap">{labels[i]}</td>
              {row.map((v, j) => (
                <td key={j} className="p-0">
                  <div
                    className="w-12 h-8 flex items-center justify-center text-foreground/90"
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
  );
}
