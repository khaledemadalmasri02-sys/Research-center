import { chiSquareCdf } from "../mathx";
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import type { AnalysisResult, ChiSquareOptions } from "../types";

export function chiSquareTest(
  observed: number[][],
  alpha = 0.05,
): AnalysisResult {
  const r = observed.length;
  const c = observed[0]?.length ?? 0;
  if (r < 2 || c < 2) throw new Error("Chi-square needs a 2x2 or larger table.");

  const rowTotals = observed.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = observed[0].map((_, j) => observed.reduce((a, row) => a + row[j], 0));
  const N = rowTotals.reduce((a, b) => a + b, 0);
  if (N === 0) throw new Error("Table is empty.");

  let chiSq = 0;
  const expected: number[][] = [];
  for (let i = 0; i < r; i++) {
    expected[i] = [];
    for (let j = 0; j < c; j++) {
      const e = (rowTotals[i] * colTotals[j]) / N;
      expected[i][j] = e;
      if (e > 0) chiSq += (observed[i][j] - e) ** 2 / e;
    }
  }
  const df = (r - 1) * (c - 1);
  const p = 1 - chiSquareCdf(chiSq, df);
  const cramersV = Math.sqrt(chiSq / (N * Math.min(r - 1, c - 1)));

  const table = {
    title: "Chi-square — Observed (Expected)",
    columns: [...colTotals.map((_, j) => `Col ${j + 1}`), "Total"],
    rows: observed.map((row, i) => [
      ...row.map((o, j) => `${o} (${round(expected[i][j], 1)})`),
      rowTotals[i],
    ]),
  };

  return {
    type: "chisquare",
    summary: `χ²(${df}) = ${round(chiSq)}, ${formatP(p)} — ${
      p < alpha ? "significant" : "not significant"
    } (α=${alpha})`,
    tables: [table],
    stats: {
      chiSquare: round(chiSq),
      df,
      p: round(p),
      cramersV: round(cramersV),
      n: N,
    },
  };
}

export function runChiSquare(dataset: Dataset, opts: ChiSquareOptions): AnalysisResult {
  const rowCol = dataset.column(opts.row);
  const colCol = dataset.column(opts.column);
  const rowMiss = dataset.meta(opts.row)?.missingValues;
  const colMiss = dataset.meta(opts.column)?.missingValues;
  const rowKeys: string[] = [];
  const colKeys: string[] = [];
  const map = new Map<string, number>();
  for (let i = 0; i < rowCol.length; i++) {
    if (rowCol[i] === null || colCol[i] === null) continue;
    if (rowMiss?.some((m) => String(m) === String(rowCol[i]))) continue;
    if (colMiss?.some((m) => String(m) === String(colCol[i]))) continue;
    const rk = String(rowCol[i]);
    const ck = String(colCol[i]);
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    const key = `${rk}||${ck}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const observed = rowKeys.map((rk) =>
    colKeys.map((ck) => map.get(`${rk}||${ck}`) ?? 0),
  );
  return chiSquareTest(observed, opts.alpha ?? 0.05);
}
