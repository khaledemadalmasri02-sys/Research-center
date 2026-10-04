import { pgTable, text, serial, timestamp, integer, boolean, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name"),
  email: text("email"),
  role: text("role").notNull().default("editor"), // 'viewer' | 'editor' | 'admin'
  canAdminAccess: boolean("can_admin_access").notNull().default(false),
  status: text("status").notNull().default("active"), // 'active' | 'pending' | 'suspended'
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  otpCodeHash: text("otp_code_hash"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  // ---- MFA (TOTP) ----
  // The shared secret is stored SEALED (AES-256-GCM, see lib/security.ts
  // `encryptSecret`), never in the clear, because a `text` column in a Postgres
  // dump or backup is otherwise a ready-made TOTP seed. `mfaPendingSecretEnc`
  // holds the secret of an enrolment that has been started but not confirmed:
  // without it, `/auth/mfa/enroll` would have to trust a client-supplied secret
  // at confirm time, which would let anyone point the account at a secret they
  // control.
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  // Highest TOTP counter value already accepted for this user. TOTP has a +/-
  // 1 step window, so without this the same 6-digit code would be replayable
  // for another 30-90 seconds. Claimed with a conditional UPDATE
  // (`WHERE totp_last_used_step IS NULL OR totp_last_used_step < $step`) so a
  // concurrent replay of the same code loses.
  totpLastUsedStep: bigint("totp_last_used_step", { mode: "number" }),
  // Attempt counter for the MFA challenge, exactly like `otp_attempts` for the
  // e-mail OTP: incremented by a conditional UPDATE so N concurrent wrong codes
  // cannot race past the cap.
  mfaAttempts: integer("mfa_attempts").notNull().default(0),
  // Admin-set per-user MFA requirement. NOT applied to existing accounts by
  // default — see the rollout note in the report. `totp_enabled_at` being set is
  // what actually enables the challenge at login.
  mfaRequired: boolean("mfa_required").notNull().default(false),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const signupRequestsTable = pgTable("signup_requests", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name"),
  email: text("email"),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Email verification (signup OTP).
  emailVerified: boolean("email_verified").notNull().default(false),
  otpCodeHash: text("otp_code_hash"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const oauthIdentitiesTable = pgTable(
  "oauth_identities",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(), // 'google' | 'apple'
    providerUserId: text("provider_user_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    email: text("email"),
    name: text("name"),
    providerEmailVerified: boolean("provider_email_verified").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    providerUserUnique: uniqueIndex("oauth_identities_provider_user_unique").on(table.provider, table.providerUserId),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type SignupRequest = typeof signupRequestsTable.$inferSelect;

// ---- Password reset ---------------------------------------------------------
// One row per issued reset token.
//
// Kept in this file (rather than a new `password-reset-tokens.ts`) because it is
// an auth-credential table keyed by `user_id`, exactly like `signup_requests`
// and `login_challenges` — a single place to read for "what auth state does
// this row carry".
//
// `tokenHash` is the salted `sha256$<salt>$<HMAC>` value (never reversible);
// `lookupHash` is a plain SHA-256 of the token used ONLY to find the row for an
// incoming token, the same trick `login_challenges.token_hash` already uses for
// login challenges. See lib/security.ts for why both are needed.
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    lookupHash: text("lookup_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupUnique: uniqueIndex("password_reset_tokens_lookup_unique").on(table.lookupHash),
    userIdx: index("password_reset_tokens_user_idx").on(table.userId),
  }),
);

// ---- MFA recovery codes -----------------------------------------------------
// 8 single-use codes per enrolment, stored as `sha256$<salt>$<HMAC>`. One row
// per code so a consumption is a single conditional DELETE
// (`WHERE used_at IS NULL RETURNING id`) — race-free, no read-then-write.
export const mfaRecoveryCodesTable = pgTable(
  "mfa_recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("mfa_recovery_codes_user_idx").on(table.userId),
  }),
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
export type MfaRecoveryCode = typeof mfaRecoveryCodesTable.$inferSelect;
