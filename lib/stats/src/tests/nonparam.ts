/**
 * Non-parametric tests (the workhorses of SPSS "Nonparametric Tests" / R
 * `wilcox.test`, `kruskal.test`, `friedman.test`).
 */
import { Dataset } from "../dataset";
import { normalCdf, chiSquareCdf } from "../mathx";
import { round, formatP } from "../describe";
import type { AnalysisResult, MannWhitneyOptions, WilcoxonOptions, KruskalWallisOptions, FriedmanOptions } from "../types";

interface RankResult {
  ranks: number[];
  tieCorrection: number; // Σ(t³ - t)
}

function rankWithTies(values: number[]): RankResult {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  let tieSum = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return { ranks, tieCorrection: tieSum };
}

function normalTwoTail(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export function runMannWhitney(dataset: Dataset, opts: MannWhitneyOptions): AnalysisResult {
  const groups = dataset.groupedNumeric(opts.dependent, opts.group);
  const keys = [...groups.keys()];
  if (keys.length !== 2) throw new Error("Mann-Whitney needs exactly two groups.");
  const aKey = opts.groupA !== undefined ? String(opts.groupA) : keys[0];
  const bKey = opts.groupB !== undefined ? String(opts.groupB) : keys[1];
  const a = groups.get(aKey) ?? [];
  const b = groups.get(bKey) ?? [];
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 1 || n2 < 1) throw new Error("Each group needs at least 1 value.");

  const pooled = [...a, ...b];
  const { ranks, tieCorrection } = rankWithTies(pooled);
  let r1 = 0;
  for (let i = 0; i < n1; i++) r1 += ranks[i];
  const r2 = (n1 + n2) * (n1 + n2 + 1) / 2 - r1;
  const u1 = n1 * n2 + (n1 * (n1 + 1)) / 2 - r1;
  const u2 = n1 * n2 - u1;
  const U = Math.min(u1, u2);
  const N = n1 + n2;
  const sigma2 = (n1 * n2 / (N * (N - 1))) * ((N * N * N - N) / 12 - tieCorrection / 12);
  const z = sigma2 > 0 ? (U - (n1 * n2) / 2 + 0.5) / Math.sqrt(sigma2) : 0;
  const p = normalTwoTail(z);

  return {
    type: "mannwhitney",
    summary: `Mann–Whitney U = ${round(U)}, ${formatP(p)} — ${p < (opts.alpha ?? 0.05) ? "significant" : "not significant"}`,
    tables: [
      {
        title: "Ranks",
        columns: ["Group", "N", "Mean Rank", "Sum of Ranks"],
        rows: [
          [aKey, n1, round(r1 / n1), round(r1)],
          [bKey, n2, round(r2 / n2), round(r2)],
        ],
      },
      {
        title: "Test Statistics",
        columns: ["U", "z", "p (two-sided)", "N"],
        rows: [[round(U), round(z), formatP(p), N]],
      },
    ],
    stats: { U: round(U), z: round(z), p: round(p), n1, n2 },
  };
}

export function runWilcoxon(dataset: Dataset, opts: WilcoxonOptions): AnalysisResult {
  const { x, y } = dataset.pairedNumeric(opts.pairedA, opts.pairedB);
  if (x.length < 1) throw new Error("Wilcoxon needs at least 1 complete pair.");
  const diffs = x.map((v, i) => v - y[i]).filter((d) => d !== 0);
  const n = diffs.length;
  if (n < 1) throw new Error("No non-zero differences to rank.");
  const { ranks: absRanks, tieCorrection } = rankWithTies(diffs.map(Math.abs));
  let wPlus = 0;
  for (let i = 0; i < n; i++) if (diffs[i] > 0) wPlus += absRanks[i];
  const meanW = (n * (n + 1)) / 4;
  const sigma2 = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  const z = sigma2 > 0 ? (wPlus - meanW) / Math.sqrt(sigma2) : 0;
  const p = normalTwoTail(z);

  return {
    type: "wilcoxon",
    summary: `Wilcoxon W⁺ = ${round(wPlus)}, ${formatP(p)} — ${p < (opts.alpha ?? 0.05) ? "significant" : "not significant"}`,
    tables: [
      {
        title: "Test Statistics",
        columns: ["W⁺", "z", "p (two-sided)", "N pairs"],
        rows: [[round(wPlus), round(z), formatP(p), n]],
      },
    ],
    stats: { W: round(wPlus), z: round(z), p: round(p), n },
  };
}

