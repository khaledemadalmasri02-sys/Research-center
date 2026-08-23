/**
 * Reliability analysis: Cronbach's α with item-total diagnostics, the SPSS
 * "Reliability Analysis" / R `psych::alpha` output.
 */
import { Dataset } from "../dataset";
import { round } from "../describe";
import type { AnalysisResult, ReliabilityOptions } from "../types";

export interface ItemStat {
  name: string;
  mean: number;
  variance: number;
  correctedItemTotal: number;
  alphaIfDeleted: number;
}

export function cronbachAlpha(matrix: number[][], itemNames: string[]): {
  alpha: number;
  items: ItemStat[];
  n: number;
  k: number;
} {
  const k = matrix.length;
  const n = matrix[0]?.length ?? 0;
  const means = matrix.map((col) => col.reduce((a, b) => a + b, 0) / (n || 1));
  const variances = matrix.map((col, c) =>
    n > 1 ? col.reduce((a, x) => a + (x - means[c]) ** 2, 0) / (n - 1) : 0,
  );
  const sumVar = variances.reduce((a, b) => a + b, 0);

  // Total score per case.
  const totals = new Array(n).fill(0);
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) totals[i] += matrix[c][i];
  const totalMean = totals.reduce((a, b) => a + b, 0) / (n || 1);
  const totalVar = n > 1 ? totals.reduce((a, x) => a + (x - totalMean) ** 2, 0) / (n - 1) : 0;

  const alpha = k > 1 && totalVar > 0 ? (k / (k - 1)) * (1 - sumVar / totalVar) : 0;

  const items: ItemStat[] = matrix.map((col, c) => {
    // Corrected item-total correlation: corr(item, total - item).
    const rest = totals.map((t, i) => t - col[i]);
    const restMean = rest.reduce((a, b) => a + b, 0) / (n || 1);
    const restVar = n > 1 ? rest.reduce((a, x) => a + (x - restMean) ** 2, 0) / (n - 1) : 0;
    const cov = n > 1 ? col.reduce((a, x, i) => a + (x - means[c]) * (rest[i] - restMean), 0) / (n - 1) : 0;
    const corr = variances[c] > 0 && restVar > 0 ? cov / Math.sqrt(variances[c] * restVar) : 0;
    // Alpha if item deleted (recompute from the rest-scored total).
    const sumVarDel = sumVar - variances[c];
    const totalVarDel = restVar;
    const kd = k - 1;
    const alphaDel = kd > 1 && totalVarDel > 0 ? ((kd - 1) / (kd - 2)) * (1 - sumVarDel / totalVarDel) : 0;
    return {
      name: itemNames[c] ?? `Item ${c + 1}`,
      mean: round(means[c]),
      variance: round(variances[c]),
      correctedItemTotal: round(corr),
      alphaIfDeleted: round(Math.max(alphaDel, 0)),
    };
  });

  void totalMean;
  return { alpha: round(alpha), items, n, k };
}

export function runReliability(dataset: Dataset, opts: ReliabilityOptions): AnalysisResult {
  const matrix = opts.variables.map((v) => dataset.numericColumn(v));
  if (matrix.length < 2) throw new Error("Cronbach's α needs at least two items.");
  const n = Math.min(...matrix.map((c) => c.length));
  const trimmed = matrix.map((c) => c.slice(0, n));
  const res = cronbachAlpha(trimmed, opts.variables);

  return {
    type: "reliability",
    summary: `Cronbach's α = ${res.alpha} (${res.k} items, n = ${res.n})`,
    tables: [
      {
        title: "Reliability Statistics",
        columns: ["Cronbach's α", "N Items", "N"],
        rows: [[res.alpha, res.k, res.n]],
      },
      {
        title: "Item-Total Statistics",
        columns: ["Item", "Mean", "Variance", "Corrected Item-Total r", "α if deleted"],
        rows: res.items.map((it) => [it.name, it.mean, it.variance, it.correctedItemTotal, it.alphaIfDeleted]),
      },
    ],
    stats: { alpha: res.alpha, k: res.k, n: res.n },
  };
}
