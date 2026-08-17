import { serializeVitals, type VitalFields } from "@/lib/vitals-utils";
export { filterImportRows } from "@/lib/import-filter";

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
  | "radiologyImages"
  | "imageId";

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
  imageId:                          "Image ID (auto-detect)",
};

export const REQUIRED_FIELDS: ImportableField[] = ["patientId", "patientName"];

const ALIASES: Array<[string[], ImportableField]> = [
  [["collectionname","collection","studyname","studyset","dataset","study","cohort"],    "collectionName"],
  [["dateofcollection","collectiondate","studydate","colldate"],                         "collectionDate"],
  [["collectiontype","colltype","type","category","studytype"],                          "collectionType"],
  [["patientid","patid","pid","caseid","casenumber","case","id",
     "no","num","number","serial","serialno","serialnumber","snumber",
     "mrno","mrnumber","mrnum","mr","uhid","regid","regno","regnumber",
     "registrationnumber","registrationno","hospitalid","hospitalnum",
     "admissionid","admissionno","recordno","recordnumber","visitid",
     "fileno","filenumber","chartno","chartnumber","casereferral",
     "referralno","caseno"],                                                             "patientId"],
  [["patientname","name","fullname","patient","ptname","ptfullname",
     "patname","clientname","subjectname","participantname",
     "firstname","lastname","fullnameofpatient","nameofpatient",
     "subject","participant"],                                                            "patientName"],
  [["age","patientage","ageyears","ageatvisit","ageinyears"],                            "age"],
  [["sex","gender","patientgender","patientsex","m/f"],                                  "sex"],
  [["dateofvisit","visitdate","admissiondate","dateadmitted","admitdate","visitdt"],     "dateOfVisit"],
  [["chiefcomplaint","complaint","presentingcomplaint","cc","maincomplaint",
     "reasonforvisit","chiefpresentation","presenting"],                                 "chiefComplaint"],
  [["vitalsigns","vitals","vs","vitalparameters","parameters"],                          "vitalSigns"],
  [["bp","bloodpressure","systolicdiastolic","bpmmhg","systolicbp",
     "diastolicbp","bloodpressuremmhg"],                                                 "vitalBP"],
  [["rr","respiratoryrate","breathsmin","resprate","breathingrate"],                     "vitalRR"],
  [["temperature","temp","temperaturec","bodytemp","bodytemperature","tempcelsius"],     "vitalTemp"],
  [["hr","heartrate","pulse","bpm","pulserate","heartbpm"],                             "vitalHR"],
  [["o2sat","o2saturation","o2","spo2","oxygensaturation","oxygensat",
     "o2percent","spo2percent"],                                                         "vitalO2"],
  [["historytrauma","traumahistory","injuryhistory","trauma","hxtrauma"],                "historyTrauma"],
  [["mechanismofinjury","mechanism","moi","injurymechanism","localization",
     "mechanismofinjuryandlocalisation","mechanismanddistribution"],                    "mechanismOfInjuryAndLocalisation"],
  [["signssymptomstrauma","signsandsymptomsoftrauma","symptomsoftrauma",
     "traumasymptoms","sxtrauma"],                                                       "signsAndSymptomsTrauma"],
  [["historymedical","medicalhistory","pmhx","pastmedical","hxmedical","pmh"],          "historyMedical"],
  [["signssymptomsmedical","medicalsymptoms","signsandsymptomsmedical","sxmedical"],    "signsAndSymptomsMedical"],
  [["riskfactors","risks","riskfactor","comorbidities","comorbidity"],                  "riskFactors"],
  [["provisionaldiagnosis","provisionaldx","workingdiagnosis","workingdx","impression",
     "probablediagnosis","clinicalimpression","initialdx","initialdx"],                 "provisionalDiagnosis"],
  [["emergencyreport","emergreport","erreport","report","emergencyassessment"],          "emergencyReport"],
  [["aiprediction","aipredictionoutput","ai","airesult","aidiagnosis","mlresult"],      "aiPredictionOutput"],
  [["finaldiagnosisen","finaldiagnosis","confirmeddiagnosis","diagnosis","dx",
     "finalconfirmeddiagnosis","definitivediagnosis","confirmeddx"],                    "finalConfirmedDiagnosis"],
  [["finaldiagnosisar","arabicdiagnosis","diagnosisarabic","finalardiagnosis",
     "finalconfirmeddiagnosisar","diagnosisinarabic"],                                  "finalConfirmedDiagnosisAr"],
  [["notes","note","comment","comments","remarks","additionalinfo","clinicalnotes"],    "notes"],
  [["radiologyimage","imagelink","imagelinkpath","radiologyimagefilepathlink",
     "radiologyimagefilepathOrlink","imagepath","imageurl","radiologylink",
     "photo","patientphoto","picture","img","imgurl","photourl","pictureurl",
     "imageaddress","photopath","picturepath","xray","xrayimage","scanimage",
     "ctimage","mriimage","medicalimage","medicalphoto"],                               "radiologyImageFilePathOrLink"],
  [["imagepaths","allimagepaths","allimages","radiologyimages","imagefiles",
     "photos","pictures","imageurls","photourls","allphotos","multiphotos",
     "imagelist","photolist","xrays","scanimages"],                                    "radiologyImages"],
  [["imageid","imaged","imagineid","scanid","studyid","examid","examnum",
     "examd","imageidentifier","imageidentifier"],                                        "imageId"],
];

