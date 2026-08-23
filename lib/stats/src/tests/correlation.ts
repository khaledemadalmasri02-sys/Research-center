import { studentTCdf } from "../mathx";
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import { correlationCI } from "../effects";
import type { AnalysisResult, CorrelationOptions } from "../types";

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? NaN : sxy / denom;
}

function rank(xs: number[]): number[] {
  const sorted = [...xs].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length).fill(0);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length - 1 && sorted[j + 1].v === sorted[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

export function correlation(
  pairs: { x: number[]; y: number[] },
  method: "pearson" | "spearman",
  alpha = 0.05,
): { r: number; n: number; t: number; p: number } {
  let x = pairs.x;
  let y = pairs.y;
  if (method === "spearman") {
    x = rank(x);
    y = rank(y);
  }
  const r = pearson(x, y);
  const n = x.length;
  if (n < 3 || Number.isNaN(r) || Math.abs(r) >= 1) {
    return { r, n, t: NaN, p: NaN };
  }
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = 2 * (1 - studentTCdf(Math.abs(t), n - 2));
  return { r, n, t, p };
}

export function runCorrelation(dataset: Dataset, opts: CorrelationOptions): AnalysisResult {
  const vars = opts.variables;
  if (vars.length < 2) throw new Error("Correlation needs at least two variables.");
  const cols = vars.map((v) => ({
    name: v,
    values: dataset.numericColumn(v),
  }));
  const n = Math.min(...cols.map((c) => c.values.length));
  const matrix: (number | string)[][] = [["", ...vars.map((v) => dataset.meta(v)?.label ?? v)]];
  const statPairs: { i: string; j: string; r: number; ci: string }[] = [];

  for (let i = 0; i < cols.length; i++) {
    const row: (number | string)[] = [dataset.meta(vars[i])?.label ?? vars[i]];
    for (let j = 0; j < cols.length; j++) {
      if (i === j) {
        row.push("1.000");
        continue;
      }
      const xi = cols[i].values.slice(0, n);
      const yi = cols[j].values.slice(0, n);
      const { r, n: nn, p } = correlation({ x: xi, y: yi }, opts.method, opts.alpha ?? 0.05);
      const ci = correlationCI(r, nn);
      statPairs.push({ i: vars[i], j: vars[j], r, ci: `${ci.ciLow} – ${ci.ciHigh}` });
      row.push(`${round(r, 3)}${Number.isFinite(p) ? ` (p=${formatP(p)}, n=${nn})` : ""}`);
    }
    matrix.push(row);
  }

  return {
    type: "correlation",
    summary: `${opts.method === "pearson" ? "Pearson" : "Spearman"} correlation matrix (n=${n})`,
    tables: [{ title: "Correlation matrix", columns: matrix[0] as string[], rows: matrix.slice(1) as (number | string | null)[][] }],
    stats: Object.fromEntries(
      statPairs.map((s) => [`${s.i}~${s.j}`, { r: round(s.r, 3), ci: s.ci }]),
    ),
  };
}
