import { pgTable, text, serial, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const radiologyImagesTable = pgTable("radiology_images", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull(),
  studyId: text("study_id"),
  objectKey: text("object_key").notNull(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  etag: text("etag"),
  uploadTimestamp: timestamp("upload_timestamp", { withTimezone: true }).defaultNow(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
});

export const insertRadiologyImageSchema = createInsertSchema(radiologyImagesTable).omit({
  id: true,
  uploadTimestamp: true,
});
export type InsertRadiologyImage = z.infer<typeof insertRadiologyImageSchema>;
export type RadiologyImage = typeof radiologyImagesTable.$inferSelect;