import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const savedViewsTable = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  definitionId: integer("definition_id").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  sort: jsonb("sort").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedView = typeof savedViewsTable.$inferSelect;
export type NewSavedView = typeof savedViewsTable.$inferInsert;
