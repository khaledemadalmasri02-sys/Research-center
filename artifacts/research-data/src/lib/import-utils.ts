import * as XLSX from "xlsx";
import { serializeVitals, type VitalFields } from "@/lib/vitals-utils";

export type ImportableField =
  | "collectionName"
  | "collectionDate"
  | "collectionType"
  | "patientId"
  | "patientName"
  | "age"
  | "sex"
  | "dateOfVisit"
  | "chiefComplaint"
  | "vitalSigns"
  | "vitalBP"
  | "vitalRR"
  | "vitalTemp"
  | "vitalHR"
  | "vitalO2"
  | "historyTrauma"
  | "mechanismOfInjuryAndLocalisation"
  | "signsAndSymptomsTrauma"
  | "historyMedical"
  | "signsAndSymptomsMedical"
  | "riskFactors"
  | "provisionalDiagnosis"
  | "emergencyReport"
  | "aiPredictionOutput"
  | "finalConfirmedDiagnosis"
  | "finalConfirmedDiagnosisAr"
  | "notes"
  | "radiologyImageFilePathOrLink"
  | "radiologyImages";

export const FIELD_LABELS: Record<ImportableField, string> = {
  collectionName:                   "Collection Name",
  collectionDate:                   "Date of Collection",
  collectionType:                   "Collection Type",
  patientId:                        "Patient ID",
  patientName:                      "Patient Name",
  age:                              "Age",
  sex:                              "Sex",
  dateOfVisit:                      "Date of Visit",
  chiefComplaint:                   "Chief Complaint",
  vitalSigns:                       "Vital Signs (combined)",
  vitalBP:                          "BP (Blood Pressure)",
  vitalRR:                          "RR (Respiratory Rate)",
  vitalTemp:                        "Temperature",
  vitalHR:                          "HR (Heart Rate)",
  vitalO2:                          "O2 Saturation",
  historyTrauma:                    "History (Trauma)",
  mechanismOfInjuryAndLocalisation: "Mechanism of Injury",
  signsAndSymptomsTrauma:           "Signs & Symptoms (Trauma)",
  historyMedical:                   "History (Medical)",
  signsAndSymptomsMedical:          "Signs & Symptoms (Medical)",
  riskFactors:                      "Risk Factors",
  provisionalDiagnosis:             "Provisional Diagnosis",
  emergencyReport:                  "Emergency Report",
  aiPredictionOutput:               "AI Prediction",
  finalConfirmedDiagnosis:          "Final Diagnosis (EN)",
  finalConfirmedDiagnosisAr:        "Final Diagnosis (AR)",
  notes:                            "Notes",
  radiologyImageFilePathOrLink:     "Radiology Image Link",
  radiologyImages:                  "Image Paths (multi-image)",
};

// Alternate header spellings (normalised: lowercase, stripped of non-alphanumeric)
const ALIASES: Array<[string[], ImportableField]> = [
  [["collectionname","collection","studyname","studyset","dataset"],              "collectionName"],
  [["dateofcollection","collectiondate","studydate"],                             "collectionDate"],
  [["collectiontype","type","category"],                                          "collectionType"],
  [["patientid","patid","pid","caseid","casenumber","case"],                      "patientId"],
  [["patientname","name","fullname","patient"],                                   "patientName"],
  [["age","patientage","ageyears"],                                               "age"],
  [["sex","gender","patientgender","patientsex"],                                 "sex"],
  [["dateofvisit","visitdate","admissiondate"],                                   "dateOfVisit"],
  [["chiefcomplaint","complaint","presentingcomplaint","cc","maincomplaint"],     "chiefComplaint"],
  [["vitalsigns","vitals","vs"],                                                  "vitalSigns"],
  [["bp","bloodpressure","systolicdiastolic","bpmmhg"],                           "vitalBP"],
  [["rr","respiratoryrate","breathsmin","resprate"],                              "vitalRR"],
  [["temperature","temp","temperaturec"],                                          "vitalTemp"],
  [["hr","heartrate","pulse","bpm"],                                              "vitalHR"],
  [["o2sat","o2saturation","o2","spo2","oxygensaturation","oxygensat"],           "vitalO2"],
  [["historytrauma","traumahistory","injuryhistory","trauma"],                    "historyTrauma"],
  [["mechanismofinjury","mechanism","moi","injurymechanism","localization","mechanismofinjuryandlocalisation"], "mechanismOfInjuryAndLocalisation"],
  [["signssymptomstrauma","signsandsymptomsoftrauma","symptomsoftrauma","traumasymptoms"], "signsAndSymptomsTrauma"],
  [["historymedical","medicalhistory","pmhx","pastmedical"],                     "historyMedical"],
  [["signssymptomsmedical","medicalsymptoms","signsandsymptomsmedical"],         "signsAndSymptomsMedical"],
  [["riskfactors","risks","riskfactor"],                                          "riskFactors"],
  [["provisionaldiagnosis","provisionaldx","workingdiagnosis","workingdx","impression","probablediagnosis"], "provisionalDiagnosis"],
  [["emergencyreport","emergreport","erreport","report"],                         "emergencyReport"],
  [["aiprediction","aipredictionoutput","ai","airesult","aidiagnosis"],           "aiPredictionOutput"],
  [["finaldiagnosisen","finaldiagnosis","confirmeddiagnosis","diagnosis","dx","finalconfirmeddiagnosis"], "finalConfirmedDiagnosis"],
  [["finaldiagnosisar","arabicdiagnosis","diagnosisarabic","finalardiagnosis","finalconfirmeddiagnosisar"], "finalConfirmedDiagnosisAr"],
  [["notes","note","comment","comments","remarks"],                               "notes"],
  [["radiologyimage","imagelink","imagelinkpath","radiologyimagefilepathlink","radiologyimagefilepathOrlink"], "radiologyImageFilePathOrLink"],
  [["imagepaths","imagepath","allimagepaths","allimages","radiologyimages"],      "radiologyImages"],
];

