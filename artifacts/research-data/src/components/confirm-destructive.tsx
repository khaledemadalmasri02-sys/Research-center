import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One confirmation gate for irreversible PHI actions.
 *
 * Before this existed each destructive site rolled its own (or, worse, had
 * none): `gdpr.tsx` erased a patient and every cascaded row from a single
 * click with a bare numeric id and no error handling, and `record-form.tsx`
 * used `window.alert`. Every one of these shares the same three failure modes
 * worth fixing once:
 *
 *   1. **Ambiguity** — "delete this?" when there are 2,000 rows on screen.
 *      `subject` names the thing in prose.
 *   2. **No verification** — a destructive action reachable by mis-click.
 *      `requireText` makes the admin type an identifier before the button
 *      arms.
 *   3. **Silent failure** — a rejected mutation rendered nothing, so the admin
 *      believed the erasure had happened. `onConfirm` is awaited and any
 *      rejection is surfaced inline with `role="alert"`.
 */
export function ConfirmDestructive({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  subject,
  requireText,
  onConfirm,
  destructive = true,
  busyLabel,
  trigger,
  children,
  className,
  confirmClassName,
}: {
  /** Controlled visibility (use this for menu- / table-driven flows). */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  title: React.ReactNode;
  /** Rendered above the typed-confirm input. Name the record explicitly. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Rendered as a bolded subject line inside the dialog body. */
  subject?: React.ReactNode;
  /** When set, the user must type this exact string to arm the confirm button. */
  requireText?: string;
  /** May throw; the rejection is surfaced instead of swallowed. */
  onConfirm: () => Promise<void> | void;
  destructive?: boolean;
  busyLabel?: string;
  /** When provided, wraps the dialog in an uncontrolled trigger. */
  trigger?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  confirmClassName?: string;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canConfirm = !requireText || typed.trim() === requireText;
  const mismatch = Boolean(requireText) && typed.length > 0 && !canConfirm;

  const reset = React.useCallback(() => {
    setTyped("");
    setError(null);
    setBusy(false);
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange?.(v);
  };

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      reset();
      onOpenChange?.(false);
    } catch (e) {
      // Never swallow: a silent failure here means the user believes a record
      // was erased when it was not.
      setError(
        (e as Error)?.message ||
          t("destructive.failedBody", { message: t("common.unknown") }),
      );
      setBusy(false);
    }
  }

  const body = (
    <AlertDialogContent className={className}>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3 text-start">
            <p>{description}</p>
            {subject && (
              <p className="rounded-md bg-muted px-3 py-2 font-medium text-foreground">
                {subject}
              </p>
            )}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>

      {requireText && (
        <div className="space-y-2">
          <label htmlFor="confirm-destructive-input" className="block text-sm font-medium">
            {t("destructive.requireTyped", { value: requireText })}
          </label>
          <input
            id="confirm-destructive-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "confirm-destructive-error" : undefined}
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              mismatch && "border-destructive",
            )}
          />
          {mismatch && (
            <p id="confirm-destructive-error" className="text-xs font-medium text-destructive">
              {t("destructive.typedMismatch", { value: requireText })}
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <strong className="font-semibold">{t("destructive.failed")}</strong>
          <span className="ms-1">{error}</span>
        </div>
      )}

      {children}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction
          disabled={!canConfirm || busy}
          onClick={(e) => {
            // Keep the dialog mounted so a failure stays visible.
            e.preventDefault();
            void run();
          }}
          className={cn(
            destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            confirmClassName,
          )}
        >
          {busy && busyLabel ? busyLabel : (confirmLabel ?? t("common.delete"))}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  if (trigger) {
    return (
      <AlertDialog onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
        {body}
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {body}
    </AlertDialog>
  );
}

/**
 * Button + `ConfirmDestructive` in one line, for the common "icon button in a
 * row" case.
 */
export function DestructiveActionButton({
  onSelect,
  title,
  description,
  confirmLabel,
  subject,
  requireText,
  trigger,
  triggerLabel,
  triggerClassName,
  busyLabel,
}: {
  onSelect: () => Promise<void> | void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel?: string;
  subject?: React.ReactNode;
  requireText?: string;
  trigger: React.ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  busyLabel?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label={triggerLabel}
        title={triggerLabel}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>
      <ConfirmDestructive
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        subject={subject}
        requireText={requireText}
        busyLabel={busyLabel ?? t("common.deleting")}
        onConfirm={async () => {
          await onSelect();
        }}
      />
    </>
  );
}