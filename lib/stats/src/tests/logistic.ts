/**
 * Binary logistic regression via iteratively reweighted least squares (IRLS),
 * with Wald tests, likelihood-ratio model test, odds ratios and McFadden's
 * pseudo-R² — the standard SPSS "Binary Logistic" / R `glm` output.
 */
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import { multiply, inverse } from "../linalg";
import { chiSquareCdf, logGamma } from "../mathx";
import type { AnalysisResult, LogisticOptions } from "../types";

function logit(p: number): number {
  return Math.log(p / (1 - p));
}
function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

export interface LogisticResult {
  coefficients: { name: string; b: number; se: number; wald: number; p: number; oddsRatio: number }[];
  modelChiSquare: number;
  df: number;
  modelP: number;
  mcfaddenR2: number;
  n: number;
}

export function logisticRegression(
  y: number[],
  Xcols: number[][],
  names: string[],
  intercept = true,
  alpha = 0.05,
): LogisticResult {
  const n = y.length;
  const design: number[][] = intercept
    ? y.map((_, r) => [1, ...Xcols.map((c) => c[r])])
    : y.map((_, r) => Xcols.map((c) => c[r]));
  const labels = intercept ? ["(Intercept)", ...names] : [...names];
  const p = design[0].length;

  const llBinomial = (ys: number[], ps: number[]) => {
    let ll = 0;
    for (let i = 0; i < ys.length; i++) {
      const yi = ys[i];
      const pi = Math.min(Math.max(ps[i], 1e-12), 1 - 1e-12);
      ll += yi * Math.log(pi) + (1 - yi) * Math.log(1 - pi);
    }
    return ll;
  };

  // Null model.
  const pBase = y.reduce((a, b) => a + b, 0) / n;
  const llNull = llBinomial(y, y.map(() => pBase));

  // IRLS with ridge regularization + step clipping for numerical stability
  // (handles quasi-separable data without the Hessian going singular).
  const ridge = 1e-8;
  let beta = new Array(p).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const eta = design.map((row) => row.reduce((s, x, j) => s + x * beta[j], 0));
    const pi = eta.map(sigmoid);
    const W = eta.map((_, i) => Math.max(pi[i] * (1 - pi[i]), 1e-12));
    const grad = new Array(p).fill(0);
    const Hmat: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < p; j++) {
        grad[j] += design[i][j] * (y[i] - pi[i]);
        for (let k = 0; k < p; k++) Hmat[j][k] += design[i][j] * design[i][k] * W[i];
      }
    }
    for (let j = 0; j < p; j++) Hmat[j][j] += ridge;
    let step: number[];
    try {
      const Hinv = inverse(Hmat);
      step = multiply(Hinv, grad.map((g) => [g])).map((r) => r[0]);
    } catch {
      break;
    }
    let maxDelta = 0;
    for (let j = 0; j < p; j++) {
      const s = Math.max(-8, Math.min(8, step[j]));
      beta[j] += s;
      maxDelta = Math.max(maxDelta, Math.abs(s));
    }
    if (maxDelta < 1e-8) break;
  }

  const eta = design.map((row) => row.reduce((s, x, j) => s + x * beta[j], 0));
  const pi = eta.map(sigmoid);
  const llFull = llBinomial(y, pi);

  const W = eta.map((_, i) => Math.max(pi[i] * (1 - pi[i]), 1e-12));
  const Hmat: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k < p; k++) Hmat[j][k] += design[i][j] * design[i][k] * W[i];
  for (let j = 0; j < p; j++) Hmat[j][j] += ridge;
  let cov: number[][];
  try {
    cov = inverse(Hmat);
  } catch {
    cov = Array.from({ length: p }, () => new Array(p).fill(0));
  }

  const coefficients = labels.map((name, j) => {
    const se = Math.sqrt(Math.max(cov[j][j], 0));
    const wald = se > 0 ? (beta[j] * beta[j]) / (se * se) : 0;
    const pval = 1 - chiSquareCdf(wald, 1);
    return {
      name,
      b: beta[j],
      se,
      wald,
      p: pval,
      oddsRatio: Math.exp(beta[j]),
    };
  });

  const modelChiSquare = 2 * (llFull - llNull);
  const df = p - (intercept ? 1 : 0);
  const modelP = 1 - chiSquareCdf(modelChiSquare, df);
  const mcfaddenR2 = llNull !== 0 ? 1 - llFull / llNull : 0;

  void logGamma;
  void logit;
  void alpha;

  return {
    coefficients,
    modelChiSquare,
    df,
    modelP,
    mcfaddenR2,
    n,
  };
}

export function runLogistic(dataset: Dataset, opts: LogisticOptions): AnalysisResult {
  const yRaw = dataset.numericColumn(opts.dependent);
  const cols = opts.independent.map((v) => dataset.numericColumn(v));
  const n = Math.min(yRaw.length, ...cols.map((c) => c.length));
  if (n < 2) throw new Error("Logistic regression needs at least 2 complete cases.");
  // Binarize dependent on the basis of its unique values.
  const values = [...new Set(yRaw.slice(0, n))].sort((a, b) => a - b);
  if (values.length !== 2) throw new Error("Dependent must be binary (two levels).");
  const y = yRaw.slice(0, n).map((v) => (v === values[1] ? 1 : 0));
  const res = logisticRegression(
    y,
    cols.map((c) => c.slice(0, n)),
    opts.independent,
    opts.intercept ?? true,
    opts.alpha ?? 0.05,
  );

  const coefTable = {
    title: "Variables in the Equation",
    columns: ["Predictor", "B", "S.E.", "Wald", "p", "Exp(B)"],
    rows: res.coefficients.map((c) => [
      c.name,
      round(c.b),
      round(c.se),
      round(c.wald),
      formatP(c.p),
      round(c.oddsRatio),
    ]),
  };
  const modelTable = {
    title: "Omnibus Tests of Model Coefficients",
    columns: ["χ²", "df", "p"],
    rows: [[round(res.modelChiSquare), res.df, formatP(res.modelP)]],
  };
  const summaryTable = {
    title: "Model Summary",
    columns: ["McFadden R²", "N"],
    rows: [[round(res.mcfaddenR2), res.n]],
  };

  return {
    type: "logistic",
    summary: `Model χ² = ${round(res.modelChiSquare)}, ${formatP(res.modelP)} — ${
      res.modelP < (opts.alpha ?? 0.05) ? "model significant" : "model not significant"
    }`,
    tables: [modelTable, summaryTable, coefTable],
    stats: {
      modelChiSquare: round(res.modelChiSquare),
      modelP: round(res.modelP),
      mcfaddenR2: round(res.mcfaddenR2),
      n: res.n,
    },
  };
}
