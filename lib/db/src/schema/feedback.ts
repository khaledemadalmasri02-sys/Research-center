import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const FEEDBACK_TYPES = ["general", "bug", "feature", "complaint", "praise"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ["new", "reviewed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull().default("general"), // FeedbackType
  message: text("message").notNull(),
  rating: integer("rating"), // 1-5, optional
  status: text("status").notNull().default("new"), // FeedbackStatus
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedbackRow = typeof feedbackTable.$inferSelect;
