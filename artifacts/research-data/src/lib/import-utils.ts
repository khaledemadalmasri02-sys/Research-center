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
  // Combined vitals (legacy / single-field)
  [["vitalsigns","vitals","vs"],                                                  "vitalSigns"],
  // Individual vitals — these match our own export column headers
  [["bp","bloodpressure","systolicdiastolic","bpmmhg"],                           "vitalBP"],
  [["rr","respiratoryrate","breathsmin","resprate"],                              "vitalRR"],
  [["temperature","temp","temperaturec"],                                          "vitalTemp"],
  [["hr","heartrate","pulse","bpm"],                                              "vitalHR"],
  [["o2sat","o2saturation","o2","spo2","oxygensaturation","oxygensat"],           "vitalO2"],
  // Clinical fields
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
  // "Image Paths" is our own export column — maps to the multi-image JSON field
  [["imagepaths","imagepath","allimagepaths","allimages","radiologyimages"], "radiologyImages"],
];

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function detectField(header: string): ImportableField | null {
  const n = normalise(header);
  // exact field-name match first
  for (const key of Object.keys(FIELD_LABELS) as ImportableField[]) {
    if (normalise(key) === n) return key;
  }
  // alias match
  for (const [aliases, field] of ALIASES) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

export type ColumnMap = {
  header: string;
  field: ImportableField | null;
};

export type ParsedImport = {
  columnMap: ColumnMap[];
  rows: Record<ImportableField, string>[];
  skippedHeaders: string[];
};

function cellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.t === "n") return String(cell.v ?? "");
  if (cell.t === "d") {
    const d = XLSX.SSF.parse_date_code(cell.v as number);
    if (d) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    }
  }
  return String(cell.w ?? cell.v ?? "").trim();
}

export function parseExcelFile(file: File): Promise<ParsedImport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error("Empty workbook");
        const ws = wb.Sheets[sheetName]!;

        const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
        const headerRow = range.s.r;

        const columnMap: ColumnMap[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r: headerRow, c });
          const cellVal = cellToString(ws[cellAddr]);
          if (!cellVal) continue;
          columnMap.push({ header: cellVal, field: detectField(cellVal) });
        }

        const rows: Record<ImportableField, string>[] = [];
        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const record = {} as Record<ImportableField, string>;
          let hasValue = false;
          for (let ci = 0; ci < columnMap.length; ci++) {
            const col = columnMap[ci]!;
            if (!col.field) continue;
            const c = range.s.c + ci;
            const cellAddr = XLSX.utils.encode_cell({ r, c });
            const val = cellToString(ws[cellAddr]);
            record[col.field] = val;
            if (val) hasValue = true;
          }
          if (hasValue) rows.push(record);
        }

        const skippedHeaders = columnMap
          .filter((c) => !c.field)
          .map((c) => c.header);

        resolve({ columnMap, rows, skippedHeaders });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Convert a raw string record to a CreatePatientBody-compatible object. */
export function rowToPatient(row: Record<ImportableField, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Collect individual vital fields so we can combine them
  const vitalParts: Partial<VitalFields> = {};
  let hasIndividualVitals = false;

  for (const [key, val] of Object.entries(row) as [ImportableField, string][]) {
    if (!val) continue;

    if (key === "vitalBP")   { vitalParts.BP   = val; hasIndividualVitals = true; continue; }
    if (key === "vitalRR")   { vitalParts.RR   = val; hasIndividualVitals = true; continue; }
    if (key === "vitalTemp") { vitalParts.Temp = val; hasIndividualVitals = true; continue; }
    if (key === "vitalHR")   { vitalParts.HR   = val; hasIndividualVitals = true; continue; }
    if (key === "vitalO2")   { vitalParts.O2   = val; hasIndividualVitals = true; continue; }

    // "Image Paths" column — pipe-separated or JSON array — restore as radiologyImages JSON
    if (key === "radiologyImages") {
      const trimmed = val.trim();
      let paths: string[] = [];
      if (trimmed.startsWith("[")) {
        try { paths = JSON.parse(trimmed) as string[]; } catch { paths = [trimmed]; }
      } else {
        paths = trimmed.split("|").map((s) => s.trim()).filter(Boolean);
      }
      if (paths.length > 0) {
        result["radiologyImages"] = JSON.stringify(paths);
        if (!result["radiologyImageFilePathOrLink"] && paths[0]) {
          result["radiologyImageFilePathOrLink"] = paths[0];
        }
      }
      continue;
    }

    if (key === "age") {
      const n = parseFloat(val);
      if (!isNaN(n)) result[key] = n;
    } else if (key === "collectionDate" || key === "dateOfVisit") {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        result[key] = d.toISOString().slice(0, 10);
      } else {
        result[key] = val;
      }
    } else {
      result[key] = val;
    }
  }

  // Merge individual vital fields into vitalSigns (overrides combined field if both present)
  if (hasIndividualVitals) {
    result["vitalSigns"] = serializeVitals({
      BP:   vitalParts.BP   ?? "",
      RR:   vitalParts.RR   ?? "",
      Temp: vitalParts.Temp ?? "",
      HR:   vitalParts.HR   ?? "",
      O2:   vitalParts.O2   ?? "",
    });
  }

  return result;
}
