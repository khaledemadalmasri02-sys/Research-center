import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // e.g. "signup.approved", "feedback.reviewed"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"), // optional in-app route
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type NewNotification = typeof notificationsTable.$inferInsert;
