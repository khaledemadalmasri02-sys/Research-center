import { fCdf } from "../mathx";
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import { anovaEffect } from "../effects";
import type { AnalysisResult, AnovaOptions } from "../types";

export function oneWayAnova(groups: Map<string, number[]>, alpha = 0.05): AnalysisResult {
  const entries = [...groups.entries()].filter(([, v]) => v.length > 0);
  const k = entries.length;
  if (k < 2) throw new Error("ANOVA requires at least two groups.");
  const N = entries.reduce((a, [, v]) => a + v.length, 0);
  if (N <= k) throw new Error("Not enough observations for ANOVA.");

  const grandMean =
    entries.reduce((a, [, v]) => a + v.reduce((x, y) => x + y, 0), 0) / N;

  const groupStats = entries.map(([label, v]) => {
    const n = v.length;
    const mean = v.reduce((x, y) => x + y, 0) / n;
    const ss = v.reduce((x, y) => x + (y - mean) ** 2, 0);
    return { label, n, mean, ss };
  });

  const ssa = groupStats.reduce((a, g) => a + g.n * (g.mean - grandMean) ** 2, 0);
  const sse = groupStats.reduce((a, g) => a + g.ss, 0);
  const sst = ssa + sse;
  const dfB = k - 1;
  const dfW = N - k;
  const msB = ssa / dfB;
  const mse = sse / dfW;
  const F = msB / mse;
  const p = 1 - fCdf(F, dfB, dfW);
  const etaSq = sst > 0 ? ssa / sst : 0;
  const { omegaSquared } = anovaEffect(ssa, sse, sst, k, N, dfW);

  const groupTable = {
    title: "ANOVA — Group statistics",
    columns: ["Group", "N", "Mean", "Std. Dev."],
    rows: groupStats.map((g) => [
      g.label,
      g.n,
      round(g.mean),
      round(Math.sqrt(g.ss / (g.n - 1))),
    ]),
  };

  const anovaTable = {
    title: "ANOVA",
    columns: ["Source", "SS", "df", "MS", "F", "p"],
    rows: [
      ["Between groups", round(ssa), dfB, round(msB), round(F), formatP(p)],
      ["Within groups", round(sse), dfW, round(mse), "", ""],
      ["Total", round(sst), N - 1, "", "", ""],
    ],
  };

  return {
    type: "anova",
    summary: `F(${dfB}, ${dfW}) = ${round(F)}, ${formatP(p)} — ${
      p < alpha ? "significant" : "not significant"
    } (α=${alpha})`,
    tables: [groupTable, anovaTable],
    stats: {
      F: round(F),
      dfBetween: dfB,
      dfWithin: dfW,
      p: round(p),
      etaSquared: round(etaSq),
      omegaSquared,
    },
  };
}

export function runAnova(dataset: Dataset, opts: AnovaOptions): AnalysisResult {
  const groups = dataset.groupedNumeric(opts.dependent, opts.group);
  return oneWayAnova(groups, opts.alpha ?? 0.05);
}
