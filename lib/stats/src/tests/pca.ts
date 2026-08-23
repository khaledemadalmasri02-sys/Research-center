/**
 * Principal Component Analysis with optional Varimax rotation, the SPSS
 * "Factor" / R `prcomp` output. Inputs are standardized to unit variance.
 */
import { Dataset } from "../dataset";
import { round } from "../describe";
import { jacobiEigen, varimax, type Matrix } from "../linalg";
import type { AnalysisResult, PcaOptions } from "../types";

function correlationMatrix(cols: number[][]): Matrix {
  const k = cols.length;
  const means = cols.map((c) => c.reduce((a, b) => a + b, 0) / (c.length || 1));
  const sds = cols.map((c, i) => {
    const v = c.reduce((a, x) => a + (x - means[i]) ** 2, 0) / (c.length - 1);
    return Math.sqrt(v);
  });
  const R: Matrix = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let cov = 0;
      for (let r = 0; r < cols[i].length; r++)
        cov += (cols[i][r] - means[i]) * (cols[j][r] - means[j]);
      cov /= cols[i].length - 1;
      const r = sds[i] > 0 && sds[j] > 0 ? cov / (sds[i] * sds[j]) : i === j ? 1 : 0;
      R[i][j] = r;
      R[j][i] = r;
    }
  }
  return R;
}

export function pca(cols: number[][], names: string[], rotation: "none" | "varimax" = "none", components?: number): {
  eigenvalues: number[];
  proportion: number[];
  cumulative: number[];
  loadings: Matrix;
  n: number;
} {
  const R = correlationMatrix(cols);
  const { values, vectors } = jacobiEigen(R);
  const n = cols[0]?.length ?? 0;
  const totalVar = values.reduce((a, b) => a + b, 0) || 1;
  const proportion = values.map((v) => v / totalVar);
  const cumulative = proportion.map((_, i) => proportion.slice(0, i + 1).reduce((a, b) => a + b, 0));

  const nc = components && components > 0 ? Math.min(components, values.length) : values.length;
  // Loadings = eigenvector * sqrt(eigenvalue).
  const loadings: Matrix = vectors.map((row) =>
    row.map((e, j) => (j < nc ? e * Math.sqrt(Math.max(values[j], 0)) : 0)),
  );
  let finalLoadings = loadings;
  if (rotation === "varimax") finalLoadings = varimax(loadings.map((row) => row.slice(0, nc)));

  return {
    eigenvalues: values.slice(0, nc),
    proportion: proportion.slice(0, nc),
    cumulative: cumulative.slice(0, nc),
    loadings: finalLoadings,
    n,
  };
}

export function runPca(dataset: Dataset, opts: PcaOptions): AnalysisResult {
  const cols = opts.variables.map((v) => dataset.numericColumn(v));
  if (cols.length < 2) throw new Error("PCA needs at least two variables.");
  const n = Math.min(...cols.map((c) => c.length));
  const trimmed = cols.map((c) => c.slice(0, n));
  const res = pca(trimmed, opts.variables, opts.rotation ?? "none", opts.components);

  const compCount = res.eigenvalues.length;
  const screeTable = {
    title: "Total Variance Explained",
    columns: ["Component", "Eigenvalue", "% Variance", "Cumulative %"],
    rows: Array.from({ length: compCount }, (_, j) => [
      `PC${j + 1}`,
      round(res.eigenvalues[j]),
      round(res.proportion[j] * 100),
      round(res.cumulative[j] * 100),
    ]),
  };
  const loadingTable = {
    title: `Component Matrix${opts.rotation === "varimax" ? " (Varimax)" : ""}`,
    columns: ["Variable", ...Array.from({ length: compCount }, (_, j) => `PC${j + 1}`)],
    rows: opts.variables.map((v, i) =>
      [v, ...res.loadings[i].slice(0, compCount).map((l) => round(l))],
    ),
  };

  const componentsKept = res.eigenvalues.filter((e) => e > 1).length;
  return {
    type: "pca",
    summary: `${compCount} components extracted; ${componentsKept} with eigenvalue > 1.`,
    tables: [screeTable, loadingTable],
    stats: {
      components: compCount,
      eigenvaluesGt1: componentsKept,
      cumulativeVariance: round(res.cumulative[compCount - 1] * 100),
      n: res.n,
    },
  };
}
