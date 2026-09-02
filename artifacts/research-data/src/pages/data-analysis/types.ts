// Shared types for the data-analysis page.

import type { AnalysisResult } from "@/lib/stats-types";

export type Cell = number | string | null;

export interface AnalysisVariable {
  name: string;
  label?: string | null;
  dataType: string;
  measure: string;
  missingValues?: (string | number)[] | null;
  valueLabels?: Record<string, string> | null;
}

export interface DatasetSummary {
  id: number;
  name: string;
  source: string;
  format: string;
  rowCount: number;
  createdAt?: string;
}

export interface DatasetDetail {
  dataset: DatasetSummary;
  variables: AnalysisVariable[];
  preview: Cell[][];
}

// The api-server returns the full AnalysisResult plus an `id` for
// export-by-id. We re-export AnalysisResult from lib/stats-types so
// the row shape stays in lock-step with the engine.
export type AnalysisResultFull = AnalysisResult & { id: number };

// Analysis-type options bag. Per-type fields are typed loosely because the
// shared form-builder passes them through. The api-server's Zod schemas
// narrow them on the way in.
export type AnalysisOptions = Record<string, unknown>;

export interface VarSelectProps {
  label: string;
  vars: AnalysisVariable[];
  value?: string;
  onChange: (v: string) => void;
}

export interface VariableMultiSelectProps {
  label: string;
  vars: AnalysisVariable[];
  selected: string[];
  onToggle: (n: string) => void;
}