export function runKruskalWallis(dataset: Dataset, opts: KruskalWallisOptions): AnalysisResult {
  const groups = dataset.groupedNumeric(opts.dependent, opts.group);
  if (groups.size < 2) throw new Error("Kruskal–Wallis needs at least two groups.");
  const keys = [...groups.keys()];
  const all: number[] = [];
  const rjNs: number[] = [];
  groups.forEach((arr) => {
    all.push(...arr);
    rjNs.push(arr.length);
  });
  const { ranks: globalRanks, tieCorrection } = rankWithTies(all);

  // `all` is concatenated group-by-group, so ranks [0..n0) belong to group 0, etc.
  const rjSums: number[] = [];
  let offset = 0;
  for (let g = 0; g < rjNs.length; g++) {
    let s = 0;
    for (let i = 0; i < rjNs[g]; i++) s += globalRanks[offset + i];
    rjSums.push(s);
    offset += rjNs[g];
  }

  const N = all.length;
  let H = (12 / (N * (N + 1))) * rjSums.reduce((s, rj, i) => s + (rj * rj) / rjNs[i], 0) - 3 * (N + 1);
  if (tieCorrection > 0) H = H / (1 - tieCorrection / (N * N * N - N));
  const df = groups.size - 1;
  const p = 1 - chiSquareCdf(H, df);

  return {
    type: "kruskalwallis",
    summary: `Kruskal–Wallis H = ${round(H)}, ${formatP(p)} — ${p < (opts.alpha ?? 0.05) ? "significant" : "not significant"}`,
    tables: [
      {
        title: "Ranks",
        columns: ["Group", "N", "Mean Rank"],
        rows: keys.map((k, i) => [k, rjNs[i], round(rjSums[i] / rjNs[i])]),
      },
      {
        title: "Test Statistics",
        columns: ["H", "df", "p"],
        rows: [[round(H), df, formatP(p)]],
      },
    ],
    stats: { H: round(H), df, p: round(p) },
  };
}

export function runFriedman(dataset: Dataset, opts: FriedmanOptions): AnalysisResult {
  const cols = opts.variables;
  if (cols.length < 2) throw new Error("Friedman needs at least two related variables.");
  const data = cols.map((c) => dataset.numericColumn(c));
  const b = Math.min(...data.map((c) => c.length));
  const k = cols.length;
  if (b < 2) throw new Error("Friedman needs at least two blocks (rows).");

  const rankSums = new Array(k).fill(0);
  let tieSum = 0;
  for (let i = 0; i < b; i++) {
    const row = data.map((c) => c[i]);
    const { ranks, tieCorrection } = rankWithTies(row);
    for (let j = 0; j < k; j++) rankSums[j] += ranks[j];
    tieSum += tieCorrection;
  }
  const sumRj2 = rankSums.reduce((s, r) => s + r * r, 0);
  let chi2 = (12 / (b * k * (k + 1))) * sumRj2 - 3 * b * (k + 1);
  if (tieSum > 0) {
    const denom = 1 - tieSum / (b * (k * k * k - k));
    if (denom > 0) chi2 = chi2 / denom;
  }
  const df = k - 1;
  const p = 1 - chiSquareCdf(chi2, df);

  return {
    type: "friedman",
    summary: `Friedman χ² = ${round(chi2)}, ${formatP(p)} — ${p < (opts.alpha ?? 0.05) ? "significant" : "not significant"}`,
    tables: [
      {
        title: "Ranks",
        columns: ["Variable", "Mean Rank"],
        rows: cols.map((c, j) => [c, round(rankSums[j] / b)]),
      },
      {
        title: "Test Statistics",
        columns: ["χ²", "df", "p"],
        rows: [[round(chi2), df, formatP(p)]],
      },
    ],
    stats: { chi2: round(chi2), df, p: round(p) },
  };
}
