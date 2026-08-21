interface EmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Sends an email via SMTP, but only if SMTP_HOST is configured. Returns false
// (no-op) when mail is not configured so the app runs without email in dev.
export async function sendEmail(input: EmailInput): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@medresearch.local",
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return true;
}
