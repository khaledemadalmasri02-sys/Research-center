import * as React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Accessible label + control pair.
 *
 * The shadcn `ui/form.tsx` primitives (FormItem / FormLabel / FormControl /
 * FormMessage) do this correctly, but they are built on react-hook-form's
 * `Controller`: adopting them means rewriting every one of the ~50 static
 * forms in this app into a react-hook-form controller tree, which is a
 * behavioural rewrite rather than a remediation. This helper gets the same
 * guaranteed pairing with a fraction of the blast radius:
 *
 *   - `useId()` mints a stable, SSR-safe id.
 *   - `<Label htmlFor={id}>` is always wired to the control.
 *   - The single control child is cloned with `id`, plus `aria-invalid` and
 *     `aria-describedby` (pointing at the message / hint / error) when present.
 *   - The label content is itself exposed as a fallback accessible name via
 *     `aria-label` if the caller passes `hideLabel` (screen-reader-only label),
 *     so the control is *never* unlabelled.
 *
 * `ui/form.tsx` remains the right primitive for any form that already uses
 * react-hook-form; this is the low-risk path for the rest.
 */
export function FormRow({
  label,
  children,
  hint,
  error,
  required,
  hideLabel,
  className,
  controlClassName,
  full,
  labelClassName,
  /** Render a literal `*` after the label to mark a required field. */
  markRequired,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  /** Supporting text; referenced by aria-describedby. */
  hint?: React.ReactNode;
  /** Validation message. Sets aria-invalid and is announced. */
  error?: React.ReactNode;
  required?: boolean;
  /** Keep the label visible but visually hidden (compact layouts). */
  hideLabel?: boolean;
  className?: string;
  controlClassName?: string;
  full?: boolean;
  labelClassName?: string;
  markRequired?: boolean;
}) {
  const { t } = useTranslation();
  const base = React.useId();
  const controlId = `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  const describedBy =
    [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id: controlId,
    "aria-describedby": describedBy,
    ...(error ? { "aria-invalid": true } : {}),
    ...(required ? { "aria-required": true } : {}),
  });

  return (
    <div className={cn(full && "md:col-span-2", className)}>
      <Label
        htmlFor={controlId}
        className={cn(
          // The colour transition IS the primary invalid signal: a field goes
          // red over --dur-fast instead of jumping, and nothing moves, so a
          // form appearing invalid never reflows under a pointer mid-click.
          "text-sm font-medium text-muted-foreground transition-colors duration-[var(--dur-fast)]",
          error && "text-destructive",
          hideLabel && "sr-only",
          labelClassName,
        )}
      >
        {label}
        {markRequired && (
          <span aria-hidden className="text-destructive ms-0.5">
            *
          </span>
        )}
        {required && <span className="sr-only"> ({t("common.required")})</span>}
      </Label>
      <div className={cn("mt-1", controlClassName)}>{control}</div>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs font-medium text-destructive motion-safe:animate-motion-fade-in"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Native `<select>` styled to match `ui/input`. A raw `<select>` was used in
 * several forms and is one of the reasons those forms could not adopt the
 * shadcn `Select` (which does not forward an `id`).
 */
export const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";