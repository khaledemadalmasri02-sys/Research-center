import { studentTCdf, studentTInv } from "../mathx";
import { Dataset } from "../dataset";
import { round, formatP } from "../describe";
import { cohensD } from "../effects";
import type { AnalysisResult, TTestOptions } from "../types";

export interface GroupSummary {
  label: string;
  n: number;
  mean: number;
  stdDev: number;
  stdError: number;
}

function groupSummary(label: string, xs: number[]): GroupSummary {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(v);
  return { label, n, mean, stdDev: sd, stdError: sd / Math.sqrt(n) };
}

export function independentTTest(
  a: number[],
  b: number[],
  equalVariance = false,
  alpha = 0.05,
): AnalysisResult {
  const ga = groupSummary("Group A", a);
  const gb = groupSummary("Group B", b);
  const n1 = a.length;
  const n2 = b.length;
  let t: number;
  let df: number;
  let se: number;
  const diff = ga.mean - gb.mean;

  if (equalVariance) {
    const sp = Math.sqrt(
      ((n1 - 1) * ga.stdDev ** 2 + (n2 - 1) * gb.stdDev ** 2) / (n1 + n2 - 2),
    );
    se = sp * Math.sqrt(1 / n1 + 1 / n2);
    t = diff / se;
    df = n1 + n2 - 2;
  } else {
    const sa = ga.stdDev ** 2 / n1;
    const sb = gb.stdDev ** 2 / n2;
    se = Math.sqrt(sa + sb);
    t = diff / se;
    df = (sa + sb) ** 2 / (sa ** 2 / (n1 - 1) + sb ** 2 / (n2 - 1));
  }

  const pTwo = 2 * (1 - studentTCdf(Math.abs(t), df));
  const tCrit = studentTInv(1 - alpha / 2, df);
  const ciLow = diff - tCrit * se;
  const ciHigh = diff + tCrit * se;
  const d = cohensD(a, b, alpha);

  const tables = [
    {
      title: "Group statistics",
      columns: ["Group", "N", "Mean", "Std. Dev.", "Std. Error"],
      rows: [
        [ga.label, ga.n, round(ga.mean), round(ga.stdDev), round(ga.stdError)],
        [gb.label, gb.n, round(gb.mean), round(gb.stdDev), round(gb.stdError)],
      ],
    },
    {
      title: "Independent Samples Test",
      columns: [
        "t",
        "df",
        "p (two-sided)",
        "Mean Diff",
        `CI ${round(alpha * 100)}% Low`,
        `CI ${round(alpha * 100)}% High`,
      ],
      rows: [[round(t), round(df), formatP(pTwo), round(diff), round(ciLow), round(ciHigh)]],
    },
  ];

  return {
    type: "ttest",
    summary: `${formatP(pTwo)} — ${pTwo < alpha ? "significant" : "not significant"} (α=${alpha})`,
    tables,
    stats: {
      t: round(t),
      df: round(df),
      p: round(pTwo),
      meanDifference: round(diff),
      ciLow: round(ciLow),
      ciHigh: round(ciHigh),
      cohensD: d.estimate,
      cohensDCI: `${d.ciLow} – ${d.ciHigh}`,
      method: equalVariance ? "Student (pooled)" : "Welch",
    },
  };
}

export function pairedTTest(a: number[], b: number[], alpha = 0.05): AnalysisResult {
  const n = Math.min(a.length, b.length);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push(a[i] - b[i]);
  const meanD = diffs.reduce((x, y) => x + y, 0) / n;
  const sdD = Math.sqrt(diffs.reduce((x, y) => x + (y - meanD) ** 2, 0) / (n - 1));
  const seD = sdD / Math.sqrt(n);
  const t = meanD / seD;
  const df = n - 1;
  const pTwo = 2 * (1 - studentTCdf(Math.abs(t), df));
  const tCrit = studentTInv(1 - alpha / 2, df);
  const ciLow = meanD - tCrit * seD;
  const ciHigh = meanD + tCrit * seD;

  const tables = [
    {
      title: "Paired Samples Test",
      columns: [
        "Mean Diff",
        "Std. Dev.",
        "Std. Error",
        "t",
        "df",
        "p (two-sided)",
        `CI ${round(alpha * 100)}% Low`,
        `CI ${round(alpha * 100)}% High`,
      ],
      rows: [
        [
          round(meanD),
          round(sdD),
          round(seD),
          round(t),
          df,
          formatP(pTwo),
          round(ciLow),
          round(ciHigh),
        ],
      ],
    },
  ];

  return {
    type: "ttest",
    summary: `${formatP(pTwo)} — ${pTwo < alpha ? "significant" : "not significant"} (α=${alpha})`,
    tables,
    stats: {
      t: round(t),
      df,
      p: round(pTwo),
      meanDifference: round(meanD),
      ciLow: round(ciLow),
      ciHigh: round(ciHigh),
      method: "Paired",
    },
  };
}

export function runTTest(dataset: Dataset, opts: TTestOptions): AnalysisResult {
  if (opts.mode === "paired") {
    const { x, y } = dataset.pairedNumeric(
      opts.pairedA ?? opts.variableA!,
      opts.pairedB ?? opts.variableB!,
    );
    return pairedTTest(x, y, opts.alpha ?? 0.05);
  }
  let a: number[];
  let b: number[];
  if (opts.groupVariable) {
    const dep = opts.dependent ?? opts.variableA!;
    const groups = dataset.groupedNumeric(dep, opts.groupVariable);
    const keys = [...groups.keys()];
    if (keys.length !== 2) {
      throw new Error("Independent t-test requires exactly two groups.");
    }
    const aKey = opts.groupA !== undefined ? String(opts.groupA) : keys[0];
    const bKey = opts.groupB !== undefined ? String(opts.groupB) : keys[1];
    a = groups.get(aKey) ?? [];
    b = groups.get(bKey) ?? [];
  } else {
    a = dataset.numericColumn(opts.variableA!);
    b = dataset.numericColumn(opts.variableB!);
  }
  if (a.length < 2 || b.length < 2) {
    throw new Error("Each group needs at least 2 non-missing values.");
  }
  return independentTTest(a, b, opts.equalVariance ?? false, opts.alpha ?? 0.05);
}
