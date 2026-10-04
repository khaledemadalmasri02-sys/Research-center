import type { RecordRow } from "@/lib/records";

export type Severity = "normal" | "warning" | "critical" | "unknown" | "muted";

export type FieldKind =
  | "info"
  | "demographics"
  | "history"
  | "diagnosis"
  | "medication"
  | "allergy"
  | "lab"
  | "imaging"
  | "vital"
  | "note"
  | "procedure"
  | "visit"
  | "research"
  | "document"
  | "timeline";

export type SpatialField = {
  id: string;
  kind: FieldKind;
  // Coarse group used to layout fields inside a section (e.g. "identity",
  // "diagnosis", "vitals"). Optional — older code paths may omit it.
  group?: string;
  label: string;
  primary: string;
  secondary?: string;
  meta?: string;
  severity?: Severity;
  badge?: string;
};

export type SpatialSectionId =
  | "overview"
  | "demographics"
  | "history"
  | "diagnoses"
  | "medications"
  | "allergies"
  | "labs"
  | "imaging"
  | "vitals"
  | "notes"
  | "procedures"
  | "visits"
  | "research"
  | "documents"
  | "timeline";

export type SpatialSection = {
  id: SpatialSectionId;
  index: number;
  title: string;
  shortTitle: string;
  icon: string; // emoji/glyph, no external dep
  fields: SpatialField[];
};

export const SPATIAL_SECTION_ORDER: SpatialSectionId[] = [
  "overview",
  "demographics",
  "history",
  "diagnoses",
  "medications",
  "allergies",
  "labs",
  "imaging",
  "vitals",
  "notes",
  "procedures",
  "visits",
  "research",
  "documents",
  "timeline",
];
