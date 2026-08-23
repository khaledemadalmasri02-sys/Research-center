import type { Cell, TabularData, VariableMeta, DataType, MeasureLevel } from "./types";
import { ReadStatType, ReadStatMeasure } from "@irbisadm/statfmt";

function cellEquals(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  return String(a) === String(b);
}

export function isMissing(cell: Cell, missing?: Cell[]): boolean {
  if (cell === null) return true;
  if (missing && missing.length > 0) return missing.some((m) => cellEquals(cell, m));
  return false;
}

/** Build a Dataset helper around tabular data. */
export class Dataset {
  readonly variables: VariableMeta[];
  readonly rows: Cell[][];
  private index = new Map<string, number>();

  constructor(data: TabularData) {
    this.variables = data.variables;
    this.rows = data.rows;
    this.variables.forEach((v, i) => this.index.set(v.name, i));
  }

  get columnCount(): number {
    return this.variables.length;
  }

  get rowCount(): number {
    return this.rows.length;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  meta(name: string): VariableMeta | undefined {
    const i = this.index.get(name);
    return i === undefined ? undefined : this.variables[i];
  }

  /** Raw column cells (including missing). */
  column(name: string): Cell[] {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Unknown variable: ${name}`);
    return this.rows.map((r) => r[i]);
  }

  /** Numeric values for a column, missing excluded. */
  numericColumn(name: string): number[] {
    const m = this.meta(name);
    const miss = m?.missingValues;
    const out: number[] = [];
    for (const c of this.column(name)) {
      if (isMissing(c, miss)) continue;
      const n = typeof c === "number" ? c : Number(c);
      if (Number.isNaN(n)) continue;
      out.push(n);
    }
    return out;
  }

  /** Extract two paired numeric columns with pairwise deletion of missing. */
  pairedNumeric(a: string, b: string): { x: number[]; y: number[] } {
    const ma = this.meta(a)?.missingValues;
    const mb = this.meta(b)?.missingValues;
    const ca = this.column(a);
    const cb = this.column(b);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < ca.length; i++) {
      if (isMissing(ca[i], ma) || isMissing(cb[i], mb)) continue;
      const na = Number(ca[i]);
      const nb = Number(cb[i]);
      if (Number.isNaN(na) || Number.isNaN(nb)) continue;
      x.push(na);
      y.push(nb);
    }
    return { x, y };
  }

  /** Split a dependent variable into groups defined by a grouping variable. */
  groupedNumeric(dependent: string, group: string): Map<string, number[]> {
    const md = this.meta(dependent)?.missingValues;
    const mg = this.meta(group)?.missingValues;
    const cd = this.column(dependent);
    const cg = this.column(group);
    const out = new Map<string, number[]>();
    for (let i = 0; i < cd.length; i++) {
      if (isMissing(cd[i], md) || isMissing(cg[i], mg)) continue;
      const key = String(cg[i]);
      const n = Number(cd[i]);
      if (Number.isNaN(n)) continue;
      const arr = out.get(key);
      if (arr) arr.push(n);
      else out.set(key, [n]);
    }
    return out;
  }

  /** Frequency table for a categorical column. */
  frequencies(name: string): { value: string; count: number; percent: number }[] {
    const miss = this.meta(name)?.missingValues;
    const counts = new Map<string, number>();
    let valid = 0;
    for (const c of this.column(name)) {
      if (isMissing(c, miss)) continue;
      const k = String(c);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      valid += 1;
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, percent: valid ? (count / valid) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);
  }
}

/** Infer data type from a sample of cells. */
export function inferDataType(cells: Cell[]): DataType {
  let sawNumber = false;
  for (const c of cells) {
    if (isMissing(c)) continue;
    if (typeof c === "number") {
      sawNumber = true;
      continue;
    }
    if (typeof c === "string") {
      const n = Number(c);
      if (c.trim() !== "" && !Number.isNaN(n) && /^-?\d*\.?\d+$/.test(c.trim())) {
        sawNumber = true;
      } else {
        return "string";
      }
    }
  }
  return sawNumber ? "numeric" : "string";
}

export function inferMeasure(type: DataType): MeasureLevel {
  return type === "numeric" ? "scale" : "nominal";
}

/** Convert tabular data into a statfmt WriteSpec for SPSS `.sav` export. */
export function toSavSpec(data: TabularData, fileLabel = "Exported dataset"): {
  variables: {
    name: string;
    type: ReadStatType;
    label?: string;
    measure?: ReadStatMeasure;
    valueLabels?: string;
    missingValues?: number[];
  }[];
  rows: Cell[][];
  valueLabelSets?: Record<string, { value: number | string; label: string }[]>;
  fileLabel: string;
} {
  const valueLabelSets: Record<string, { value: number | string; label: string }[]> = {};
  const variables = data.variables.map((v) => {
    const type = v.dataType === "numeric" ? ReadStatType.DOUBLE : ReadStatType.STRING;
    const measure =
      v.measure === "scale"
        ? ReadStatMeasure.SCALE
        : v.measure === "ordinal"
          ? ReadStatMeasure.ORDINAL
          : ReadStatMeasure.NOMINAL;
    const spec: {
      name: string;
      type: ReadStatType;
      label?: string;
      measure?: ReadStatMeasure;
      valueLabels?: string;
      missingValues?: number[];
    } = { name: v.name, type, label: v.label ?? undefined, measure };
    if (v.valueLabels && Object.keys(v.valueLabels).length > 0) {
      const setName = `${v.name}_labels`;
      spec.valueLabels = setName;
      valueLabelSets[setName] = Object.entries(v.valueLabels).map(([value, label]) => ({
        // For string variables the label values must be strings; for numeric, numbers.
        value: v.dataType === "string" ? value : Number(value),
        label,
      }));
    }
    if (v.missingValues && v.missingValues.length > 0) {
      const nums = v.missingValues
        .map((m) => (typeof m === "number" ? m : Number(m)))
        .filter((m) => !Number.isNaN(m));
      if (nums.length > 0) spec.missingValues = nums;
    }
    return spec;
  });
  return { variables, rows: data.rows, valueLabelSets, fileLabel };
}
