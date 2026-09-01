import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

// Short-lived challenges created when a user passes password validation but
// still needs to complete email-based 2FA (OTP) before a session is granted.
export const loginChallengesTable = pgTable("login_challenges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LoginChallenge = typeof loginChallengesTable.$inferSelect;
