/**
 * Password re-entry step.
 *
 * Every sensitive MFA call (`enroll`, `disable`, `recovery/regenerate`) requires
 * a *recent* password re-entry server-side. That is the whole point: a stolen
 * session cookie on a shared reading-room workstation must not be enough to turn
 * off the second factor and walk away.
 *
 * So this form is not a formality and it is not skippable — the page renders it
 * as its own step and does not call the sensitive endpoint until it resolves.
 * `autoComplete="current-password"` is deliberate: letting the browser offer to
 * fill it here is correct, since this is the user's own account.
 */
import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface PasswordReauthFormProps {
  /**
   * Resolves on success. Must reject on failure — the page maps the rejection
   * onto the error banner, so a `catch` inside this component would swallow the
   * one thing the user needs to read.
   */
  onSubmit: (password: string) => Promise<void>;
  pending?: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
  /** Extra context for the disable path, where the stakes differ. */
  purpose?: "enroll" | "disable" | "regenerate";
  onCancel?: () => void;
  cancelLabel?: string;
  id?: string;
}

export function PasswordReauthForm({
  onSubmit,
  pending = false,
  title,
  description,
  submitLabel,
  purpose = "enroll",
  onCancel,
  cancelLabel,
  id,
}: PasswordReauthFormProps) {
  const { t } = useTranslation();
  const generated = useId();
  const fieldId = id ?? `mfa-reauth-password-${generated}`;
  const [password, setPassword] = useState("");

  const defaultTitle = t("mfa.reauth.title", "Confirm your password");
  const defaultDescription =
    purpose === "disable"
      ? t(
          "mfa.reauth.descriptionDisable",
          "Turning off two-factor authentication needs your password, even though you are already signed in.",
        )
      : purpose === "regenerate"
        ? t(
            "mfa.reauth.descriptionRegenerate",
            "Generating new recovery codes needs your password. Your existing codes will stop working.",
          )
        : t(
            "mfa.reauth.descriptionEnroll",
            "Setting up two-factor authentication needs your password, even though you are already signed in.",
          );

  const canSubmit = password.length > 0 && !pending;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        void onSubmit(password);
      }}
      data-testid="mfa-reauth-form"
      data-purpose={purpose}
    >
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight">{title ?? defaultTitle}</h3>
        <p id={`${fieldId}-hint`} className="text-sm text-muted-foreground">
          {description ?? defaultDescription}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={fieldId} className="sr-only">
          {t("mfa.reauth.fieldLabel", "Password")}
        </Label>
        <Input
          id={fieldId}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={pending}
          aria-describedby={`${fieldId}-hint`}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit} data-testid="mfa-reauth-submit">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitLabel ?? t("mfa.reauth.submit", "Continue")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel ?? t("common.cancel", "Cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}