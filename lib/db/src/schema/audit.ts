import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(), // e.g. "auth.login", "admin.user.create"
  entity: text("entity"), // e.g. "user", "signup_request", "patient"
  entityId: integer("entity_id"),
  detail: jsonb("detail"), // arbitrary structured metadata
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
