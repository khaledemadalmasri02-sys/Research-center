/**
 * The recovery-codes reveal — the one screen in this flow that cannot be
 * reproduced if the user walks away from it.
 *
 * ===========================================================================
 * DESIGN INTENT
 * ===========================================================================
 * `POST /mfa/enroll/confirm` returns the codes exactly once. They are never
 * retrievable again. Everything here serves that fact:
 *
 *   1. The warning is not a toast and not a dismissible banner. It is a
 *      persistent, high-contrast block with `role="alert"`, and it enters
 *      BEFORE the codes do — so the codes never appear on screen without the
 *      warning already read.
 *   2. The reveal is `DURATION.deliberate` (600ms), the slowest token in the
 *      system, on `opacity` + a small `scale`. Not a flash. A user who glances
 *      away for 200ms must not come back to a screen of codes they never saw
 *      were there. Under reduced motion / reduced data it renders instantly
 *      with no transform — the content is identical either way.
 *   3. Leaving is blocked (`useBlockLeave`) until the user presses the single
 *      acknowledgement button. The dialog's safe action is the default-focused
 *      one and its destructive action is visually demoted.
 *   4. Copy-all and download both exist, and the copy-all button is ABOVE the
 *      list, so "get them out of here" does not require scrolling past 10 codes.
 *
 * The codes are held in component state only. They are never written to
 * localStorage, sessionStorage, a query cache, or the URL, because any of those
 * would make them retrievable after the server has forgotten them.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertOctagon, ClipboardCopy, Download, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DURATION,
  EASE_OUT,
  cappedStagger,
  shouldReduceMotion,
  useMotionPrefs,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CopyButton, type CopyImpl } from "./copy-field";
import { LeaveGuardDialog, useBlockLeave } from "./use-block-leave";

/**
 * Build the plain-text payload for the download.
 *
 * Includes the explanatory header, because a `.txt` of ten bare codes found on
 * a USB stick six months later is useless without the instruction to store it
 * safely.
 */
export function buildRecoveryCodesFile(
  codes: string[],
  t: (key: string, fallback: string) => string,
): string {
  return [
    t("mfa.recovery.fileHeader", "Two-factor authentication recovery codes"),
    t(
      "mfa.recovery.fileWarning",
      "Each code works once. Store this file somewhere safe and offline. It cannot be downloaded again.",
    ),
    "",
    ...codes,
    "",
  ].join("\n");
}

/**
 * Trigger a download. Returns false when the environment cannot do it (no
 * `URL.createObjectURL`, no DOM) so the caller can tell the user instead of
 * silently doing nothing.
 */
