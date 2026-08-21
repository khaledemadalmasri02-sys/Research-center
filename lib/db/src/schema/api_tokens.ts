import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const API_TOKEN_SCOPES = [
  "read",
  "write",
  "records:read",
  "records:write",
  "feedback:read",
  "feedback:write",
  "admin",
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const apiTokensTable = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ApiToken = typeof apiTokensTable.$inferSelect;
export type NewApiToken = typeof apiTokensTable.$inferInsert;
