import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * Scopes an API token may hold.
 *
 * "admin" stays in this list because it is part of the STORED vocabulary:
 * tokens issued before the self-service escalation fix may still carry it,
 * and the stored value has to remain readable/resolvable. It is NOT
 * self-service requestable — `routes/tokens.ts` rejects it unless the
 * caller is already an admin, and `lib/apiToken.ts` only honours it when the
 * token's owner also has `canAdmin_access`. Keep it in the list; do not add
 * it back to the frontend's requestable scope picker.
 */
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
