import { studentTCdf, fCdf } from "../mathx";
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import { multiply, transpose, inverse } from "../linalg";
import type { AnalysisResult, RegressionOptions } from "../types";

export interface RegressionResult {
  coefficients: { name: string; beta: number; se: number; t: number; p: number }[];
  rSquared: number;
  adjustedRSquared: number;
  f: number;
  fP: number;
  n: number;
  dfRegression: number;
  dfError: number;
}

export function olsRegression(
  y: number[],
  Xcols: number[][],
  names: string[],
  intercept = true,
  alpha = 0.05,
): RegressionResult {
  const n = y.length;
  const design: number[][] = intercept
    ? y.map((_, r) => [1, ...Xcols.map((c) => c[r])])
    : y.map((_, r) => Xcols.map((c) => c[r]));
  const labels = intercept ? ["(Intercept)", ...names] : [...names];
  const p = design[0].length;

  const X = design;
  const Xt = transpose(X);
  const XtX = multiply(Xt, X);
  const XtXInv = inverse(XtX);
  const XtY = multiply(Xt, y.map((v) => [v]));
  const betaCol = multiply(XtXInv, XtY).map((r) => r[0]);
  const yHat = multiply(X, betaCol.map((b) => [b])).map((r) => r[0]);
  const resid = y.map((v, i) => v - yHat[i]);

  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const sst = y.reduce((a, v) => a + (v - yMean) ** 2, 0);
  const sse = resid.reduce((a, v) => a + v * v, 0);
  const ssr = sst - sse;
  const dfR = p - (intercept ? 1 : 0);
  const dfE = n - p;
  const mse = sse / dfE;
  const rSquared = sst > 0 ? ssr / sst : 0;
  const adjustedRSquared = 1 - (1 - rSquared) * ((n - 1) / (n - p));
  const F = dfR > 0 ? (ssr / dfR) / mse : NaN;
  const fP = dfR > 0 ? 1 - fCdf(F, dfR, dfE) : NaN;

  const coefficients = labels.map((name, j) => {
    const se = Math.sqrt(Math.max(mse * XtXInv[j][j], 0));
    const t = se > 0 ? betaCol[j] / se : NaN;
    const pval = Number.isFinite(t) ? 2 * (1 - studentTCdf(Math.abs(t), dfE)) : NaN;
    return { name, beta: betaCol[j], se, t, p: pval };
  });

  void alpha;
  return { coefficients, rSquared, adjustedRSquared, f: F, fP, n, dfRegression: dfR, dfError: dfE };
}

export function runRegression(dataset: Dataset, opts: RegressionOptions): AnalysisResult {
  const y = dataset.numericColumn(opts.dependent);
  const cols = opts.independent.map((v) => dataset.numericColumn(v));
  const n = Math.min(y.length, ...cols.map((c) => c.length));
  if (n < 3) throw new Error("Regression needs at least 3 complete cases.");
  const res = olsRegression(
    y.slice(0, n),
    cols.map((c) => c.slice(0, n)),
    opts.independent,
    opts.intercept ?? true,
    opts.alpha ?? 0.05,
  );

  const coefTable = {
    title: "Coefficients",
    columns: ["Predictor", "B", "Std. Error", "t", "p"],
    rows: res.coefficients.map((c) => [
      c.name,
      round(c.beta),
      round(c.se),
      round(c.t),
      formatP(c.p),
    ]),
  };

  const modelTable = {
    title: "Model summary",
    columns: ["R²", "Adjusted R²", "F", "df", "p", "N"],
    rows: [
      [
        round(res.rSquared),
        round(res.adjustedRSquared),
        round(res.f),
        `${res.dfRegression}, ${res.dfError}`,
        formatP(res.fP),
        res.n,
      ],
    ],
  };

  return {
    type: "regression",
    summary: `R² = ${round(res.rSquared)}, ${formatP(res.fP)} — ${
      res.fP < (opts.alpha ?? 0.05) ? "model significant" : "model not significant"
    }`,
    tables: [modelTable, coefTable],
    stats: {
      rSquared: round(res.rSquared),
      adjustedRSquared: round(res.adjustedRSquared),
      f: round(res.f),
      fP: round(res.fP),
      n: res.n,
    },
  };
}
