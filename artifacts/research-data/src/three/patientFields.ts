import { type RecordRow } from "@/lib/records";

export type Severity = "normal" | "warning" | "critical" | "unknown";

export const SEVERITY_COLORS: Record<Severity, string> = {
  normal: "#34d399",
  warning: "#fbbf24",
  critical: "#f87171",
  unknown: "#94a3b8",
};

export const SEVERITY_BG: Record<Severity, string> = {
  normal: "rgba(52,211,153,0.10)",
  warning: "rgba(251,191,36,0.12)",
  critical: "rgba(248,113,113,0.14)",
  unknown: "rgba(148,163,184,0.10)",
};

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.length ? v : undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

const CRITICAL_RX = /(critical|severe|unstable|arrest|codes?|intubat)/i;
const WARNING_RX = /(abnormal|elevated|decreased|low|high|fever|pain|hemorrh)/i;

function textSeverity(text: string | undefined): Severity {
  if (!text) return "unknown";
  if (CRITICAL_RX.test(text)) return "critical";
  if (WARNING_RX.test(text)) return "warning";
  return "normal";
}

export function inferRecordSeverity(record: RecordRow): Severity {
  const d = record.data ?? {};
  const text = [
    asString(d.chiefComplaint),
    asString(d.vitalSigns),
    asString(d.provisionalDiagnosis),
    asString(d.finalConfirmedDiagnosis),
    asString(d.aiPredictionOutput),
  ]
    .filter(Boolean)
    .join(" ");
  return textSeverity(text);
}

export type FieldGroup =
  | "identity"
  | "vitals"
  | "diagnosis"
  | "labs"
  | "imaging"
  | "notes";

export type SpatialField = {
  group: FieldGroup;
  label: string;
  value: string;
  severity?: Severity;
};

export function recordToFields(record: RecordRow): SpatialField[] {
  const d = record.data ?? {};
  const fields: SpatialField[] = [];

  const name = asString(d.patientName) ?? `Record #${record.id}`;
  const pid = asString(d.patientId) ?? String(record.id);
  fields.push({ group: "identity", label: "Patient", value: name });
  fields.push({ group: "identity", label: "ID", value: pid });

  const age = asNumber(d.age);
  const sex = asString(d.sex);
  if (age != null || sex) {
    fields.push({
      group: "identity",
      label: "Demographics",
      value: [age != null ? `${age}y` : null, sex ?? null]
        .filter(Boolean)
        .join(" • "),
    });
  }
  const dov = asString(d.dateOfVisit);
  if (dov) {
    fields.push({
      group: "identity",
      label: "Visit",
      value: dov,
    });
  }
  const collection = asString(d.collectionName) ?? asString(d.collectionType);
  if (collection) {
    fields.push({ group: "identity", label: "Collection", value: collection });
  }

  const cc = asString(d.chiefComplaint);
  if (cc) {
    fields.push({
      group: "diagnosis",
      label: "Chief Complaint",
      value: cc,
      severity: textSeverity(cc),
    });
  }
  const prov = asString(d.provisionalDiagnosis);
  if (prov) {
    fields.push({
      group: "diagnosis",
      label: "Provisional",
      value: prov,
      severity: textSeverity(prov),
    });
  }
  const final = asString(d.finalConfirmedDiagnosis);
  if (final) {
    fields.push({
      group: "diagnosis",
      label: "Final Diagnosis",
      value: final,
      severity: textSeverity(final),
    });
  }
  const finalAr = asString(d.finalConfirmedDiagnosisAr);
  if (finalAr) {
    fields.push({
      group: "diagnosis",
      label: "Final (AR)",
      value: finalAr,
    });
  }

  const vitals = asString(d.vitalSigns);
  if (vitals) {
    fields.push({
      group: "vitals",
      label: "Vital Signs",
      value: vitals,
      severity: textSeverity(vitals),
    });
  }

  const medicalHx = asString(d.historyMedical);
  if (medicalHx) fields.push({ group: "notes", label: "Medical History", value: medicalHx });
  const traumaHx = asString(d.historyTrauma);
  if (traumaHx) fields.push({ group: "notes", label: "Trauma History", value: traumaHx });
  const moi = asString(d.mechanismOfInjuryAndLocalisation);
  if (moi) fields.push({ group: "notes", label: "Mechanism", value: moi });
  const ssMed = asString(d.signsAndSymptomsMedical);
  const ssTra = asString(d.signsAndSymptomsTrauma);
  if (ssMed) fields.push({ group: "notes", label: "Signs & Symptoms", value: ssMed });
  else if (ssTra)
    fields.push({ group: "notes", label: "Signs & Symptoms", value: ssTra });
  const rf = asString(d.riskFactors);
  if (rf) fields.push({ group: "notes", label: "Risk Factors", value: rf });
  const er = asString(d.emergencyReport);
  if (er) fields.push({ group: "notes", label: "Emergency Report", value: er });
  const notes = asString(d.notes);
  if (notes) fields.push({ group: "notes", label: "Notes", value: notes });

  const rad = asString(d.radiologyImages) ?? asString(d.radiologyImageFilePathOrLink);
  if (rad) {
    const count = rad.split(",").filter(Boolean).length;
    fields.push({
      group: "imaging",
      label: "Radiology",
      value: count > 1 ? `${count} images` : rad,
    });
  }

  const ai = asString(d.aiPredictionOutput);
  if (ai) {
    fields.push({
      group: "labs",
      label: "AI Prediction",
      value: ai,
      severity: textSeverity(ai),
    });
  }

  return fields;
}

export function fieldsByRecord(record: RecordRow) {
  const grouped: Record<FieldGroup, SpatialField[]> = {
    identity: [],
    vitals: [],
    diagnosis: [],
    labs: [],
    imaging: [],
    notes: [],
  };
  for (const f of recordToFields(record)) grouped[f.group].push(f);
  return grouped;
}

export function recordName(record: RecordRow): string {
  const d = record.data ?? {};
  return (
    asString(d.patientName) ??
    asString(d.patientId) ??
    `Record #${record.id}`
  );
}
