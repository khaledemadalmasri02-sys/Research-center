import { format } from "date-fns";
import { parseVitals } from "@/lib/vitals-utils";

export type ExportPatient = {
  id: number;
  collectionName?: string | null;
  collectionDate?: string | null;
  collectionType?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  age?: number | null;
  sex?: string | null;
  dateOfVisit?: string | null;
  chiefComplaint?: string | null;
  vitalSigns?: string | null;
  historyTrauma?: string | null;
  mechanismOfInjuryAndLocalisation?: string | null;
  signsAndSymptomsTrauma?: string | null;
  historyMedical?: string | null;
  signsAndSymptomsMedical?: string | null;
  riskFactors?: string | null;
  provisionalDiagnosis?: string | null;
  radiologyImageFilePathOrLink?: string | null;
  radiologyImages?: string | null;
  emergencyReport?: string | null;
  aiPredictionOutput?: string | null;
  finalConfirmedDiagnosisAr?: string | null;
  finalConfirmedDiagnosis?: string | null;
  notes?: string | null;
};

function parseImagePaths(p: ExportPatient): string[] {
  if (p.radiologyImages) {
    try {
      const arr = JSON.parse(p.radiologyImages);
      if (Array.isArray(arr) && arr.length > 0) return arr as string[];
    } catch { /* fall through */ }
  }
  if (p.radiologyImageFilePathOrLink) return [p.radiologyImageFilePathOrLink];
  return [];
}

function toFetchUrl(path: string): string {
  if (path.startsWith("/objects/")) return `/api/storage${path}`;
  return path;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try { return format(new Date(d), "MMM d, yyyy"); } catch { return d; }
}