// Normal vital reference defaults — used when a vital field is blank in the import
const VITAL_DEFAULTS: VitalFields = {
  BP:   "120/80",
  RR:   "16",
  Temp: "37.0",
  HR:   "80",
  O2:   "98",
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function detectField(header: string): ImportableField | null {
  const n = normalise(header);
  for (const key of Object.keys(FIELD_LABELS) as ImportableField[]) {
    if (normalise(key) === n) return key;
  }
  for (const [aliases, field] of ALIASES) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

export type ColumnMap  = { header: string; field: ImportableField | null };
export type ParsedImport = {
  columnMap:      ColumnMap[];
  rows:           Record<ImportableField, string>[];
  skippedHeaders: string[];
};

// ── Date helpers ────────────────────────────────────────────────────────────

/** Convert an Excel date serial (e.g. 45306) to YYYY-MM-DD, or null. */
function excelSerialToISO(serial: number): string | null {
  try {
    // XLSX.SSF exposes parse_date_code in the library
    const ssf = (XLSX as any).SSF ?? (XLSX as any).utils?.SSF;
    if (ssf?.parse_date_code) {
      const p = ssf.parse_date_code(serial);
      if (p) {
        const y = String(p.y).padStart(4, "0");
        const m = String(p.m).padStart(2, "0");
        const d = String(p.d).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
    // Fallback: manual Excel epoch math
    // Excel epoch: Jan 0 1900 = day 0, but has a leap-year bug (day 60 = Feb 29 1900 which didn't exist)
    const msPerDay = 86400000;
    const excelEpoch = new Date(Date.UTC(1899, 11, 31)); // Dec 31 1899
    const adjusted   = serial > 59 ? serial - 1 : serial; // skip the phantom Feb 29 1900
    const date = new Date(excelEpoch.getTime() + adjusted * msPerDay);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Parse any date-like string into a YYYY-MM-DD string.
 * Returns "" (not null) on failure so nothing downstream can throw.
 */
export function parseDateValue(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (!trimmed) return "";

  // 1. Standard ISO / browser-parseable formats
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* fall through */ }

  // 2. Pure integer → Excel date serial
  const asNum = Number(trimmed);
  if (Number.isInteger(asNum) && asNum > 0 && asNum < 200000) {
    const iso = excelSerialToISO(asNum);
    if (iso) return iso;
  }

  // 3. DD/MM/YYYY or D/M/YYYY (common in non-US Excel files)
  const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    const year = yy!.length === 2 ? `20${yy}` : yy!;
    try {
      const d = new Date(`${year}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch { /* fall through */ }
  }

  // 4. Give up — return empty so rendering never crashes
  return "";
}

// ── Cell reader ─────────────────────────────────────────────────────────────

function cellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  try {
    if (cell.t === "d") {
      // cellDates:true branch (rarely hit with our options)
      const v = cell.v;
      if (v instanceof Date && !isNaN(v.getTime())) {
        return v.toISOString().slice(0, 10);
      }
    }
    if (cell.t === "n") {
      // Prefer formatted string (cell.w) — XLSX populates this for date-format cells
      const w = String(cell.w ?? "").trim();
      if (w && w !== "Invalid Date" && !/^#+$/.test(w)) return w;
      // Fallback: raw numeric value as string
      return String(cell.v ?? "").trim();
    }
    const result = String(cell.w ?? cell.v ?? "").trim();
    return result;
  } catch {
    return "";
  }
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseExcelFile(file: File): Promise<ParsedImport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw  = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(raw);
        const wb   = XLSX.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error("Empty workbook");
        const ws = wb.Sheets[sheetName]!;

        const range     = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
        const headerRow = range.s.r;

        const columnMap: ColumnMap[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r: headerRow, c });
          const cellVal  = cellToString(ws[cellAddr]);
          if (!cellVal) continue;
          columnMap.push({ header: cellVal, field: detectField(cellVal) });
        }

        const rows: Record<ImportableField, string>[] = [];
        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const record   = {} as Record<ImportableField, string>;
          let hasValue   = false;
          for (let ci = 0; ci < columnMap.length; ci++) {
            const col = columnMap[ci]!;
            if (!col.field) continue;
            const c       = range.s.c + ci;
            const cellAddr = XLSX.utils.encode_cell({ r, c });
            const val      = cellToString(ws[cellAddr]);
            record[col.field] = val;
            if (val) hasValue = true;
          }
          if (hasValue) rows.push(record);
        }

        const skippedHeaders = columnMap.filter((c) => !c.field).map((c) => c.header);
        resolve({ columnMap, rows, skippedHeaders });
      } catch (err) {
        reject(new Error((err as Error).message || "Failed to parse Excel file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// ── Row → Patient ─────────────────────────────────────────────────────────────

/** Convert a raw string record to a CreatePatientBody-compatible object.
 *  All type mismatches are silently coerced — this function never throws. */
export function rowToPatient(row: Record<ImportableField, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const vitalParts: Partial<VitalFields> = {};
  let hasIndividualVitals = false;
  let hasCombinedVitals   = false;

  for (const [key, rawVal] of Object.entries(row) as [ImportableField, string][]) {
    // Coerce to string; skip truly empty values
    const val = String(rawVal ?? "").trim();

    // ── Individual vital fields ──────────────────────────────────────────
    if (key === "vitalBP")   { if (val) { vitalParts.BP   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalRR")   { if (val) { vitalParts.RR   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalTemp") { if (val) { vitalParts.Temp = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalHR")   { if (val) { vitalParts.HR   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalO2")   { if (val) { vitalParts.O2   = val; hasIndividualVitals = true; } continue; }

    // ── Combined vital signs (legacy single-field) ───────────────────────
    if (key === "vitalSigns") {
      if (val) { result["vitalSigns"] = val; hasCombinedVitals = true; }
      continue;
    }

    // ── Radiology image paths ─────────────────────────────────────────────
    if (key === "radiologyImages") {
      if (!val) continue;
      let paths: string[] = [];
      if (val.startsWith("[")) {
        try { paths = JSON.parse(val) as string[]; } catch { paths = [val]; }
      } else {
        paths = val.split("|").map((s) => s.trim()).filter(Boolean);
      }
      if (paths.length > 0) {
        result["radiologyImages"] = JSON.stringify(paths);
        if (!result["radiologyImageFilePathOrLink"] && paths[0]) {
          result["radiologyImageFilePathOrLink"] = paths[0];
        }
      }
      continue;
    }

    // ── Age — coerce to number, ignore non-numeric ───────────────────────
    if (key === "age") {
      if (!val) continue;
      const n = parseFloat(val);
      if (!isNaN(n) && n >= 0) result[key] = Math.round(n);
      // silently ignore non-numeric age values
      continue;
    }

    // ── Date fields — safe parsing, never throws ─────────────────────────
    if (key === "collectionDate" || key === "dateOfVisit") {
      if (!val) continue;
      const iso = parseDateValue(val);
      // Only store if we produced a valid ISO date; otherwise skip
      if (iso) result[key] = iso;
      continue;
    }

    // ── Sex — normalise to enum values ───────────────────────────────────
    if (key === "sex") {
      if (!val) continue;
      const lower = val.toLowerCase();
      if (lower === "m" || lower.startsWith("mal")) result[key] = "Male";
      else if (lower === "f" || lower.startsWith("fem")) result[key] = "Female";
      else result[key] = "Other";
      continue;
    }

    // ── Collection type — normalise to enum values ────────────────────────
    if (key === "collectionType") {
      if (!val) continue;
      const lower = val.toLowerCase();
      if (lower.startsWith("normal")) result[key] = "Normal";
      else if (lower.startsWith("abnormal")) result[key] = "Abnormal";
      else if (lower.startsWith("suspicious")) result[key] = "Suspicious";
      else result[key] = val; // keep as-is, DB will reject if invalid
      continue;
    }

    // ── All other string fields ───────────────────────────────────────────
    if (val) result[key] = val;
  }

  // ── Merge vitals ─────────────────────────────────────────────────────────
  if (hasIndividualVitals) {
    // Fill any missing vital with the normal reference default
    result["vitalSigns"] = serializeVitals({
      BP:   vitalParts.BP   ?? VITAL_DEFAULTS.BP,
      RR:   vitalParts.RR   ?? VITAL_DEFAULTS.RR,
      Temp: vitalParts.Temp ?? VITAL_DEFAULTS.Temp,
      HR:   vitalParts.HR   ?? VITAL_DEFAULTS.HR,
      O2:   vitalParts.O2   ?? VITAL_DEFAULTS.O2,
    });
  } else if (!hasCombinedVitals) {
    // No vitals provided at all — leave vitalSigns empty (don't auto-fill)
    // so the clinician can add real values. Uncomment the line below to
    // always fill with defaults instead:
    // result["vitalSigns"] = serializeVitals(VITAL_DEFAULTS);
  }

  return result;
}