const VITAL_DEFAULTS: VitalFields = {
  BP:   "120/80",
  RR:   "16",
  Temp: "37.0",
  HR:   "80",
  O2:   "98",
};

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function detectField(header: string): ImportableField | null {
  const n = normalise(header);
  if (!n) return null;

  for (const key of Object.keys(FIELD_LABELS) as ImportableField[]) {
    if (normalise(key) === n) return key;
  }

  for (const [key, label] of Object.entries(FIELD_LABELS) as [ImportableField, string][]) {
    if (normalise(label) === n) return key as ImportableField;
  }

  for (const [aliases, field] of ALIASES) {
    if (aliases.includes(n)) return field;
  }

  if (/^(image|radiologyimage|radiology|photo|picture|scan|xray)\d+$/.test(n)) {
    return "radiologyImages";
  }

  return null;
}

export type ColumnMap  = { header: string; field: ImportableField | null; colIdx: number };
export type ParsedImport = {
  columnMap:  ColumnMap[];
  rows:       Record<ImportableField, string>[];
  rawRows:    Record<string, string>[];
  skippedHeaders: string[];
  headerRowIndex: number;
};

function excelSerialToISO(serial: number): string | null {
  try {
    const excelEpoch = new Date(Date.UTC(1899, 11, 31));
    const adjusted   = serial > 59 ? serial - 1 : serial;
    const date = new Date(excelEpoch.getTime() + adjusted * 86400000);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function parseDateValue(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (!trimmed) return "";

  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* fall through */ }

  const asNum = Number(trimmed);
  if (Number.isInteger(asNum) && asNum > 0 && asNum < 200000) {
    const iso = excelSerialToISO(asNum);
    if (iso) return iso;
  }

  const dmy = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    const year = yy!.length === 2 ? `20${yy}` : yy!;
    try {
      const d = new Date(`${year}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch { /* fall through */ }
  }

  return "";
}

type XLSXModule = typeof import("xlsx");
let XLSX: XLSXModule | null = null;

async function loadXLSX(): Promise<XLSXModule> {
  if (XLSX) return XLSX;
  XLSX = await import("xlsx");
  return XLSX;
}

function cellToString(cell: { t?: string; v?: unknown; w?: unknown } | undefined): string {
  if (!cell) return "";
  try {
    if (cell.t === "d") {
      const v = cell.v;
      if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    }
    if (cell.t === "n") {
      const w = String(cell.w ?? "").trim();
      if (w && w !== "Invalid Date" && !/^#+$/.test(w)) return w;
      return String(cell.v ?? "").trim();
    }
    return String(cell.w ?? cell.v ?? "").trim();
  } catch {
    return "";
  }
}

async function scoreRow(ws: Record<string, { t?: string; v?: unknown; w?: unknown }>, rowIdx: number, cStart: number, cEnd: number, xlsx: XLSXModule): Promise<number> {
  let score = 0;
  for (let c = cStart; c <= cEnd; c++) {
    const key = xlsx.utils.encode_cell({ r: rowIdx, c });
    const val = cellToString(ws[key]);
    if (val && detectField(val) !== null) score++;
  }
  return score;
}

export async function parseExcelFile(file: File): Promise<ParsedImport> {
  const xlsx = await loadXLSX();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw  = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(raw);
        const wb   = xlsx.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error("Empty workbook");
        const ws = wb.Sheets[sheetName]!;

        const range = xlsx.utils.decode_range(ws["!ref"] ?? "A1");

        const scanEnd = Math.min(range.s.r + 9, range.e.r);
        let headerRowIndex = range.s.r;
        let bestScore = -1;
        
        const scores: number[] = [];
        for (let r = range.s.r; r <= scanEnd; r++) {
          scoreRow(ws, r, range.s.c, range.e.c, xlsx).then(s => {
            scores[r] = s;
            if (s > bestScore) { bestScore = s; headerRowIndex = r; }
          });
        }

        const columnMap: ColumnMap[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const key = xlsx.utils.encode_cell({ r: headerRowIndex, c });
          const val = cellToString(ws[key]);
          if (!val) continue;
          columnMap.push({ header: val, field: detectField(val), colIdx: c });
        }

        const rows: Record<ImportableField, string>[]    = [];
        const rawRows: Record<string, string>[]          = [];

        for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
          const mapped   = {} as Record<ImportableField, string>;
          const raw: Record<string, string> = {};
          let hasValue = false;

          for (const col of columnMap) {
            const key = xlsx.utils.encode_cell({ r, c: col.colIdx });
            const val = cellToString(ws[key]);
            raw[col.header] = val;
            if (col.field) mapped[col.field] = val;
            if (val) hasValue = true;
          }

          if (hasValue) {
            rows.push(mapped);
            rawRows.push(raw);
          }
        }

        const skippedHeaders = columnMap.filter((c) => !c.field).map((c) => c.header);
        resolve({ columnMap, rows, rawRows, skippedHeaders, headerRowIndex });
      } catch (err) {
        reject(new Error((err as Error).message || "Failed to parse Excel file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

export function applyColumnMapping(
  rawRows: Record<string, string>[],
  mapping: Record<string, ImportableField | null>
): Record<ImportableField, string>[] {
  const MULTI_JOIN_FIELDS = new Set<ImportableField>([
    "radiologyImages",
    "radiologyImageFilePathOrLink",
  ]);

  return rawRows.map((rawRow) => {
    const result = {} as Record<ImportableField, string>;
    for (const [header, field] of Object.entries(mapping)) {
      if (!field) continue;
      const val = (rawRow[header] ?? "").trim();
      if (!val) continue;

      if (MULTI_JOIN_FIELDS.has(field) && result[field]) {
        result[field] = `${result[field]} | ${val}`;
      } else if (!(field in result)) {
        result[field] = val;
      }
    }
    return result;
  });
}

export function rowToPatient(row: Record<ImportableField, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const vitalParts: Partial<VitalFields> = {};
  let hasIndividualVitals = false;
  let hasCombinedVitals   = false;

  for (const [key, rawVal] of Object.entries(row) as [ImportableField, string][]) {
    const val = String(rawVal ?? "").trim();

    if (key === "vitalBP")   { if (val) { vitalParts.BP   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalRR")   { if (val) { vitalParts.RR   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalTemp") { if (val) { vitalParts.Temp = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalHR")   { if (val) { vitalParts.HR   = val; hasIndividualVitals = true; } continue; }
    if (key === "vitalO2")   { if (val) { vitalParts.O2   = val; hasIndividualVitals = true; } continue; }

    if (key === "vitalSigns") {
      if (val) { result["vitalSigns"] = val; hasCombinedVitals = true; }
      continue;
    }

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

    if (key === "age") {
      if (!val) continue;
      const n = parseFloat(val);
      if (!isNaN(n) && n >= 0) result[key] = Math.round(n);
      continue;
    }

    if (key === "collectionDate" || key === "dateOfVisit") {
      if (!val) continue;
      const iso = parseDateValue(val);
      if (iso) result[key] = iso;
      continue;
    }

    if (key === "sex") {
      if (!val) continue;
      const lower = val.toLowerCase();
      if (lower === "m" || lower.startsWith("mal")) result[key] = "Male";
      else if (lower === "f" || lower.startsWith("fem")) result[key] = "Female";
      else result[key] = "Other";
      continue;
    }

    if (key === "collectionType") {
      if (!val) continue;
      const lower = val.toLowerCase();
      if (lower.startsWith("normal")) result[key] = "Normal";
      else if (lower.startsWith("abnormal")) result[key] = "Abnormal";
      else if (lower.startsWith("suspicious")) result[key] = "Suspicious";
      else result[key] = val;
      continue;
    }

    if (key === "imageId") {
      if (!val) continue;
      result[key] = val;
      continue;
    }

    if (val) result[key] = val;
  }

  if (hasIndividualVitals) {
    result["vitalSigns"] = serializeVitals({
      BP:   vitalParts.BP   ?? VITAL_DEFAULTS.BP,
      RR:   vitalParts.RR   ?? VITAL_DEFAULTS.RR,
      Temp: vitalParts.Temp ?? VITAL_DEFAULTS.Temp,
      HR:   vitalParts.HR   ?? VITAL_DEFAULTS.HR,
      O2:   vitalParts.O2   ?? VITAL_DEFAULTS.O2,
    });
  }

  return result;
}