import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Uploaded or query-built datasets used by the Analysis (SPSS) feature.
 * Raw uploaded files are stored in private MinIO; metadata lives here.
 */
export const analysisDatasetsTable = pgTable("analysis_datasets", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source").notNull().default("upload"), // 'upload' | 'query'
  format: text("format").notNull().default("csv"), // 'csv' | 'xlsx' | 'sav' | 'db'
  rowCount: integer("row_count").notNull().default(0),
  objectKey: text("object_key"), // private MinIO key for the raw file (null for db-sourced)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(
    () => new Date(),
  ),
});

export const analysisVariablesTable = pgTable("analysis_variables", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id")
    .notNull()
    .references(() => analysisDatasetsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label"),
  dataType: text("data_type").notNull().default("numeric"), // 'numeric' | 'string' | 'date'
  measure: text("measure").notNull().default("scale"), // 'scale' | 'ordinal' | 'nominal'
  missingValues: jsonb("missing_values").$type<(number | string)[] | null>(),
  valueLabels: jsonb("value_labels").$type<Record<string, string> | null>(),
});

export const analysisRunsTable = pgTable("analysis_runs", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id")
    .notNull()
    .references(() => analysisDatasetsTable.id, { onDelete: "cascade" }),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'descriptive' | 'ttest' | 'anova' | 'chisquare' | 'correlation' | 'regression'
  config: jsonb("config").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnalysisDataset = typeof analysisDatasetsTable.$inferSelect;
export type AnalysisVariable = typeof analysisVariablesTable.$inferSelect;
export type AnalysisRun = typeof analysisRunsTable.$inferSelect;
