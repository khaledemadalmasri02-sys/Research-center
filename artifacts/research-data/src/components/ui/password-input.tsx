import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type PasswordStrength = "empty" | "weak" | "fair" | "good" | "strong"

export interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** Show a strength meter under the input. Default false. */
  showStrength?: boolean
  /** Override the strength value (e.g. when validating against backend). */
  strength?: PasswordStrength
  /** Show / hide the current value. Default true. */
  toggleable?: boolean
  /** Inline error message; sets aria-invalid and renders a message. */
  error?: React.ReactNode
  /** Optional label rendered above the input. */
  label?: React.ReactNode
}

const STRENGTH_SCORE: Record<PasswordStrength, number> = {
  empty: 0,
  weak: 1,
  fair: 2,
  good: 3,
  strong: 4,
}

const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  empty: "",
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
}

const STRENGTH_COLOR: Record<PasswordStrength, string> = {
  empty: "bg-muted",
  weak: "bg-rose-500",
  fair: "bg-amber-500",
  good: "bg-emerald-500",
  strong: "bg-emerald-600",
}

/**
 * Lightweight, dependency-free strength heuristic. Not as accurate as
 * zxcvbn, but enough to nudge users towards longer passphrases and
 * avoids the ~400 kB of zxcvbn + dictionaries.
 */
export function scorePassword(pw: string): PasswordStrength {
  if (!pw) return "empty"
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  // Penalise the usual offenders.
  if (/^(password|qwerty|12345|admin|letmein)\b/i.test(pw)) score = Math.max(1, score - 2)
  if (score <= 1) return "weak"
  if (score === 2) return "fair"
  if (score === 3) return "good"
  return "strong"
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      showStrength = false,
      strength,
      toggleable = true,
      className,
      value,
      defaultValue,
      onChange,
      id,
      label,
      error,
      ...props
    },
    ref,
  ) {
    const reactId = React.useId()
    const inputId = id ?? reactId
    const [visible, setVisible] = React.useState(false)
    const [internal, setInternal] = React.useState<string>(
      () => (defaultValue as string | undefined) ?? "",
    )
    const isControlled = value !== undefined
    const current = (isControlled ? (value as string) : internal) ?? ""

    const computed: PasswordStrength = React.useMemo(() => {
      return strength ?? scorePassword(current)
    }, [current, strength])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternal(e.target.value)
      onChange?.(e)
    }

    const errorId = error ? `${inputId}-error` : undefined
    const strengthId = showStrength ? `${inputId}-strength` : undefined
    const describedBy = [errorId, strengthId].filter(Boolean).join(" ") || undefined

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-white/70">
            {label}
          </label>
        )}
        <div className="relative">
          <Input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete={props.autoComplete ?? "current-password"}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(toggleable && "pr-10", className)}
            {...props}
          />
          {toggleable && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              tabIndex={-1}
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}
        </div>
        {error && (
          <p id={errorId} className="text-xs text-rose-400" role="alert">
            {error}
          </p>
        )}
        {showStrength && !error && (
          <div
            id={strengthId}
            className="space-y-1"
            aria-live="polite"
            aria-atomic="true"
          >
            <div
              className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={STRENGTH_SCORE[computed]}
              aria-label="Password strength"
            >
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-full flex-1 transition-colors",
                    i < STRENGTH_SCORE[computed] ? STRENGTH_COLOR[computed] : "bg-muted",
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {STRENGTH_LABEL[computed] && (
                <>
                  Strength: <span className="font-medium text-foreground">{STRENGTH_LABEL[computed]}</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    )
  },
)
