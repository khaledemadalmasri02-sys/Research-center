// Catalog of analysis types and the helpers that build the form options
// for each. Keeping these in one file makes it easy to add a new
// analysis: add to ANALYSIS_TYPES, defaultOpts, buildOptions, and
// assignVariable below.

import type { AnalysisOptions } from "./types";

export const ANALYSIS_TYPES = [
  { value: "descriptive", label: "Descriptive" },
  { value: "ttest", label: "T-Test" },
  { value: "anova", label: "ANOVA" },
  { value: "chisquare", label: "Chi-Square" },
  { value: "correlation", label: "Correlation" },
  { value: "regression", label: "Linear Regression" },
  { value: "normality", label: "Normality" },
  { value: "mannwhitney", label: "Mann–Whitney U" },
  { value: "wilcoxon", label: "Wilcoxon" },
  { value: "kruskalwallis", label: "Kruskal–Wallis" },
  { value: "friedman", label: "Friedman" },
  { value: "logistic", label: "Logistic Regression" },
  { value: "reliability", label: "Reliability (α)" },
  { value: "pca", label: "PCA / Factor" },
] as const;

export type AnalysisTypeValue = (typeof ANALYSIS_TYPES)[number]["value"];

export function defaultOpts(type: string): Record<string, unknown> {
  switch (type) {
    case "ttest":
      return { mode: "independent", equalVariance: true, alpha: 0.05 };
    case "anova":
      return { alpha: 0.05 };
    case "chisquare":
      return { alpha: 0.05 };
    case "correlation":
      return { method: "pearson", variables: [], alpha: 0.05 };
    case "regression":
      return { independent: [], intercept: true, alpha: 0.05 };
    case "normality":
      return { variables: [], alpha: 0.05 };
    case "mannwhitney":
      return { dependent: undefined, group: undefined, groupA: undefined, groupB: undefined, alpha: 0.05 };
    case "wilcoxon":
      return { pairedA: undefined, pairedB: undefined, alpha: 0.05 };
    case "kruskalwallis":
      return { dependent: undefined, group: undefined, alpha: 0.05 };
    case "friedman":
      return { variables: [] };
    case "logistic":
      return { dependent: undefined, independent: [], intercept: true, alpha: 0.05 };
    case "reliability":
      return { variables: [] };
    case "pca":
      return { variables: [], components: 0, rotation: "none" };
    default:
      return {};
  }
}

/**
 * Build the API-bound options object for an analysis run. This is the
 * single place that knows the wire shape per type; the form only
 * edits loose `opts` state.
 */
export function buildOptions(
  analysisType: string,
  opts: AnalysisOptions,
): AnalysisOptions {
  const o: Record<string, unknown> = {};
  switch (analysisType) {
    case "descriptive":
      o.variable = opts.variable;
      break;
    case "ttest":
      o.mode = opts.mode;
      o.equalVariance = opts.equalVariance;
      o.alpha = Number(opts.alpha) || 0.05;
      if (opts.mode === "paired") {
        o.pairedA = opts.pairedA;
        o.pairedB = opts.pairedB;
      } else {
        o.dependent = opts.dependent;
        o.groupVariable = opts.groupVariable;
        o.groupA = opts.groupA;
        o.groupB = opts.groupB;
      }
      break;
    case "anova":
      o.dependent = opts.dependent;
      o.group = opts.group;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "chisquare":
      o.row = opts.row;
      o.column = opts.column;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "correlation":
      o.method = opts.method;
      o.variables = opts.variables ?? [];
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "regression":
      o.dependent = opts.dependent;
      o.independent = opts.independent ?? [];
      o.intercept = opts.intercept;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "normality":
      o.variables = opts.variables ?? [];
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "mannwhitney":
      o.dependent = opts.dependent;
      o.group = opts.group;
      o.groupA = opts.groupA;
      o.groupB = opts.groupB;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "wilcoxon":
      o.pairedA = opts.pairedA;
      o.pairedB = opts.pairedB;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "kruskalwallis":
      o.dependent = opts.dependent;
      o.group = opts.group;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "friedman":
      o.variables = opts.variables ?? [];
      break;
    case "logistic":
      o.dependent = opts.dependent;
      o.independent = opts.independent ?? [];
      o.intercept = opts.intercept;
      o.alpha = Number(opts.alpha) || 0.05;
      break;
    case "reliability":
      o.variables = opts.variables ?? [];
      break;
    case "pca":
      o.variables = opts.variables ?? [];
      o.components = Number(opts.components) || undefined;
      o.rotation = opts.rotation;
      break;
  }
  return o;
}

const has = (x: unknown) => x !== undefined && x !== "";

function toggle(list: string[] | undefined, name: string): string[] {
  const cur = list ?? [];
  return cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
}

/**
 * Click a variable in the palette to assign it to the next relevant
 * field for the current analysis type. Returns the new options bag.
 */
export function assignVariable(
  analysisType: string,
  prevOpts: AnalysisOptions,
  vname: string,
): AnalysisOptions {
  const p: Record<string, unknown> = { ...prevOpts };
  switch (analysisType) {
    case "descriptive":
      p.variable = vname;
      break;
    case "normality":
    case "reliability":
    case "friedman":
    case "pca":
    case "correlation":
      p.variables = toggle(p.variables as string[] | undefined, vname);
      break;
    case "regression":
    case "logistic": {
      if (!has(p.dependent)) p.dependent = vname;
      else p.independent = toggle(p.independent as string[] | undefined, vname);
      break;
    }
    case "ttest":
      if (p.mode === "paired") {
        if (!has(p.pairedA)) p.pairedA = vname;
        else if (!has(p.pairedB)) p.pairedB = vname;
      } else {
        if (!has(p.dependent)) p.dependent = vname;
        else if (!has(p.groupVariable)) p.groupVariable = vname;
      }
      break;
    case "anova":
    case "kruskalwallis":
    case "mannwhitney":
      if (!has(p.dependent)) p.dependent = vname;
      else if (!has(p.group)) p.group = vname;
      break;
    case "wilcoxon":
      if (!has(p.pairedA)) p.pairedA = vname;
      else if (!has(p.pairedB)) p.pairedB = vname;
      break;
    case "chisquare":
      if (!has(p.row)) p.row = vname;
      else if (!has(p.column)) p.column = vname;
      break;
  }
  return p;
}
