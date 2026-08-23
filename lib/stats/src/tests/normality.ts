/**
 * Normality assessment via the D'Agostino–Pearson omnibus (K²) test, the same
 * statistic reported by scipy.stats.normaltest and R's nortest::agostino.test.
 */
import { Dataset } from "../dataset";
import { chiSquareCdf } from "../mathx";
import { round, formatP } from "../describe";
import type { AnalysisResult, NormalityOptions } from "../types";

export interface NormalityRow {
  variable: string;
  n: number;
  skewness: number;
  kurtosis: number;
  zSkew: number;
  zKurt: number;
  k2: number;
  p: number;
}

export function dagostinoPearson(xs: number[]): Omit<NormalityRow, "variable"> {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const g1 = m3 / Math.pow(m2, 1.5); // sqrt(b1)
  const g2 = m4 / (m2 * m2) - 3; // b2 - 3

  // Skewness z (D'Agostino 1970).
  const Y = g1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) /
    ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const W = Math.sqrt(-1 + Math.sqrt(8 * (beta2 - 1)));
  const delta = 1 / Math.sqrt(Math.log(W));
  const alpha = Math.sqrt(2 / (W * W - 1));
  const zSkew = delta * Math.log(Math.sqrt((Y * Y) / (alpha * alpha) + 1) + Y / alpha);

  // Kurtosis z (D'Agostino 1973).
  const A2 = (6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9)) *
    Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const term = (g2 + 6 / (n + 1)) / Math.sqrt((24 * n) / ((n + 1) * (n + 1) * A2));
  const zKurt = (1 - 2 / (9 * A2) - Math.cbrt((1 - 2 / A2) / (1 + term))) /
    Math.sqrt(2 / (9 * A2));

  const k2 = zSkew * zSkew + zKurt * zKurt;
  const p = 1 - chiSquareCdf(k2, 2);

  return {
    n,
    skewness: round(g1),
    kurtosis: round(g2),
    zSkew: round(zSkew),
    zKurt: round(zKurt),
    k2: round(k2),
    p: round(p),
  };
}

export function runNormality(dataset: Dataset, opts: NormalityOptions): AnalysisResult {
  const alpha = opts.alpha ?? 0.05;
  const rows = opts.variables.map((name) => {
    const xs = dataset.numericColumn(name);
    const r = dagostinoPearson(xs);
    return { variable: name, ...r };
  });
  return {
    type: "normality",
    summary: `D'Agostino–Pearson K² test of normality (χ²₂).`,
    tables: [
      {
        title: "Tests of Normality",
        columns: ["Variable", "N", "Skewness", "Kurtosis", "K²", "p", "Decision"],
        rows: rows.map((r) => [
          r.variable,
          r.n,
          r.skewness,
          r.kurtosis,
          r.k2,
          formatP(r.p),
          r.p < alpha ? "Non-normal" : "Normal",
        ]),
      },
    ],
    stats: Object.fromEntries(rows.map((r) => [r.variable, r.p])),
  };
}