async function fetchImageBuffer(
  src: string
): Promise<{ buffer: ArrayBuffer; extension: "jpeg" | "png" | "gif" } | null> {
  try {
    const res = await fetch(src, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mt = blob.type || "image/jpeg";
    const extension = mt.includes("png") ? "png" : mt.includes("gif") ? "gif" : "jpeg";
    return { buffer: await blob.arrayBuffer(), extension };
  } catch {
    return null;
  }
}

const TEAL      = "FF0F766E";
const WHITE     = "FFFFFFFF";
const TEAL_LITE = "FFF0FDFA";
const BORDER_C  = "FFE2E8F0";

const BASE_COLS = [
  { header: "Collection Name",               key: "collectionName",       width: 22 },
  { header: "Date of Collection",          key: "collectionDate",       width: 18 },
  { header: "Collection Type",             key: "collectionType",       width: 16 },
  { header: "Patient ID",                  key: "patientId",            width: 14 },
  { header: "Patient Name",                key: "patientName",          width: 20 },
  { header: "Age",                         key: "age",                  width: 7  },
  { header: "Sex",                         key: "sex",                  width: 10 },
  { header: "Date of Visit",               key: "dateOfVisit",          width: 15 },
  { header: "Chief Complaint",             key: "chiefComplaint",       width: 28 },
  { header: "BP",                           key: "vitalBP",            width: 13 },
  { header: "RR",                           key: "vitalRR",            width: 10 },
  { header: "Temperature",                  key: "vitalTemp",          width: 13 },
  { header: "HR",                           key: "vitalHR",            width: 10 },
  { header: "O2 Sat",                       key: "vitalO2",            width: 10 },
  { header: "History (Trauma)",            key: "historyTrauma",        width: 25 },
  { header: "Mechanism of Injury",         key: "mechanism",            width: 25 },
  { header: "Signs & Symptoms (Trauma)",   key: "signsTrauma",          width: 28 },
  { header: "History (Medical)",           key: "historyMedical",       width: 25 },
  { header: "Signs & Symptoms (Medical)",  key: "signsMedical",         width: 28 },
  { header: "Risk Factors",                key: "riskFactors",          width: 22 },
  { header: "Provisional Diagnosis",       key: "provisionalDx",        width: 28 },
  { header: "Emergency Report",            key: "emergencyReport",      width: 28 },
  { header: "AI Prediction",               key: "aiPrediction",         width: 22 },
  { header: "Final Diagnosis (EN)",        key: "finalDxEn",            width: 28 },
  { header: "Final Diagnosis (AR)",        key: "finalDxAr",            width: 28 },
  { header: "Notes",                       key: "notes",                width: 25 },
];

const IMG_H = 90;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function borderAll(cell: any) {
  const s: any = { style: "thin", color: { argb: BORDER_C } };
  cell.border = { top: s, bottom: s, left: s, right: s };
}

let ExcelJS: any = null;

async function loadExcelJS(): Promise<any> {
  if (ExcelJS) return ExcelJS;
  ExcelJS = await import("exceljs");
  return ExcelJS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportToExcel(
  patients: ExportPatient[],
  filename = "patients"
): Promise<void> {
  const wb = await loadExcelJS();

  const maxImages = patients.reduce(
    (acc: number, p: ExportPatient) => Math.max(acc, parseImagePaths(p).length),
    1
  );

  const workbook = new wb.Workbook();
  workbook.creator = "MedResearch";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("Patients", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const imgPreviewCols = Array.from({ length: maxImages }, (_, i: number) => ({
    header: maxImages === 1 ? "Radiology Image" : `Image ${i + 1}`,
    key: `img_${i}`,
    width: 24,
  }));

  ws.columns = [...BASE_COLS, ...imgPreviewCols];

  const totalCols = BASE_COLS.length + maxImages;

  const hdr = ws.getRow(1);
  hdr.height = 30;
  hdr.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
    if (colNumber > totalCols) return;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    borderAll(cell);
  });

  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]!;
    const rowIdx = i + 2;
    const imgPaths = parseImagePaths(p);

    const imgCellData: Record<string, string> = {};
    for (let j = 0; j < maxImages; j++) {
      imgCellData[`img_${j}`] = "";
    }

    const row = ws.addRow({
      collectionName:   p.collectionName ?? "",
      collectionDate:   fmtDate(p.collectionDate),
      collectionType:   p.collectionType ?? "",
      patientId:        p.patientId ?? "",
      patientName:      p.patientName ?? "",
      age:              p.age ?? "",
      sex:              p.sex ?? "",
      dateOfVisit:      fmtDate(p.dateOfVisit),
      chiefComplaint:   p.chiefComplaint ?? "",
      vitalBP:          parseVitals(p.vitalSigns).BP,
      vitalRR:          parseVitals(p.vitalSigns).RR,
      vitalTemp:        parseVitals(p.vitalSigns).Temp,
      vitalHR:          parseVitals(p.vitalSigns).HR,
      vitalO2:          parseVitals(p.vitalSigns).O2,
      historyTrauma:    p.historyTrauma ?? "",
      mechanism:        p.mechanismOfInjuryAndLocalisation ?? "",
      signsTrauma:      p.signsAndSymptomsTrauma ?? "",
      historyMedical:   p.historyMedical ?? "",
      signsMedical:     p.signsAndSymptomsMedical ?? "",
      riskFactors:      p.riskFactors ?? "",
      provisionalDx:    p.provisionalDiagnosis ?? "",
      emergencyReport:  p.emergencyReport ?? "",
      aiPrediction:     p.aiPredictionOutput ?? "",
      finalDxEn:        p.finalConfirmedDiagnosis ?? "",
      finalDxAr:        p.finalConfirmedDiagnosisAr ?? "",
      notes:            p.notes ?? "",
      ...imgCellData,
    });

    row.height = IMG_H;

    row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
      if (colNumber > totalCols) return;
      if (i % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_LITE } };
      }
      cell.alignment = { vertical: "middle", wrapText: true };
      borderAll(cell);
    });

    for (let imgIdx = 0; imgIdx < imgPaths.length; imgIdx++) {
      const src = toFetchUrl(imgPaths[imgIdx]!);
      const img = await fetchImageBuffer(src);
      if (img) {
        const imgId = workbook.addImage({ buffer: img.buffer, extension: img.extension });
        ws.addImage(imgId, {
          tl: { col: BASE_COLS.length + imgIdx, row: rowIdx - 1 },
          ext: { width: 150, height: IMG_H - 6 },
          editAs: "oneCell",
        });
      }
    }
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}