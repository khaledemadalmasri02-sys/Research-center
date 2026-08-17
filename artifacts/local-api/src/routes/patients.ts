import { Router, type IRouter } from "express";
import {
  ListPatientsQueryParams,
  ListPatientsResponse,
  CreatePatientBody,
  GetPatientParams,
  GetPatientResponse,
  UpdatePatientParams,
  UpdatePatientBody,
  UpdatePatientResponse,
  DeletePatientParams,
  GetPatientStatsResponse,
} from "@workspace/api-zod";
import type { Patient } from "../db/memory";
import { getAllPatients, getPatient, createPatient, updatePatient, deletePatient } from "../db/memory";

const router: IRouter = Router();

const VALID_COLLECTION_TYPES = new Set(["Normal", "Abnormal", "Suspicious"]);
const VALID_SEX = new Set(["Male", "Female", "Other"]);

function preprocess(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };

  if (Array.isArray(out.radiologyImages)) {
    out.radiologyImages = JSON.stringify(out.radiologyImages);
  }

  if (!out.radiologyImageFilePathOrLink && out.radiologyImages && typeof out.radiologyImages === "string") {
    try {
      const paths = JSON.parse(out.radiologyImages);
      if (Array.isArray(paths) && paths[0]) {
        out.radiologyImageFilePathOrLink = String(paths[0]);
      }
    } catch {
      if (!out.radiologyImageFilePathOrLink) {
        out.radiologyImageFilePathOrLink = out.radiologyImages;
      }
    }
  }

  return out;
}

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  if (out.age != null) {
    const n = Number(out.age);
    out.age = !isNaN(n) && n >= 0 ? Math.round(n) : null;
  }

  if (out.collectionType != null && !VALID_COLLECTION_TYPES.has(out.collectionType as string)) {
    out.collectionType = null;
  }

  if (out.sex != null && !VALID_SEX.has(out.sex as string)) {
    out.sex = null;
  }

  for (const f of ["collectionDate", "dateOfVisit"] as const) {
    const v = out[f];
    if (v != null && v !== "") {
      try {
        const d = new Date(v as string);
        if (isNaN(d.getTime())) out[f] = null;
      } catch {
        out[f] = null;
      }
    }
  }

  return out;
}

function serializePatient(p: Patient) {
  return {
    ...p,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function matchesSearch(patient: Patient, search: string): boolean {
  const lower = search.toLowerCase();
  return (
    (patient.patientId ?? "").toLowerCase().includes(lower) ||
    (patient.patientName ?? "").toLowerCase().includes(lower) ||
    (patient.chiefComplaint ?? "").toLowerCase().includes(lower) ||
    (patient.provisionalDiagnosis ?? "").toLowerCase().includes(lower) ||
    (patient.finalConfirmedDiagnosis ?? "").toLowerCase().includes(lower)
  );
}

router.get("/patients", async (req, res): Promise<void> => {
  const parsed = ListPatientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, sex, collectionType, limit = 100, offset: rawOffset = 0 } = parsed.data;

  let patients = getAllPatients();

  if (search) {
    patients = patients.filter((p) => matchesSearch(p, search));
  }
  if (sex) {
    patients = patients.filter((p) => p.sex === sex);
  }
  if (collectionType) {
    patients = patients.filter((p) => p.collectionType === collectionType);
  }

  const total = patients.length;
  const offset = rawOffset ?? 0;
  const lim = limit ?? 100;
  patients = patients.slice(offset, offset + lim);

  res.json(ListPatientsResponse.parse({ patients: patients.map(serializePatient), total }));
});

router.post("/patients", async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const patient = createPatient(sanitize(parsed.data as Record<string, unknown>) as Omit<Patient, "id" | "createdAt" | "updatedAt">);

  res.status(201).json(GetPatientResponse.parse(serializePatient(patient)));
});

router.get("/patients/stats", async (_req, res): Promise<void> => {
  const allPatients = getAllPatients();

  const total = allPatients.length;
  const maleCount = allPatients.filter((p) => p.sex === "Male").length;
  const femaleCount = allPatients.filter((p) => p.sex === "Female").length;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCount = allPatients.filter(
    (p) => new Date(p.createdAt) > thirtyDaysAgo
  ).length;

  const diagnosisMap = new Map<string, number>();
  for (const p of allPatients) {
    const diag = p.finalConfirmedDiagnosis || p.provisionalDiagnosis;
    if (diag) {
      diagnosisMap.set(diag, (diagnosisMap.get(diag) ?? 0) + 1);
    }
  }

  const diagnosisCounts = Array.from(diagnosisMap.entries())
    .map(([diagnosis, count]) => ({ diagnosis, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const ageBrackets: { bracket: string; count: number }[] = [
    { bracket: "0-17", count: 0 },
    { bracket: "18-29", count: 0 },
    { bracket: "30-44", count: 0 },
    { bracket: "45-59", count: 0 },
    { bracket: "60-74", count: 0 },
    { bracket: "75+", count: 0 },
  ];

  for (const p of allPatients) {
    if (p.age != null) {
      if (p.age <= 17) ageBrackets[0]!.count++;
      else if (p.age <= 29) ageBrackets[1]!.count++;
      else if (p.age <= 44) ageBrackets[2]!.count++;
      else if (p.age <= 59) ageBrackets[3]!.count++;
      else if (p.age <= 74) ageBrackets[4]!.count++;
      else ageBrackets[5]!.count++;
    }
  }

  const collectionTypeMap = new Map<string, number>();
  for (const p of allPatients) {
    const t = p.collectionType ?? "Unspecified";
    collectionTypeMap.set(t, (collectionTypeMap.get(t) ?? 0) + 1);
  }
  const collectionTypeCounts = Array.from(collectionTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  res.json(
    GetPatientStatsResponse.parse({
      total,
      maleCount,
      femaleCount,
      recentCount,
      diagnosisCounts,
      ageBrackets,
      collectionTypeCounts,
    })
  );
});

router.get("/patients/:id", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const patient = getPatient(params.data.id);

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  res.json(GetPatientResponse.parse(serializePatient(patient)));
});

router.patch("/patients/:id", async (req, res): Promise<void> => {
  const params = UpdatePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const patient = updatePatient(params.data.id, sanitize(parsed.data as Record<string, unknown>));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  res.json(UpdatePatientResponse.parse(serializePatient(patient)));
});

router.delete("/patients/:id", async (req, res): Promise<void> => {
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const patient = deletePatient(params.data.id);

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;