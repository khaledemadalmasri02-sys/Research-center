import { Dataset } from "./dataset";
import type {
  AnalysisResult,
  AnalysisType,
  AnalysisOptions,
  TabularData,
  DescriptiveOptions,
  TTestOptions,
  AnovaOptions,
  ChiSquareOptions,
  CorrelationOptions,
  RegressionOptions,
  NormalityOptions,
  MannWhitneyOptions,
  WilcoxonOptions,
  KruskalWallisOptions,
  FriedmanOptions,
  LogisticOptions,
  ReliabilityOptions,
  PcaOptions,
} from "./types";
import { descriptive } from "./describe";
import { runTTest } from "./tests/ttest";
import { runAnova } from "./tests/anova";
import { runChiSquare } from "./tests/chisquare";
import { runCorrelation } from "./tests/correlation";
import { runRegression } from "./tests/regression";
import { runNormality } from "./tests/normality";
import { runMannWhitney, runWilcoxon, runKruskalWallis, runFriedman } from "./tests/nonparam";
import { runLogistic } from "./tests/logistic";
import { runReliability } from "./tests/reliability";
import { runPca } from "./tests/pca";
import * as charts from "./charts";

export * from "./types";
export * from "./mathx";
export { Dataset, isMissing, inferDataType, inferMeasure, toSavSpec } from "./dataset";
export { describeNumeric, round, formatP } from "./describe";
export { independentTTest, pairedTTest } from "./tests/ttest";
export { oneWayAnova } from "./tests/anova";
export { chiSquareTest } from "./tests/chisquare";
export { correlation } from "./tests/correlation";
export { olsRegression } from "./tests/regression";
export { logisticRegression } from "./tests/logistic";
export { cronbachAlpha } from "./tests/reliability";
export { pca } from "./tests/pca";
export { cohensD, anovaEffect, cramersV, phiCoefficient, correlationCI } from "./effects";
export { dagostinoPearson } from "./tests/normality";
export { histogram, boxplotStats, scatterPoints, barData, variableHistogram, groupedBoxStats, correlationMatrixData } from "./charts";
export const chartBuilders = charts;
export * as io from "./io";

/** Run a single analysis given a prepared dataset and typed options. */
export function runAnalysis(
  dataset: Dataset,
  type: AnalysisType,
  options: AnalysisOptions,
): AnalysisResult {
  switch (type) {
    case "descriptive": {
      const { variable } = options as DescriptiveOptions;
      return buildDescriptive(dataset, variable);
    }
    case "ttest":
      return runTTest(dataset, options as TTestOptions);
    case "anova":
      return runAnova(dataset, options as AnovaOptions);
    case "chisquare":
      return runChiSquare(dataset, options as ChiSquareOptions);
    case "correlation":
      return runCorrelation(dataset, options as CorrelationOptions);
    case "regression":
      return runRegression(dataset, options as RegressionOptions);
    case "normality":
      return runNormality(dataset, options as NormalityOptions);
    case "mannwhitney":
      return runMannWhitney(dataset, options as MannWhitneyOptions);
    case "wilcoxon":
      return runWilcoxon(dataset, options as WilcoxonOptions);
    case "kruskalwallis":
      return runKruskalWallis(dataset, options as KruskalWallisOptions);
    case "friedman":
      return runFriedman(dataset, options as FriedmanOptions);
    case "logistic":
      return runLogistic(dataset, options as LogisticOptions);
    case "reliability":
      return runReliability(dataset, options as ReliabilityOptions);
    case "pca":
      return runPca(dataset, options as PcaOptions);
    default:
      throw new Error(`Unknown analysis type: ${type}`);
  }
}

// `descriptive` returns { stats, table } rather than AnalysisResult; wrap it.
function buildDescriptive(dataset: Dataset, variable: string): AnalysisResult {
  const { stats, table, frequencies } = descriptive(dataset, variable);
  return {
    type: "descriptive",
    tables: frequencies ? [table, frequencies] : [table],
    stats,
  };
}
