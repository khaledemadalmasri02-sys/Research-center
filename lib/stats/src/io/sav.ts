import { readSav, writeSav, ReadStatType, ReadStatMeasure } from "@irbisadm/statfmt";
import type { TabularData, VariableMeta, Cell, DataType, MeasureLevel } from "../types";
import { toSavSpec } from "../dataset";

function mapType(t: ReadStatType): DataType {
  return t === ReadStatType.STRING || t === ReadStatType.STRING_REF ? "string" : "numeric";
}

function mapMeasure(m: ReadStatMeasure): MeasureLevel {
  switch (m) {
    case ReadStatMeasure.NOMINAL:
      return "nominal";
    case ReadStatMeasure.ORDINAL:
      return "ordinal";
    case ReadStatMeasure.SCALE:
      return "scale";
    default:
      return "nominal";
  }
}

function mapMeasureBack(level: MeasureLevel): ReadStatMeasure {
  return level === "scale"
    ? ReadStatMeasure.SCALE
    : level === "ordinal"
      ? ReadStatMeasure.ORDINAL
      : ReadStatMeasure.NOMINAL;
}

export function tabularFromSav(bytes: Uint8Array): TabularData {
  const ds = readSav(bytes);
  const variables: VariableMeta[] = ds.variables.map((v) => {
    const valueLabels: Record<string, string> = {};
    for (const vl of v.valueLabels ?? []) {
      valueLabels[String(vl.value)] = vl.label;
    }
    return {
      name: v.name,
      label: v.label,
      dataType: mapType(v.type),
      measure: mapMeasure(v.measure),
      valueLabels: Object.keys(valueLabels).length ? valueLabels : undefined,
    };
  });
  const rows: Cell[][] = ds.rows.map((r) => r.map((c) => (c === undefined ? null : c)));
  return { variables, rows };
}

export function tabularToSavBytes(data: TabularData): Uint8Array {
  const spec = toSavSpec(data);
  // Ensure measure mapping is applied from our domain types.
  const variables = spec.variables.map((v) => ({
    ...v,
    measure: mapMeasureBack(
      data.variables.find((dv) => dv.name === v.name)?.measure ?? "nominal",
    ),
  }));
  return writeSav({ ...spec, variables });
}
