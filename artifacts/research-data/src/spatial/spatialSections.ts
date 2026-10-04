import { type FieldDef, type RecordRow, type RecordDefinition } from "@/lib/records";
import {
  SPATIAL_SECTION_ORDER,
  type Severity,
  type SpatialField,
  type SpatialSection,
  type SpatialSectionId,
} from "./spatialTypes";

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
const WARNING_RX = /(abnormal|elevated|decreased|low|high|fever|pain|hemorrh|allerg|reaction)/i;
const MUTED_RX = /(none|n\/a|unknown|not recorded|—|-)/i;

export function textSeverity(text: string | undefined): Severity {
  if (!text) return "muted";
  if (MUTED_RX.test(text)) return "muted";
  if (CRITICAL_RX.test(text)) return "critical";
  if (WARNING_RX.test(text)) return "warning";
  return "normal";
}

// Map a record-definition field key to a spatial section. Falls back to
// "notes" if the key isn't recognized.
const KEY_TO_SECTION: Record<string, { section: SpatialSectionId; kind: SpatialField["kind"] }> = {
  collectionName: { section: "demographics", kind: "demographics" },
  collectionDate: { section: "demographics", kind: "demographics" },
  collectionType: { section: "demographics", kind: "demographics" },
  patientId: { section: "demographics", kind: "demographics" },
  patientName: { section: "demographics", kind: "demographics" },
  age: { section: "demographics", kind: "demographics" },
  sex: { section: "demographics", kind: "demographics" },
  dateOfVisit: { section: "demographics", kind: "demographics" },

  historyMedical: { section: "history", kind: "history" },
  historyTrauma: { section: "history", kind: "history" },
  mechanismOfInjuryAndLocalisation: { section: "history", kind: "history" },
  signsAndSymptomsMedical: { section: "history", kind: "history" },
  signsAndSymptomsTrauma: { section: "history", kind: "history" },
  riskFactors: { section: "history", kind: "history" },

  chiefComplaint: { section: "diagnoses", kind: "diagnosis" },
  provisionalDiagnosis: { section: "diagnoses", kind: "diagnosis" },
  finalConfirmedDiagnosis: { section: "diagnoses", kind: "diagnosis" },
  finalConfirmedDiagnosisAr: { section: "diagnoses", kind: "diagnosis" },

  vitalSigns: { section: "vitals", kind: "vital" },

  radiologyImages: { section: "imaging", kind: "imaging" },
  radiologyImageFilePathOrLink: { section: "imaging", kind: "imaging" },

  aiPredictionOutput: { section: "labs", kind: "lab" },

  emergencyReport: { section: "documents", kind: "document" },
  notes: { section: "notes", kind: "note" },
};

