import { db, notificationsTable } from "@workspace/db";
import { sendEmail } from "./email";

interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

// Inserts an in-app notification. Email is best-effort and only sent when the
// target user has an email address and SMTP is configured.
export async function notify(userId: number, input: NotifyInput, email?: string | null): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      link: input.link ?? null,
    });
  } catch (err) {
    console.error("[notify] insert failed", err);
  }

  if (email) {
    try {
      await sendEmail({ to: email, subject: input.title, text: input.body ?? input.title });
    } catch (err) {
      console.error("[notify] email failed", err);
    }
  }
}
