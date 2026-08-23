/** Shared domain types for the statistics engine and dataset I/O. */

export type DataType = "numeric" | "string" | "date";
export type MeasureLevel = "scale" | "ordinal" | "nominal";

/** A single cell. `null` represents a missing/user-missing value. */
export type Cell = number | string | null;

export interface VariableMeta {
  name: string;
  label?: string | null;
  dataType: DataType;
  measure: MeasureLevel;
  /** Values (numeric or string) treated as missing. */
  missingValues?: Cell[];
  /** Map of coded value -> human label (SPSS value labels). */
  valueLabels?: Record<string, string>;
}

export interface TabularData {
  variables: VariableMeta[];
  /** Row-major cells aligned to `variables`. */
  rows: Cell[][];
}

/** Result tables are generic row/column structures the UI can render. */
export interface ResultTable {
  title?: string;
  columns: string[];
  rows: (number | string | null)[][];
}

export interface AnalysisResult {
  type: AnalysisType;
  /** Human-readable headline (e.g. "p < 0.001 — significant"). */
  summary?: string;
  tables: ResultTable[];
  /** Key/value statistics for compact display (e.g. F, p, R²). */
  stats: Record<string, number | string | null | Record<string, number | string>>;
}

export type AnalysisType =
  | "descriptive"
  | "ttest"
  | "anova"
  | "chisquare"
  | "correlation"
  | "regression"
  | "normality"
  | "mannwhitney"
  | "wilcoxon"
  | "kruskalwallis"
  | "friedman"
  | "logistic"
  | "reliability"
  | "pca";

export interface DescriptiveOptions {
  variable: string;
}

export interface TTestOptions {
  mode: "independent" | "paired";
  /** Independent: a grouping variable with exactly two levels. */
  groupVariable?: string;
  groupA?: string | number;
  groupB?: string | number;
  /** Independent (grouped): the scale dependent variable. */
  dependent?: string;
  /** Independent: two variables to compare directly (no grouping). */
  variableA?: string;
  variableB?: string;
  /** Paired: two variables measured on the same cases. */
  pairedA?: string;
  pairedB?: string;
  equalVariance?: boolean;
  alpha?: number;
}

export interface AnovaOptions {
  /** Dependent scale variable. */
  dependent: string;
  /** Grouping nominal/ordinal variable. */
  group: string;
  alpha?: number;
}

export interface ChiSquareOptions {
  row: string;
  column: string;
  alpha?: number;
}

export interface CorrelationOptions {
  method: "pearson" | "spearman";
  variables: string[];
  alpha?: number;
}

export interface RegressionOptions {
  dependent: string;
  independent: string[];
  intercept?: boolean;
  alpha?: number;
}

export interface NormalityOptions {
  variables: string[];
  alpha?: number;
}

export interface MannWhitneyOptions {
  dependent: string;
  group: string;
  groupA?: string | number;
  groupB?: string | number;
  alpha?: number;
}

export interface WilcoxonOptions {
  pairedA: string;
  pairedB: string;
  alpha?: number;
}

export interface KruskalWallisOptions {
  dependent: string;
  group: string;
  alpha?: number;
}

export interface FriedmanOptions {
  variables: string[];
  alpha?: number;
}

export interface LogisticOptions {
  dependent: string;
  independent: string[];
  intercept?: boolean;
  alpha?: number;
}

export interface ReliabilityOptions {
  variables: string[];
}

export interface PcaOptions {
  variables: string[];
  components?: number;
  rotation?: "none" | "varimax";
}

export type AnalysisOptions =
  | DescriptiveOptions
  | TTestOptions
  | AnovaOptions
  | ChiSquareOptions
  | CorrelationOptions
  | RegressionOptions;
