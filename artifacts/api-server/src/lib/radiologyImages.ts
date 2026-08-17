import { db, patientsTable, radiologyImagesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { s3Client, ObjectStorageService } from "./objectStorage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

const objectStorageService = new ObjectStorageService();

export interface RadiologyImageSummary {
  id: number;
  patientId: number;
  studyId: string | null;
  objectKey: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  etag: string | null;
  uploadTimestamp: string | null;
  url: string;
}

export interface AddImageInput {
  objectKey: string;
  studyId?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  etag?: string | null;
}

type RadiologyImageRow = typeof radiologyImagesTable.$inferSelect;

/**
 * Canonical store for a patient's radiology images. Each physical image is one
 * row in `radiology_images`, linked to the patient by the patients table id.
 * The patients.radiologyImages JSON array + radiologyImageFilePathOrLink
 * fields are kept as a denormalized cache for backwards compatibility.
 */
export class RadiologyImageService {
  /** Idempotently create the radiology_images table if it does not exist. */
  async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "radiology_images" (
        "id" serial PRIMARY KEY,
        "patient_id" integer NOT NULL,
        "study_id" text,
        "object_key" text NOT NULL,
        "original_filename" text,
        "mime_type" text,
        "file_size" integer,
        "etag" text,
        "upload_timestamp" timestamptz DEFAULT now(),
        "metadata" json
      );
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "idx_radiology_images_patient_id" ON "radiology_images" ("patient_id");`
    );
  }

  /** Resolve a patient by its textual patientId (e.g. "89373" or "PAT89373"). */
  async findPatientByPatientId(
    patientIdText: string
  ): Promise<{ id: number; patientId: string } | null> {
    const normalized = patientIdText.replace(/^PAT/i, "");
    const byExact = await db
      .select({ id: patientsTable.id, patientId: patientsTable.patientId })
      .from(patientsTable)
      .where(eq(patientsTable.patientId, patientIdText))
      .limit(1);
    if (byExact[0]) return byExact[0]!;
    if (normalized !== patientIdText) {
      const byNormalized = await db
        .select({ id: patientsTable.id, patientId: patientsTable.patientId })
        .from(patientsTable)
        .where(eq(patientsTable.patientId, normalized))
        .limit(1);
      if (byNormalized[0]) return byNormalized[0]!;
    }
    return null;
  }

  /** Link an object (already in S3) to a patient. Dedupes by (patientId, objectKey). */
  async addImage(patientRowId: number, input: AddImageInput): Promise<RadiologyImageSummary> {
    const existing = await db
      .select({ id: radiologyImagesTable.id })
      .from(radiologyImagesTable)
      .where(
        and(
          eq(radiologyImagesTable.patientId, patientRowId),
          eq(radiologyImagesTable.objectKey, input.objectKey)
        )
      )
      .limit(1);

    if (existing[0]) {
      const row = await this.getRow(existing[0]!.id);
      if (row) return this.toSummary(row);
    }

    const [row] = await db
      .insert(radiologyImagesTable)
      .values({
        patientId: patientRowId,
        studyId: input.studyId ?? null,
        objectKey: input.objectKey,
        originalFilename: input.originalFilename ?? null,
        mimeType: input.mimeType ?? null,
        fileSize: input.fileSize ?? null,
        etag: input.etag ?? null,
      })
      .returning();

    await this.syncPatientCache(patientRowId);
    return this.toSummary(row!);
  }

  async listImages(patientRowId: number): Promise<RadiologyImageSummary[]> {
    const rows = await db
      .select()
      .from(radiologyImagesTable)
      .where(eq(radiologyImagesTable.patientId, patientRowId))
      .orderBy(desc(radiologyImagesTable.uploadTimestamp));
    return rows.map((r) => this.toSummary(r));
  }

  async removeImage(imageId: number, opts: { deleteObject?: boolean } = {}): Promise<void> {
    const [row] = await db
      .select()
      .from(radiologyImagesTable)
      .where(eq(radiologyImagesTable.id, imageId))
      .limit(1);
    if (!row) return;

    if (opts.deleteObject) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: objectStorageService.getBucket(),
            Key: row.objectKey,
          })
        );
      } catch {
        // best-effort: ignore S3 deletion errors
      }
    }

    await db.delete(radiologyImagesTable).where(eq(radiologyImagesTable.id, imageId));
    await this.syncPatientCache(row.patientId);
  }

  /** Recompute patients.radiologyImages (JSON array of keys) and
   *  radiologyImageFilePathOrLink (first key) from radiology_images rows. */
  async syncPatientCache(patientRowId: number): Promise<void> {
    const rows = await db
      .select({ objectKey: radiologyImagesTable.objectKey })
      .from(radiologyImagesTable)
      .where(eq(radiologyImagesTable.patientId, patientRowId))
      .orderBy(desc(radiologyImagesTable.uploadTimestamp));

    const keys = rows.map((r) => r.objectKey);

    await db
      .update(patientsTable)
      .set({
        radiologyImages: keys.length ? JSON.stringify(keys) : null,
        radiologyImageFilePathOrLink: keys[0] ?? null,
        updatedAt: new Date(),
      })
      .where(eq(patientsTable.id, patientRowId));
  }

  private async getRow(id: number): Promise<RadiologyImageRow | null> {
    const [row] = await db
      .select()
      .from(radiologyImagesTable)
      .where(eq(radiologyImagesTable.id, id))
      .limit(1);
    return row ?? null;
  }

  private toSummary(row: RadiologyImageRow): RadiologyImageSummary {
    return {
      id: row.id,
      patientId: row.patientId,
      studyId: row.studyId ?? null,
      objectKey: row.objectKey,
      originalFilename: row.originalFilename ?? null,
      mimeType: row.mimeType ?? null,
      fileSize: row.fileSize ?? null,
      etag: row.etag ?? null,
      uploadTimestamp: row.uploadTimestamp ? new Date(row.uploadTimestamp).toISOString() : null,
      url: row.objectKey.startsWith("http")
        ? row.objectKey
        : `/api/storage/objects/${row.objectKey}`,
    };
  }
}

export const radiologyImageService = new RadiologyImageService();
