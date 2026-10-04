import * as React from "react"
import { AlertCircle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface FormFieldProps {
  /** Unique id; required for accessibility. */
  id: string
  /** Field label. */
  label: React.ReactNode
  /** Optional hint text shown below the field when no error. */
  hint?: React.ReactNode
  /** Error message; when set, the field is marked invalid. */
  error?: React.ReactNode
  /** Mark the field as required (renders a small " * " next to the label). */
  required?: boolean
  /** Children: typically an <Input>, <Textarea> or <PasswordInput>. */
  children: React.ReactNode
  /** Optional className applied to the wrapping div. */
  className?: string
  /** When true, hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean
}

/**
 * Lightweight form field wrapper that wires a <Label> to a child input
 * via `htmlFor` / `aria-describedby`, and surfaces a hint or an error
 * message below.
 *
 * Use this for forms that aren't using react-hook-form. For RHF,
 * prefer the existing `<Form>` from `@/components/ui/form`.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
  hideLabel,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={id}
        className={cn(hideLabel && "sr-only")}
      >
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </Label>
      <FieldCtx.Provider value={{ id, describedBy, invalid: !!error }}>
        {children}
      </FieldCtx.Provider>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-xs text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

const FieldCtx = React.createContext<FieldContextValue | null>(null)

/**
 * Hook used by input wrappers to read the id and aria-describedby of
 * the surrounding <FormField>. Optional: callers can ignore it.
 */
export function useFieldContext(): FieldContextValue | null {
  return React.useContext(FieldCtx)
}
