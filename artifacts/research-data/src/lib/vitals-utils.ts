export type VitalFields = {
  BP: string;   // Blood Pressure  (BB)
  RR: string;   // Respiratory Rate
  Temp: string; // Temperature
  HR: string;   // Heart Rate
  O2: string;   // O2 Saturation
};

export const VITAL_DEFS: { key: keyof VitalFields; label: string; placeholder: string; unit: string }[] = [
  { key: "BP",   label: "BP",          placeholder: "120/80",  unit: "mmHg"       },
  { key: "RR",   label: "RR",          placeholder: "18",      unit: "breaths/min" },
  { key: "Temp", label: "Temperature", placeholder: "37.0",    unit: "°C"         },
  { key: "HR",   label: "HR",          placeholder: "80",      unit: "bpm"        },
  { key: "O2",   label: "O₂ Sat",      placeholder: "98",      unit: "%"          },
];

export function parseVitals(raw: string | null | undefined): VitalFields {
  const base: VitalFields = { BP: "", RR: "", Temp: "", HR: "", O2: "" };
  if (!raw) return base;
  const parts = raw.split("|").map((s) => s.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim() as keyof VitalFields;
    const val = part.slice(colonIdx + 1).trim();
    if (key in base) base[key] = val;
  }
  return base;
}

export function serializeVitals(v: VitalFields): string {
  return (Object.keys(v) as (keyof VitalFields)[])
    .filter((k) => v[k].trim())
    .map((k) => `${k}: ${v[k].trim()}`)
    .join(" | ");
}