export function downloadTextFile(filename: string, contents: string): boolean {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return false;
  try {
    const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

export function RecoveryCodesPanel({
  codes,
  onAcknowledge,
  acknowledgeLabel,
  downloadFileName = "recovery-codes.txt",
  className,
  copyImpl,
}: {
  codes: string[];
  /** Called when the user confirms they have saved the codes. */
  onAcknowledge: () => void;
  /** i18n key. */
  acknowledgeLabel: string;
  downloadFileName?: string;
  className?: string;
  copyImpl?: CopyImpl;
}) {
  const { t } = useTranslation();
  const reduced = shouldReduceMotion(useMotionPrefs());
  const [downloadFailed, setDownloadFailed] = useState(false);

  if (codes.length === 0) {
    // Rendering an empty reveal would be a lie: the user would be told they had
    // codes when they have none. Fail visibly instead.
    return (
      <div role="alert" className={cn("rounded-md border border-destructive p-4", className)}>
        <p className="text-sm font-semibold text-destructive">
          {t("mfa.recovery.missingTitle", "No recovery codes were returned")}
        </p>
        <p className="mt-1 text-sm text-destructive/90">
          {t(
            "mfa.recovery.missingBody",
            "Your account is protected, but you have no way back in if you lose your authenticator app. Generate a new set before you leave this page.",
          )}
        </p>
      </div>
    );
  }

  const handleDownload = () => {
    const ok = downloadTextFile(
      downloadFileName,
      buildRecoveryCodesFile(codes, (k, f) => String(t(k, f))),
    );
    setDownloadFailed(!ok);
  };

  return (
    <div className={cn("space-y-5", className)} data-testid="mfa-recovery-codes">
      {/*
        The warning. Enters FIRST and independently of the list, on the slowest
        token in the system. `role="alert"` because arriving on a screen of
        un-saveable secrets is itself the alert-worthy event.
      */}
      <motion.div
        role="alert"
        variants={{
          hidden: { opacity: 0, y: -8 },
          show: {
            opacity: 1,
            y: 0,
            transition: { duration: DURATION.deliberate, ease: EASE_OUT },
          },
        }}
        initial={reduced ? false : "hidden"}
        animate="show"
        className="rounded-lg border-2 border-destructive bg-destructive/10 p-4"
      >
        <div className="flex gap-3">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-destructive">
              {t("mfa.recovery.onceTitle", "These codes are shown only once")}
            </p>
            <p className="text-sm text-destructive">
              {t(
                "mfa.recovery.onceBody",
                "Copy or download them now. Once you close this page they cannot be shown again, and nobody — including support — can retrieve them for you.",
              )}
            </p>
          </div>
        </div>
      </motion.div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          value={codes.join("\n")}
          label={t("mfa.recovery.copyAll", "Copy all recovery codes")}
          copyImpl={copyImpl}
        />
        <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("mfa.recovery.download", "Download as .txt")}
        </Button>
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="mfa-recovery-count"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
          {codes.length} {t("mfa.recovery.countUnit", "codes")}
        </span>
      </div>

      {downloadFailed && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(
            "mfa.recovery.downloadFailed",
            "Your browser blocked the download. Use “Copy all” instead.",
          )}
        </p>
      )}

      {/*
        The codes. Deliberate reveal: opacity plus a small scale, on
        `DURATION.deliberate` for the warning and `DURATION.slow` per row, with a
        capped stagger so a longer list cannot make the last row appear seconds
        late. `cappedStagger` takes the gap from `MAX_STAGGERED_CHILDREN`, not
        from the real count, so 10 codes and 200 codes behave alike.
      */}
      <motion.ul
        variants={{
          hidden: {},
          show: {
            transition: {
              staggerChildren: cappedStagger(codes.length),
              delayChildren: DURATION.fast,
            },
          },
        }}
        initial={reduced ? false : "hidden"}
        animate="show"
        className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2"
        aria-label={t("mfa.recovery.listLabel", "Your recovery codes")}
      >
        {codes.map((code, i) => (
          <motion.li
            key={`${code}-${i}`}
            variants={{
              hidden: { opacity: 0, scale: 0.97 },
              show: {
                opacity: 1,
                scale: 1,
                transition: { duration: DURATION.slow, ease: EASE_OUT },
              },
            }}
            className="flex items-center justify-between gap-2 rounded border bg-background px-3 py-2"
          >
            <code className="font-mono text-sm tracking-wider" data-testid="mfa-recovery-code">
              {code}
            </code>
            <CopyButton value={code} label={t("mfa.recovery.copyOne", "Copy code")} copyImpl={copyImpl} />
          </motion.li>
        ))}
      </motion.ul>

      <motion.p
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } },
        }}
        initial={reduced ? false : "hidden"}
        animate="show"
        className="flex gap-2 text-sm text-muted-foreground"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {t(
            "mfa.recovery.storageHint",
            "Keep these somewhere other than the device that generates your codes. Each one signs you in once, then stops working.",
          )}
        </span>
      </motion.p>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          onClick={onAcknowledge}
          data-testid="mfa-recovery-acknowledge"
          className="font-semibold"
        >
          {t(acknowledgeLabel, "I've saved my recovery codes")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The leave guard for {@link RecoveryCodesPanel}.
 *
 * `locked` is true exactly while the codes are on screen and not yet
 * acknowledged. Split out so the page does not re-implement the interception
 * and so the panel can be tested without a router.
 */
export function RecoveryCodesLeaveGuard({
  locked,
  title,
  body,
  stayLabel,
  leaveLabel,
}: {
  locked: boolean;
  title: string;
  body: string;
  stayLabel: string;
  leaveLabel: string;
}) {
  const { blocked, release, cancel } = useBlockLeave(locked);
  return (
    <LeaveGuardDialog
      open={blocked}
      onStay={cancel}
      onLeave={release}
      title={title}
      body={body}
      stayLabel={stayLabel}
      leaveLabel={leaveLabel}
    />
  );
}