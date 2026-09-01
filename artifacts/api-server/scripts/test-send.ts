import "dotenv/config";
import { sendEmail } from "../src/lib/email";

async function main() {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const ok = await sendEmail({
    to: "khaledemadalmasri01@gmail.com",
    subject: "Your verification code",
    text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
  });
  console.log(ok ? "SEND_OK" : "SEND_NOOP");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("SEND_ERROR", e);
  process.exit(1);
});
