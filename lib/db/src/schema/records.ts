import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

export const recordDefinitionsTable = pgTable("record_definitions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  fields: jsonb("fields").notNull().default([]), // FieldDef[]
  shared: boolean("shared").notNull().default(false),
  isActive: boolean("isActive").notNull().default(false),
  isDefault: boolean("isDefault").notNull().default(false),
  deactivated: boolean("deactivated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const recordsTable = pgTable("records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  definitionId: integer("definition_id").notNull(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const recordImagesTable = pgTable("record_images", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull(),
  fieldKey: text("field_key").notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecordDefinition = typeof recordDefinitionsTable.$inferSelect;
export type RecordRow = typeof recordsTable.$inferSelect;
export type RecordImage = typeof recordImagesTable.$inferSelect;

export const RECORD_FIELD_TYPES = ["text", "number", "date", "select", "textarea", "image"] as const;
export type RecordFieldType = (typeof RECORD_FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: RecordFieldType;
  options?: string[];
  required?: boolean;
}
