import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import { db, patientsTable } from "@workspace/db";
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

const router: IRouter = Router();

function serializePatient<T extends { createdAt: Date | string; updatedAt: Date | string }>(p: T) {
  return {
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };
}

const VALID_COLLECTION_TYPES = new Set(["Normal", "Abnormal", "Suspicious"]);
const VALID_SEX              = new Set(["Male", "Female", "Other"]);

/** Coerce/sanitise patient data so type mismatches from Excel imports never
 *  reach the DB.  Any field that can't be coerced is dropped (set to null). */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  // age must be a non-negative integer
  if (out.age != null) {
    const n = Number(out.age);
    out.age = !isNaN(n) && n >= 0 ? Math.round(n) : null;
  }

  // collectionType must be one of the three enum values
  if (out.collectionType != null && !VALID_COLLECTION_TYPES.has(out.collectionType as string)) {
    out.collectionType = null;
  }

  // sex must be one of the three enum values
  if (out.sex != null && !VALID_SEX.has(out.sex as string)) {
    out.sex = null;
  }

  // date fields: store only valid ISO date strings; drop garbage
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

router.get("/patients", async (req, res): Promise<void> => {
  const parsed = ListPatientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, sex, collectionType, limit = 100, offset = 0 } = parsed.data;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(patientsTable.patientId, `%${search}%`),
        ilike(patientsTable.patientName, `%${search}%`),
        ilike(patientsTable.chiefComplaint, `%${search}%`),
        ilike(patientsTable.provisionalDiagnosis, `%${search}%`),
        ilike(patientsTable.finalConfirmedDiagnosis, `%${search}%`)
      )
    );
  }
  if (sex) conditions.push(eq(patientsTable.sex, sex));
  if (collectionType) conditions.push(eq(patientsTable.collectionType, collectionType));

  const patients = await db
    .select()
    .from(patientsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(patientsTable.createdAt))
    .limit(limit ?? 100)
    .offset(offset ?? 0);

  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientsTable)
    .then((r) => r[0]?.count ?? 0);

  res.json(ListPatientsResponse.parse({ patients: patients.map(serializePatient), total }));
});

router.post("/patients", async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [patient] = await db.insert(patientsTable).values(sanitize(parsed.data as Record<string, unknown>) as typeof parsed.data).returning();

  res.status(201).json(GetPatientResponse.parse(serializePatient(patient!)));
});

router.get("/patients/stats", async (_req, res): Promise<void> => {
  const allPatients = await db.select().from(patientsTable);

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

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, params.data.id));

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

  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid update body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Sanitise type mismatches (e.g. float age from Excel) then strip nulls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = Object.fromEntries(
    Object.entries(sanitize(parsed.data as Record<string, unknown>)).filter(([, v]) => v !== null)
  );

  const [patient] = await db
    .update(patientsTable)
    .set(updateData)
    .where(eq(patientsTable.id, params.data.id))
    .returning();

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

  const [patient] = await db
    .delete(patientsTable)
    .where(eq(patientsTable.id, params.data.id))
    .returning();

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