// A short, human-readable secondary line for fields whose value is a
// comma-separated list (e.g. radiology images) or pipe-separated vitals.
function deriveSecondary(key: string, value: string): string | undefined {
  if (!value) return undefined;
  if (key === "vitalSigns") {
    // already pipe-separated; show as-is
    return value.length > 60 ? value.slice(0, 58) + "…" : value;
  }
  if (key === "radiologyImages") {
    const count = value.split(",").filter(Boolean).length;
    return count > 1 ? `${count} entries` : undefined;
  }
  if (key === "radiologyImageFilePathOrLink") {
    return undefined;
  }
  return undefined;
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

const SECTION_TITLES: Record<SpatialSectionId, { title: string; shortTitle: string; icon: string }> = {
  overview: { title: "Patient Overview", shortTitle: "Overview", icon: "◉" },
  demographics: { title: "Demographics", shortTitle: "Demographics", icon: "◐" },
  history: { title: "Medical History", shortTitle: "History", icon: "▤" },
  diagnoses: { title: "Diagnoses", shortTitle: "Diagnoses", icon: "◎" },
  medications: { title: "Medications", shortTitle: "Meds", icon: "✚" },
  allergies: { title: "Allergies", shortTitle: "Allergies", icon: "!" },
  labs: { title: "Laboratory Results", shortTitle: "Labs", icon: "▦" },
  imaging: { title: "Imaging", shortTitle: "Imaging", icon: "▣" },
  vitals: { title: "Vital Signs", shortTitle: "Vitals", icon: "♡" },
  notes: { title: "Clinical Notes", shortTitle: "Notes", icon: "✎" },
  procedures: { title: "Procedures", shortTitle: "Procedures", icon: "✦" },
  visits: { title: "Visits", shortTitle: "Visits", icon: "↻" },
  research: { title: "Research Data", shortTitle: "Research", icon: "⌬" },
  documents: { title: "Documents", shortTitle: "Docs", icon: "▢" },
  timeline: { title: "Timeline", shortTitle: "Timeline", icon: "◷" },
};

function buildOverview(record: RecordRow, d: Record<string, unknown>): SpatialField[] {
  const fields: SpatialField[] = [];
  // Defensive: some upstream record shapes may arrive with `data` as a JSON
  // string, an array, or otherwise not a plain object. Normalize to `{}` so
  // we still produce at least the patient identity fields below.
  if (d == null || typeof d !== "object" || Array.isArray(d)) {
    d = {};
  }
  const name = asString(d.patientName) ?? `Record #${record.id}`;
  const pid = asString(d.patientId) ?? String(record.id);
  const age = asNumber(d.age);
  const sex = asString(d.sex);
  const collection = asString(d.collectionName) ?? asString(d.collectionType);
  const dov = asString(d.dateOfVisit);
  fields.push({ id: "ov-name", group: "identity", label: "Patient", primary: name, kind: "info" });
  fields.push({
    id: "ov-id",
    group: "identity",
    label: "Medical Record #",
    primary: pid,
    kind: "info",
  });
  if (age != null || sex) {
    fields.push({
      id: "ov-demo",
      group: "identity",
      label: "Demographics",
      primary: [age != null ? `${age}y` : null, sex ?? null].filter(Boolean).join(" • "),
      kind: "info",
    });
  }
  if (collection || dov) {
    fields.push({
      id: "ov-visit",
      group: "identity",
      label: "Visit",
      primary: [collection, dov].filter(Boolean).join(" · "),
      kind: "info",
    });
  }
  const cc = asString(d.chiefComplaint);
  const prov = asString(d.provisionalDiagnosis);
  const final = asString(d.finalConfirmedDiagnosis);
  if (cc || prov || final) {
    fields.push({
      id: "ov-dx",
      group: "diagnosis",
      label: "Primary Diagnosis",
      primary: final ?? prov ?? cc ?? "",
      secondary: cc && (prov || final) ? `Complaint: ${cc}` : undefined,
      severity: textSeverity(final ?? prov ?? cc),
      kind: "diagnosis",
    });
  }
  const v = asString(d.vitalSigns);
  if (v) {
    fields.push({ id: "ov-vitals", group: "vitals", label: "Latest Vitals", primary: v, kind: "vital" });
  }
  return fields;
}

function fieldForDef(
  def: FieldDef,
  d: Record<string, unknown>,
  usedKeys: Set<string>,
): SpatialField | null {
  const raw = d[def.key];
  const primary = asString(raw) ?? (typeof raw === "number" ? String(raw) : undefined);
  const used = primary !== undefined && primary !== "";
  usedKeys.add(def.key);
  const mapped = KEY_TO_SECTION[def.key];
  const section = mapped?.section ?? "notes";
  const kind: SpatialField["kind"] = mapped?.kind ?? "note";
  const label = def.label || def.key;

  // Imaging path resolution is deferred to FieldCard (via extractImageUrls →
  // resolveImageSrc), which correctly handles JSON arrays, comma-separated
  // lists, and single paths. Pre-resolving here with a naive split(",") would
  // corrupt JSON array strings.

  if (used) {
    return {
      id: `def-${def.key}`,
      label,
      primary: primary ?? "Not recorded",
      secondary: deriveSecondary(def.key, primary ?? ""),
      severity: primary ? textSeverity(primary) : "muted",
      kind,
    };
  }
  return {
    id: `def-${def.key}`,
    label,
    primary: "Not recorded",
    secondary: "Add data in the 2D record view",
    severity: "muted",
    kind,
  };
}

export type BuildOptions = {
  // Optional collection definition. When provided, the workspace shows every
  // defined field (even if empty) so the user sees the full record shape.
  definition?: RecordDefinition | null;
};

export function buildSpatialSections(record: RecordRow, opts: BuildOptions = {}): SpatialSection[] {
  let d: Record<string, unknown> = (record.data ?? {}) as Record<string, unknown>;
  // Defensive: `data` should always be a plain object. Some older records
  // written before the jsonb coercion landed can be stored as a JSON-encoded
  // string or even an array. Normalize so downstream code never throws.
  if (d == null || typeof d !== "object" || Array.isArray(d)) {
    d = {};
  }
  const definition = opts.definition ?? null;
  const usedKeys = new Set<string>();

  // Build the buckets first
  const buckets: Record<SpatialSectionId, SpatialField[]> = {
    overview: buildOverview(record, d),
    demographics: [],
    history: [],
    diagnoses: [],
    medications: [],
    allergies: [],
    labs: [],
    imaging: [],
    vitals: [],
    notes: [],
    procedures: [],
    visits: [],
    research: [],
    documents: [],
    timeline: [],
  };

  if (definition && definition.fields?.length) {
    // Walk the definition's fields so every known field is shown.
    for (const f of definition.fields) {
      const field = fieldForDef(f, d, usedKeys);
      if (!field) continue;
      const sectionId = (KEY_TO_SECTION[f.key]?.section ?? "notes") as SpatialSectionId;
      if (sectionId === "overview") continue; // overview is hand-built
      buckets[sectionId].push(field);
    }
  } else {
    // No definition available: fall back to a data-driven scan of all keys
    // present on the record so the workspace never looks empty.
    for (const [key, raw] of Object.entries(d)) {
      if (key.startsWith("_")) continue;
      const primary = asString(raw);
      const mapped = KEY_TO_SECTION[key];
      const section = (mapped?.section ?? "notes") as SpatialSectionId;
      if (section === "overview") continue;
      const kind: SpatialField["kind"] = mapped?.kind ?? "note";
      const label = key
         .replace(/([A-Z])/g, " $1")
         .replace(/^./, (s) => s.toUpperCase())
         .trim();

      // Imaging path resolution is deferred to FieldCard (via extractImageUrls →
      // resolveImageSrc), which correctly handles JSON arrays, comma-separated
      // lists, and single paths. Pre-resolving here with a naive split(",")
      // would corrupt JSON array strings.

      buckets[section].push({
        id: `dyn-${key}`,
        label,
        primary: primary ?? "Not recorded",
        secondary: primary ? deriveSecondary(key, primary) : "Add data in the 2D record view",
        severity: primary ? textSeverity(primary) : "muted",
        kind,
      });
    }
  }

  // Always-on system sections that have no data source but should appear
  // (so the user knows they exist and can add data in 2D).
  if (buckets.medications.length === 0) {
    buckets.medications.push({
      id: "meds-empty",
      group: "medications",
      label: "Active Medications",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "medication",
    });
  }
  if (buckets.allergies.length === 0) {
    buckets.allergies.push({
      id: "allergies-empty",
      group: "allergies",
      label: "Known Allergies",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "allergy",
    });
  }
  if (buckets.labs.length === 0) {
    buckets.labs.push({
      id: "labs-empty",
      group: "labs",
      label: "Latest Results Summary",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "lab",
    });
  }
  if (buckets.procedures.length === 0) {
    buckets.procedures.push({
      id: "proc-empty",
      group: "procedures",
      label: "Procedures",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "procedure",
    });
  }
  if (buckets.research.length === 0) {
    buckets.research.push({
      id: "research-empty",
      group: "research",
      label: "Research Participation",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "research",
    });
  }
  if (buckets.visits.length === 0) {
    buckets.visits.push({
      id: "visits-empty",
      group: "visits",
      label: "Visit History",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "visit",
    });
  }
  if (buckets.documents.length === 0) {
    buckets.documents.push({
      id: "docs-empty",
      group: "documents",
      label: "Documents",
      primary: "Not recorded",
      secondary: "Add data in the 2D record view",
      severity: "muted",
      kind: "document",
    });
  }

  // Timeline is always derived from record timestamps
  const createdAt = record.createdAt ? new Date(record.createdAt) : null;
  const updatedAt = record.updatedAt ? new Date(record.updatedAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    buckets.timeline.push({
      id: "t-created",
      group: "timeline",
      label: "Record created",
      primary: createdAt.toLocaleString(),
      severity: "normal",
      kind: "timeline",
    });
  }
  if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
    buckets.timeline.push({
      id: "t-updated",
      group: "timeline",
      label: "Last updated",
      primary: updatedAt.toLocaleString(),
      severity: "normal",
      kind: "timeline",
    });
  }
  if (buckets.timeline.length === 0) {
    buckets.timeline.push({
      id: "t-empty",
      group: "timeline",
      label: "Timeline",
      primary: "No events",
      severity: "muted",
      kind: "timeline",
    });
  }

  return SPATIAL_SECTION_ORDER.map((id, index) => ({
    id,
    index,
    title: SECTION_TITLES[id].title,
    shortTitle: SECTION_TITLES[id].shortTitle,
    icon: SECTION_TITLES[id].icon,
    fields: buckets[id],
  }));
}

export function recordPatientName(record: RecordRow): string {
  const d = (record.data ?? {}) as Record<string, unknown>;
  return (
    asString(d.patientName) ??
    asString(d.patientId) ??
    `Record #${record.id}`
  );
}

export function recordPatientSubtitle(record: RecordRow): string {
  const d = (record.data ?? {}) as Record<string, unknown>;
  const age = asNumber(d.age);
  const sex = asString(d.sex);
  return [age != null ? `${age}y` : null, sex ?? null].filter(Boolean).join(" • ") || "—";
}
