/**
 * Chart-data builders. These produce plain serializable structures consumed by
 * the UI chart components (histograms, box plots, scatter, bar charts) so the
 * statistics engine and the rendering layer stay decoupled.
 */
import { Dataset } from "./dataset";

function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

export interface HistogramBin {
  x0: number;
  x1: number;
  label: string;
  count: number;
}

export function histogram(values: number[], bins = 0): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ x0: min, x1: max, label: String(min), count: values.length }];
  const nBins = bins > 0 ? bins : Math.max(1, Math.ceil(Math.sqrt(values.length)));
  const width = (max - min) / nBins;
  const out: HistogramBin[] = Array.from({ length: nBins }, (_, i) => {
    const x0 = min + i * width;
    const x1 = i === nBins - 1 ? max : x0 + width;
    return { x0, x1, label: `${x0.toFixed(2)}`, count: 0 };
  });
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    out[idx].count += 1;
  }
  return out;
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  iqr: number;
  outliers: number[];
}

export function boxplotStats(values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= loFence && v <= hiFence);
  const outliers = sorted.filter((v) => v < loFence || v > hiFence);
  return {
    min: inliers.length ? inliers[0] : sorted[0],
    q1,
    median,
    q3,
    max: inliers.length ? inliers[inliers.length - 1] : sorted[sorted.length - 1],
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    iqr,
    outliers,
  };
}

export function scatterPoints(x: number[], y: number[]): { x: number; y: number }[] {
  const n = Math.min(x.length, y.length);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) out.push({ x: x[i], y: y[i] });
  }
  return out;
}

export function barData(
  freqs: { value: string; count: number; percent: number }[],
): { label: string; value: number; percent: number }[] {
  return freqs.map((f) => ({ label: f.value, value: f.count, percent: f.percent }));
}

/** Build a histogram spec for a dataset variable (numeric). */
export function variableHistogram(dataset: Dataset, variable: string): HistogramBin[] {
  return histogram(dataset.numericColumn(variable));
}

/** Build box-plot specs per group for a grouped numeric variable. */
export function groupedBoxStats(
  dataset: Dataset,
  dependent: string,
  group: string,
): { group: string; stats: BoxStats }[] {
  const groups = dataset.groupedNumeric(dependent, group);
  return [...groups.entries()].map(([g, vals]) => ({ group: g, stats: boxplotStats(vals) }));
}

/** Pearson correlation matrix for a set of numeric variables. */
export function correlationMatrixData(
  dataset: Dataset,
  variables: string[],
): { labels: string[]; matrix: number[][] } {
  const cols = variables.map((v) => dataset.numericColumn(v));
  const n = Math.min(...cols.map((c) => c.length)) || 0;
  const labels = variables;
  const matrix = cols.map((a) =>
    cols.map((b) => {
      const xs = a.slice(0, n);
      const ys = b.slice(0, n);
      const mx = xs.reduce((s, x) => s + x, 0) / (n || 1);
      const my = ys.reduce((s, y) => s + y, 0) / (n || 1);
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
      }
      const d = Math.sqrt(sxx * syy);
      return d === 0 ? 0 : sxy / d;
    }),
  );
  return { labels, matrix };
}
