import type { ResultTable } from "./types";
import { Dataset } from "./dataset";

function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[], sample = true): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  return ss / (sample ? n - 1 : n);
}

export interface DescriptiveStats {
  validN: number;
  missingN: number;
  mean: number;
  median: number;
  stdDev: number;
  variance: number;
  stdError: number;
  min: number;
  max: number;
  range: number;
  sum: number;
  q1: number;
  q3: number;
  iqr: number;
  skewness: number;
  kurtosis: number;
}

export function describeNumeric(xs: number[]): DescriptiveStats {
  const n = xs.length;
  const m = mean(xs);
  const v = variance(xs, true);
  const sd = Math.sqrt(v);
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  const m2 = xs.reduce((a, x) => a + (x - m) ** 2, 0) / n;
  const m3 = xs.reduce((a, x) => a + (x - m) ** 3, 0) / n;
  const m4 = xs.reduce((a, x) => a + (x - m) ** 4, 0) / n;
  const skew = (n * n) / ((n - 1) * (n - 2)) * (m3 / Math.pow(m2, 1.5));
  const kurt =
    ((n - 1) * ((n + 1) * (m4 / (m2 * m2)) - 3 * (n - 1)) +
      (n - 1) * (n - 1)) /
    ((n - 2) * (n - 3));
  return {
    validN: n,
    missingN: 0,
    mean: m,
    median: quantileSorted(sorted, 0.5),
    stdDev: sd,
    variance: v,
    stdError: sd / Math.sqrt(n),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
    sum,
    q1: quantileSorted(sorted, 0.25),
    q3: quantileSorted(sorted, 0.75),
    iqr: quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25),
    skewness: skew,
    kurtosis: kurt,
  };
}

/** Run descriptive statistics for one variable of a dataset. */
export function descriptive(
  dataset: Dataset,
  variable: string,
): { stats: Record<string, number | string | null>; table: ResultTable; frequencies?: ResultTable } {
  const meta = dataset.meta(variable);
  if (!meta) throw new Error(`Unknown variable: ${variable}`);
  if (meta.dataType === "numeric") {
    const xs = dataset.numericColumn(variable);
    const s = describeNumeric(xs);
    const table: ResultTable = {
      title: `Descriptives — ${meta.label ?? variable}`,
      columns: ["Statistic", "Value"],
      rows: [
        ["Valid N", s.validN],
        ["Missing", s.missingN],
        ["Mean", round(s.mean)],
        ["Median", round(s.median)],
        ["Std. Deviation", round(s.stdDev)],
        ["Variance", round(s.variance)],
        ["Std. Error", round(s.stdError)],
        ["Minimum", round(s.min)],
        ["Maximum", round(s.max)],
        ["Range", round(s.range)],
        ["Sum", round(s.sum)],
        ["Q1", round(s.q1)],
        ["Q3", round(s.q3)],
        ["IQR", round(s.iqr)],
        ["Skewness", round(s.skewness)],
        ["Kurtosis", round(s.kurtosis)],
      ],
    };
    return { stats: s as unknown as Record<string, number | string | null>, table };
  }
  const freqs = dataset.frequencies(variable);
  const frequencies: ResultTable = {
    title: `Frequencies — ${meta.label ?? variable}`,
    columns: ["Value", "Count", "Percent"],
    rows: freqs.map((f) => [f.value, f.count, round(f.percent)]),
  };
  const stats = {
    validN: freqs.reduce((a, f) => a + f.count, 0),
    categories: freqs.length,
  } as Record<string, number | string | null>;
  return { stats, table: frequencies, frequencies };
}

export function round(x: number, digits = 4): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return round(p, 3).toString();
}
