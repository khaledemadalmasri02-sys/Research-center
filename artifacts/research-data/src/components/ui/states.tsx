import * as React from "react"
import {
  AlertTriangle,
  Database,
  Inbox,
  Loader2,
  Lock,
  SearchX,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

/**
 * Resolve the shared default copy for an empty / error / permission state.
 *
 * These components are rendered by nearly every page, so their defaults were the
 * last large surface still emitting English in the Arabic locale. The English
 * literal stays as the `t()` fallback so a missing bundle degrades to readable
 * English rather than to a raw key. `title` / `description` props still win, so
 * a page needing specific wording can override without forking the component.
 */
function useStateCopy(key: string) {
  const { t } = useTranslation()
  return t(`states.${key}`) as
    | { title?: string; description?: string; label?: string }
    | undefined
}

/**
 * A small family of "state" components — designed empty / loading /
 * error / no-results / no-permission blocks that any page can drop in
 * in place of bespoke placeholders.
 *
 * Each accepts an optional title, description, icon and primary action.
 * All are role-correct (status / alert) for screen readers.
 */

interface StateShellProps {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  /** Visual size. Default "md". */
  size?: "sm" | "md" | "lg"
  /** Centred horizontally. Default true. */
  centered?: boolean
}

const SIZE_CLASSES: Record<NonNullable<StateShellProps["size"]>, { box: string; icon: string; title: string; desc: string }> = {
  sm: { box: "gap-2 py-6", icon: "h-8 w-8", title: "text-sm", desc: "text-xs" },
  md: { box: "gap-3 py-10", icon: "h-12 w-12", title: "text-base", desc: "text-sm" },
  lg: { box: "gap-4 py-16", icon: "h-16 w-16", title: "text-xl", desc: "text-base" },
}

function StateShell({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "md",
  centered = true,
}: StateShellProps) {
  const s = SIZE_CLASSES[size]
  return (
    <div
      className={cn(
        "flex flex-col items-center text-balance rounded-lg border border-dashed p-6 text-center",
        s.box,
        centered && "justify-center",
        className,
      )}
    >
      {Icon && (
        <div
          aria-hidden
          className={cn(
            "grid place-items-center rounded-full bg-muted text-muted-foreground",
            s.icon,
            "p-3",
          )}
        >
          <Icon className="h-1/2 w-1/2" />
        </div>
      )}
      <h2 className={cn("font-semibold", s.title)}>{title}</h2>
      {description && (
        <p className={cn("max-w-md text-muted-foreground", s.desc)}>{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* No data — first-time / empty dataset                                       */
/* -------------------------------------------------------------------------- */

export function NoDataState({
  title,
  description,
  icon,
  action,
  className,
  size,
}: Omit<StateShellProps, "icon"> & { icon?: LucideIcon }) {
  const copy = useStateCopy("noData")
  return (
    <StateShell
      icon={icon ?? Database}
      title={title ?? copy?.title ?? "Nothing here yet"}
      description={description ?? copy?.description ?? "Get started by creating your first record."}
      action={action}
      className={className}
      size={size}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* No results — search / filter returned nothing                              */
/* -------------------------------------------------------------------------- */

export function NoResultsState({
  title,
  description,
  icon,
  action,
  className,
  size,
}: Omit<StateShellProps, "icon"> & { icon?: LucideIcon }) {
  const copy = useStateCopy("noResults")
  return (
    <StateShell
      icon={icon ?? SearchX}
      title={title ?? copy?.title ?? "No matching results"}
      description={description ?? copy?.description ?? "Try clearing filters or using different search terms."}
      action={action}
      className={className}
      size={size}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Inbox zero — a different empty state for lists / notifications             */
/* -------------------------------------------------------------------------- */

export function EmptyInboxState({
  title,
  description,
  action,
  className,
  size,
}: Omit<StateShellProps, "icon">) {
  const copy = useStateCopy("allCaughtUp")
  return (
    <StateShell
      icon={Inbox}
      title={title ?? copy?.title ?? "All caught up"}
      description={description ?? copy?.description ?? "No new notifications."}
      action={action}
      className={className}
      size={size}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Error                                                                     */
/* -------------------------------------------------------------------------- */

export function ErrorState({
  title,
  description,
  icon,
  action,
  className,
  size,
}: Omit<StateShellProps, "icon"> & { icon?: LucideIcon }) {
  const copy = useStateCopy("error")
  return (
    <div role="alert" className={cn(className)}>
      <StateShell
        icon={icon ?? AlertTriangle}
        title={title ?? copy?.title ?? "Something went wrong"}
        description={description ?? copy?.description ?? "Please try again. If the problem persists, contact support."}
        action={action}
        size={size}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Permission denied                                                         */
/* -------------------------------------------------------------------------- */

export function NoPermissionState({
  title,
  description,
  icon,
  action,
  className,
  size,
}: Omit<StateShellProps, "icon"> & { icon?: LucideIcon }) {
  const copy = useStateCopy("forbidden")
  return (
    <StateShell
      icon={icon ?? Lock}
      title={title ?? copy?.title ?? "You don't have access to this"}
      description={description ?? copy?.description ?? "Ask an administrator to grant you permission."}
      action={action}
      className={className}
      size={size}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Loading — animated spinner with optional description                       */
/* -------------------------------------------------------------------------- */

export interface LoadingStateProps {
  title?: React.ReactNode
  description?: React.ReactNode
  className?: string
  size?: "sm" | "md" | "lg"
  /** Use a skeleton block instead of a spinner. Default false. */
  skeleton?: boolean
}

export function LoadingState({
  title,
  description,
  className,
  size = "md",
  skeleton = false,
}: LoadingStateProps) {
  const copy = useStateCopy("loading")
  const label = title ?? copy?.title ?? "Loading…"
  const s = SIZE_CLASSES[size]
  if (skeleton) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={copy?.label ?? "Loading"}
        className={cn("flex flex-col gap-2", className)}
      >
        <div className="skeleton-shimmer h-4 w-1/3 rounded-md bg-[linear-gradient(90deg,var(--skeleton-base)_0%,var(--skeleton-highlight)_50%,var(--skeleton-base)_100%)] bg-[length:200%_100%]" />
        <div className="skeleton-shimmer h-3 w-1/2 rounded-md bg-[linear-gradient(90deg,var(--skeleton-base)_0%,var(--skeleton-highlight)_50%,var(--skeleton-base)_100%)] bg-[length:200%_100%]" />
        <div className="skeleton-shimmer h-3 w-2/3 rounded-md bg-[linear-gradient(90deg,var(--skeleton-base)_0%,var(--skeleton-highlight)_50%,var(--skeleton-base)_100%)] bg-[length:200%_100%]" />
      </div>
    )
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-2 text-muted-foreground",
        s.box,
        className,
      )}
    >
      <Loader2 className={cn("animate-spin", s.icon, "p-0")} aria-hidden="true" />
      {label && <p className={cn("font-medium text-foreground", s.title)}>{label}</p>}
      {description && <p className={cn(s.desc)}>{description}</p>}
    </div>
  )
}
