/**
 * The enrolment "media slot" — the one place a QR code will ever live.
 *
 * ===========================================================================
 * WHY THIS COMPONENT EXISTS INSTEAD OF A `<img>` SOMEWHERE IN THE PAGE
 * ===========================================================================
 * There is NO QR library in the dependency tree and adding one is not an
 * option, so the current rendering is manual entry: a base32 secret, the
 * `otpauth://` URI, and an instruction telling the user to type it into their
 * authenticator app.
 *
 * The trap with "we'll add the QR later" is that it normally gets added *in
 * addition* to the manual path, at a different size, in a different place, with
 * a different set of instructions — and the user then has two conflicting ways
 * to do one thing.
 *
 * So the slot is explicit about its two states and keeps the manual path in both:
 *
 *   - `qr == null`  → the slot renders the manual entry directly. This is
 *                     today's build.
 *   - `qr != null`  → the slot renders the image, and the manual entry moves
 *                     into a `<details>` beneath it labelled "enter it
 *                     manually instead". Same markup, same copy buttons, same
 *                     instruction — it is the same component, not a rewrite.
 *
 * Dropping a QR in later is therefore a one-prop change at the call site and
 * zero changes below this file. The `data-mfa-media-slot` attribute exists so a
 * test (or a human) can assert the slot is present in both states.
 */
import { QrCode, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CopyField, groupSecret, type CopyImpl } from "./copy-field";
import { cn } from "@/lib/utils";

export interface QrImage {
  /**
   * A pre-rendered data URI or same-origin URL. We deliberately do NOT accept a
   * raw `otpauthUri` and rasterise it here: there is no encoder in the tree, and
   * adding one is out of scope. Whoever adds the QR does it server-side or with
   * a new dependency, and passes the finished image.
   */
  src: string;
  /**
   * Required. A QR code is the one image on this page a screen reader cannot
   * use, so the alt text must carry the instruction the visual code cannot.
   */
  alt: string;
  width?: number;
  height?: number;
}

/** Default alt text, English. Pass through `t("mfa.qrAlt", …)` at the call site. */
export const MFA_QR_ALT =
  "QR code containing the two-factor authentication setup key. Scan it with an authenticator app, or enter the setup key manually below.";

/** 32-char base32 secret is the common default; anything shorter is unusual. */
function isPlausibleSecret(secret: string): boolean {
  return /^[A-Z2-7]{16,}$/i.test(secret.replace(/\s+/g, ""));
}

export function EnrollmentMediaSlot({
  secret,
  otpauthUri,
  qr = null,
  copyImpl,
  className,
}: {
  secret: string;
  otpauthUri: string | null;
  /** Pass a rendered image to switch the slot out of manual-entry mode. */
  qr?: QrImage | null;
  copyImpl?: CopyImpl;
  className?: string;
}) {
  const { t } = useTranslation();

  const manual = (
    <div className="space-y-4" data-mfa-manual-entry="">
      <p
        id="mfa-manual-instruction"
        className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground"
      >
        <Smartphone className="me-2 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
        {t("mfa.enroll.manualStep1", "Open your authenticator app, add a new account, and choose")}{" "}
        <strong className="font-semibold">
          {t("mfa.enroll.manualChoice", "Enter a setup key manually")}
        </strong>
        {t("mfa.enroll.manualStep2", "Then copy the setup key below into it.")}
      </p>

      <CopyField
        label={t("mfa.enroll.secretLabel", "Setup key (secret)")}
        description={t(
          "mfa.enroll.secretHint",
          "Type this in as the manual setup key. Spaces are added for readability — your app may not want them.",
        )}
        value={secret}
        display={groupSecret(secret)}
        copyImpl={copyImpl}
        testId="mfa-secret"
      />

      {otpauthUri && (
        <CopyField
          label={t("mfa.enroll.uriLabel", "otpauth:// URI")}
          description={t(
            "mfa.enroll.uriHint",
            "Only needed if your app accepts a pasted setup URI.",
          )}
          value={otpauthUri}
          copyImpl={copyImpl}
          testId="mfa-otpauth-uri"
        />
      )}

      {!isPlausibleSecret(secret) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(
            "mfa.enroll.secretMalformed",
            "The server returned a setup key in an unexpected format. Check it before entering it, and contact support if it does not look like a string of letters and digits.",
          )}
        </p>
      )}
    </div>
  );

  return (
    <figure
      data-mfa-media-slot="otpauth"
      data-mode={qr ? "qr" : "manual"}
      className={cn("m-0 space-y-3", className)}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border-2 border-dashed bg-muted/20 p-4",
          qr ? "min-h-[220px]" : "min-h-[96px]",
        )}
      >
        {qr ? (
          <img
            src={qr.src}
            alt={qr.alt}
            width={qr.width ?? 200}
            height={qr.height ?? 200}
            className="h-auto w-[200px] rounded bg-background p-2"
            data-testid="mfa-qr"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <QrCode className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs font-medium text-muted-foreground">
              {t("mfa.enroll.noQr", "No QR code on this build — enter the setup key manually")}
            </p>
          </div>
        )}
      </div>

      {qr ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {t("mfa.enroll.manualInstead", "Enter the setup key manually instead")}
          </summary>
          <div className="pt-3">{manual}</div>
        </details>
      ) : (
        manual
      )}

      <figcaption className="text-xs text-muted-foreground">
        {t(
          "mfa.enroll.secretPrivacy",
          "Keep this setup key private. Anyone who has it can generate valid codes for your account.",
        )}
      </figcaption>
    </figure>
  );
}