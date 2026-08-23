/** Local type mirrors for the statistics engine result shapes used by the UI.
 *  Kept here so the frontend does not need to compile the engine's source. */

export interface ResultTable {
  title?: string;
  columns: string[];
  rows: (number | string | null)[][];
}

export interface AnalysisResult {
  type: string;
  summary?: string;
  tables: ResultTable[];
  stats: Record<string, number | string | null | Record<string, number | string>>;
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  iqr: number;
  outliers: number[];
}
