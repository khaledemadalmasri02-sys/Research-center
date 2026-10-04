import * as React from "react"
import { useLocation } from "wouter"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { useOptionalThemePreset } from "@/components/desktop/theme-preset-context"
import {
  LayoutDashboard,
  LogOut,
  Moon,
  Palette,
  Search,
  Settings as SettingsIcon,
  Sun,
  GraduationCap,
  Bell,
  FileText,
  Users,
  BarChart3,
  MessageSquare,
  BookOpen,
  Brain,
  Database as DatabaseIcon,
  Download,
  ScanLine,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Code2,
  History,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Monitor,
  UploadCloud,
  Activity as ActivityIcon,
  X,
  type LucideIcon,
} from "lucide-react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AnimatePresence, motion } from "framer-motion"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useAuth } from "@/hooks/use-auth"
import { useQuery } from "@tanstack/react-query"
import { PATIENTS_DEFINITION_NAME, recordsApi } from "@/lib/records"
import { useDesktopNav } from "@/lib/desktop-nav"
import { openProductTour } from "@/hooks/use-product-tour"
import { getApp } from "@/components/desktop/app-registry"
import { useSound } from "@/components/sound-provider"
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/command-palette-events"
import { DURATION, SPRING, cappedStagger, shouldReduceMotion, useMotionPrefs } from "@/lib/motion"

/** Entrance spring: `SPRING.snappy`, zeta ~0.89, settles ~150ms. */
const SNAPPY_SPRING = SPRING.snappy

/**
 * Stagger budget for the result rows.
 *
 * The palette can render 30+ commands, and a fixed per-item gap put the last
 * row most of a second behind the first — the list looked like it was still
 * loading while the user was already reading row 1. `cappedStagger` divides a
 * FIXED budget by the row count and saturates at MAX_STAGGERED_CHILDREN, so
 * BUDGET + ITEM_DURATION stays under 200ms whether there are 3 rows or 50.
 */
const STAGGER_BUDGET_S = 0.06
/** `DURATION.instant`: rows are small and the first one must be readable now. */
const ITEM_DURATION_S = DURATION.instant

/** i18next echoes the key back on a miss; see `countLabel` below. */
const LOOKS_LIKE_UNRESOLVED_KEY = /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/

interface RawNavItem {
  id: string
  /** i18n key for the palette label. */
  label: string
  route: string
  icon: LucideIcon
  /** Desktop app id (if the app is registered in the desktop shell). */
  appId?: string
  adminOnly?: boolean
  group: Group
}

type Group = "navigate" | "actions" | "theme" | "account" | "search"

/** How many patient hits to offer as live palette results. */
const PATIENT_RESULT_LIMIT = 8

interface NavItem extends RawNavItem {
  run: (api: {
    navigate: (route: string) => void
    openApp: (appId: string, route: string) => void
  }) => void
}

/**
 * Static route map for the classic SPA. Mirrors the <Route> entries in
 * App.tsx — kept small on purpose; this is the high-ROI set the user
 * actually opens from a palette. Rarely-used routes still appear in the
 * dock / sidebar.
 *
 * `id` IS the i18n key and is what gets rendered. `label` is the untranslated
 * English fallback that is appended to `value` so a user who types "patients"
 * still finds the row while the UI is in Arabic. REPORT: `app.settings`,
 * `app.theme`, `app.activity` and `app.reports` have no `nav.*`/`app.*` leaf in
 * `src/i18n/en.ts` + `ar.ts` yet, so those four render as their raw key —
 * `commandPalette.resultCount` and `commandPalette.resultsOne` are needed too.
 * Neither file may be edited from here.
 */
const NAV_ITEMS: RawNavItem[] = [
  { id: "nav.home", label: "Dashboard", route: "/", icon: LayoutDashboard, appId: "home", group: "navigate" },
  { id: "nav.patients", label: "Patients", route: "/patients", icon: Users, appId: "patients", group: "navigate" },
  { id: "nav.collections", label: "Collections", route: "/collections", icon: FileText, appId: "collections", group: "navigate" },
  { id: "nav.dataAnalysis", label: "Data Analysis", route: "/data-analysis", icon: BarChart3, appId: "data-analysis", group: "navigate" },
  { id: "nav.feedback", label: "Feedback", route: "/feedback", icon: MessageSquare, appId: "feedback", group: "navigate" },
  { id: "nav.moreFeatures", label: "More Features", route: "/more-features", icon: LayoutGrid, appId: "more-features", group: "navigate" },
  { id: "app.cohort", label: "Cohort Builder", route: "/cohort", icon: Users, appId: "cohort", group: "navigate" },
  { id: "app.coding", label: "Coding", route: "/coding", icon: Code2, appId: "coding", group: "navigate" },
  { id: "app.consent", label: "Consent", route: "/consent", icon: FileText, appId: "consent", group: "navigate" },
  { id: "app.deidentify", label: "De-identify", route: "/deidentify", icon: ShieldCheck, appId: "deidentify", group: "navigate" },
  { id: "app.dicom", label: "DICOM", route: "/dicom", icon: ScanLine, appId: "dicom", group: "navigate" },
  { id: "app.export", label: "Export", route: "/export", icon: Download, appId: "export", group: "navigate" },
  { id: "app.gdpr", label: "GDPR", route: "/gdpr", icon: ScrollText, appId: "gdpr", group: "navigate" },
  { id: "app.ingest", label: "Ingest", route: "/ingest", icon: UploadCloud, appId: "ingest", group: "navigate" },
  { id: "app.ml", label: "ML", route: "/ml", icon: Brain, appId: "ml", group: "navigate" },
  { id: "app.reports", label: "Reports", route: "/reports", icon: FileText, appId: "reports", group: "navigate" },
  { id: "app.search", label: "Search", route: "/search", icon: Search, appId: "search", group: "navigate" },
  { id: "app.studies", label: "Studies", route: "/studies", icon: BookOpen, appId: "studies", group: "navigate" },
  { id: "app.validation", label: "Validation", route: "/validation", icon: ListChecks, appId: "validation", group: "navigate" },
  { id: "app.activity", label: "My Activity", route: "/activity/me", icon: History, appId: "activity/me", group: "navigate" },
  { id: "app.apiTokens", label: "API Tokens", route: "/api-tokens", icon: KeyRound, appId: "api-tokens", group: "navigate" },
  { id: "app.sessions", label: "Sessions", route: "/sessions", icon: Monitor, appId: "sessions", group: "navigate" },
  { id: "app.settings", label: "Settings", route: "/settings", icon: SettingsIcon, appId: "settings", group: "navigate" },
  { id: "app.theme", label: "Theme Manager", route: "/theme-manager", icon: Palette, appId: "theme-manager", group: "navigate" },
  { id: "nav.admin.database", label: "Database (admin)", route: "/database", icon: DatabaseIcon, appId: "database", adminOnly: true, group: "navigate" },
  { id: "nav.admin.admin", label: "Admin", route: "/admin", icon: ShieldAlert, appId: "admin", adminOnly: true, group: "navigate" },
  { id: "nav.admin.activity", label: "Activity (admin)", route: "/activity", icon: ActivityIcon, appId: "activity", adminOnly: true, group: "navigate" },
]

function navItem(raw: RawNavItem): NavItem {
  const run = raw.appId
    ? (api: { navigate: (r: string) => void; openApp: (i: string, r: string) => void }) =>
        api.openApp(raw.appId!, raw.route)
    : (api: { navigate: (r: string) => void; openApp: (i: string, r: string) => void }) =>
        api.navigate(raw.route)
  return { ...raw, run }
}

interface CommandPaletteProps {
  /** When true, the ⌘K shortcut is bound. Mount once at app root. */
  enabled?: boolean
}

export function CommandPalette({ enabled = true }: CommandPaletteProps) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const presetCtx = useOptionalThemePreset()
  const toggleTheme = presetCtx?.toggleTheme ?? (() => setTheme(theme === "dark" ? "light" : "dark"))
  const { canAdminAccess, logout } = useAuth()
  const [, navigate] = useLocation()
  const desktopNav = useDesktopNav()
  const { play } = useSound()
  const [open, setOpen] = React.useState(false)
  const reducedMotion = shouldReduceMotion(useMotionPrefs())
  const [patientTerm, setPatientTerm] = React.useState("")

  /**
   * "jump to patient P-0042" is the single highest-value ⌘K command in a
   * clinical tool. The palette previously offered static routes only, so the
   * fastest way to reach a record was to open the directory and type.
   */
  const { data: collections } = useQuery({
    queryKey: ["collections-list"],
    queryFn: () => recordsApi.listDefinitions(),
    staleTime: 60_000,
  })
  const patientsDefId = React.useMemo(
    () => (collections?.definitions ?? []).find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [collections],
  )
  const { data: patientRecords } = useQuery({
    queryKey: ["records", patientsDefId, "directory"],
    queryFn: () => recordsApi.listRecords(patientsDefId!),
    enabled: open && patientsDefId != null,
    staleTime: 30_000,
  })
  const patientMatches = React.useMemo(() => {
    const q = patientTerm.trim().toLowerCase()
    if (q.length < 2) return []
    return (patientRecords?.records ?? [])
      .map((r) => {
        const d = r.data as Record<string, unknown>
        return {
          id: r.id,
          patientId: typeof d.patientId === "string" ? d.patientId : undefined,
          patientName: typeof d.patientName === "string" ? d.patientName : undefined,
        }
      })
      .filter(
        (p) =>
          (p.patientId ?? "").toLowerCase().includes(q) ||
          (p.patientName ?? "").toLowerCase().includes(q),
      )
      .slice(0, PATIENT_RESULT_LIMIT)
  }, [patientRecords, patientTerm])

  // ⌘K / Ctrl-K opens; "/" also opens unless the user is typing in an
  // input. Esc closes (cmdk handles it).
  React.useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((prev) => {
          const next = !prev
          if (next) play("dialog-open")
          return next
        })
        return
      }
      if (e.key === "/" && !isMod) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) return
        e.preventDefault()
        setOpen((prev) => {
          if (!prev) play("dialog-open")
          return true
        })
      }
    }
    const onOpenRequest = () => {
      setOpen(true)
      play("dialog-open")
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest)
    }
  }, [enabled, play])

  const openApp = React.useCallback(
    (appId: string, route: string) => desktopNav.open(appId, route),
    [desktopNav],
  )

  const items = React.useMemo<NavItem[]>(() => {
    const base = NAV_ITEMS.filter((i) => !i.adminOnly || canAdminAccess).map(navItem)
    const actions: NavItem[] = [
      {
        id: "cmd.tour",
        label: t("commandPalette.openTour"),
        route: "/",
        icon: GraduationCap,
        group: "actions",
        run: () => openProductTour(),
      },
      {
        id: "cmd.notifications",
        label: t("commandPalette.openNotifications"),
        route: "/",
        icon: Bell,
        group: "actions",
        run: () => {
          // Fire a custom event the notification bell can listen for.
          window.dispatchEvent(new CustomEvent("open-notifications"))
        },
      },
    ]
    const themeItem: NavItem = {
      id: "cmd.theme",
      label: t("commandPalette.toggleTheme"),
      route: "/",
      icon: theme === "dark" ? Sun : Moon,
      group: "theme",
      run: () => toggleTheme(),
    }
    const account: NavItem[] = [
      {
        id: "cmd.signout",
        label: t("commandPalette.signOut"),
        route: "/login",
        icon: LogOut,
        group: "account",
        run: () => logout(),
      },
    ]
    return [...base, ...actions, themeItem, ...account]
  }, [t, theme, toggleTheme, canAdminAccess, logout])

  const grouped = React.useMemo(() => {
    const groups: Record<Group, NavItem[]> = { navigate: [], actions: [], theme: [], account: [], search: [] }
    for (const item of items) groups[item.group].push(item)
    return groups
  }, [items])

  const run = React.useCallback(
    (item: NavItem) => {
      item.run({ navigate, openApp })
      if (item.id === "cmd.signout") play("login-fail")
      else play("click")
      setOpen(false)
    },
    [navigate, openApp, play],
  )

  const search = patientTerm.trim().toLowerCase()

  /**
   * How many rows cmdk will actually keep.
   *
   * cmdk's default filter is `commandValue.toLowerCase().includes(search)` over
   * exactly the `value` strings passed below, so counting with the same rule
   * over the same strings yields the same number cmdk renders: no invented
   * figure and no second source of truth for "how many results".
   */
  const resultCount = React.useMemo(() => {
    const kept = items.filter((item) =>
      search === "" ||
      `${t(item.id)} ${item.label}`.toLowerCase().includes(search),
    ).length
    return kept + (patientMatches.length > 0 ? patientMatches.length : 0)
  }, [items, patientMatches.length, search, t])

  /* i18next returns the key itself on a miss (there is no `saveMissing`), which
     would print the literal "commandPalette.resultCount" in the footer. Same
     unresolved-key guard `components/desktop/app-registry.ts` uses for window
     titles. */
  const resolvedCount = t("commandPalette.resultCount", { count: resultCount })
  const countLabel = LOOKS_LIKE_UNRESOLVED_KEY.test(resolvedCount)
    ? String(resultCount)
    : resolvedCount

  const step = cappedStagger(items.length + patientMatches.length, STAGGER_BUDGET_S)
  const rowMotion = (index: number) =>
    reducedMotion
      ? {}
      : {
          variants: {
            hidden: { opacity: 0, y: 4 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: ITEM_DURATION_S },
            },
          },
          custom: index,
        }

  return (
    /* Radix primitives directly instead of `CommandDialog`.
       `CommandDialog` hardcodes `DialogContent`, whose entrance is
       `data-[state=open]:animate-in zoom-in-95` — a CSS keyframe that cannot
       be replaced by a spring, cannot be gated on the reduced-motion
       preference, and combines with `translate-x-[-50%]` on the same element
       (framer owns `transform`, Tailwind owns `translate`, and they overwrite
       each other). Here `Content` is a positioned, motion-free flex shell and
       the panel inside it is the spring. Radix still owns the focus trap,
       Escape, outside-click dismissal, aria-modal and focus restore, so
       keyboard operability is unchanged. */
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay
              forceMount
              className="fixed inset-0 z-50 bg-black/70 duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0"
            />
            <DialogPrimitive.Content
              forceMount
              className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] focus:outline-none"
            >
              <motion.div
                /* Printer: the palette is chrome, and `@media print` already
                   hides portalled overlays — the attribute is the documented
                   contract from src/index.css. */
                data-print="chrome"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, scale: 0.985 }}
                transition={SNAPPY_SPRING}
                className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
              >
                <DialogPrimitive.Close
                  aria-label={t("common.close", "Close")}
                  className="absolute end-3 top-3 z-10 rounded-md p-1 text-muted-foreground opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>

                <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
                  <CommandInput
                    placeholder={t("commandPalette.placeholder")}
                    autoFocus
                    value={patientTerm}
                    onValueChange={setPatientTerm}
                  />
                  <CommandList>
                    {/* The empty state mounts and unmounts as the result set
                        collapses, so it gets an entrance of its own instead of
                        blinking in place between two static layouts. */}
                    <motion.div
                      initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.12 }}
                    >
                      <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
                    </motion.div>

                    {patientMatches.length > 0 && (
                      <CommandGroup heading={t("commandPalette.groups.search")}>
                        <motion.div
                          variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
                          initial={reducedMotion ? false : "hidden"}
                          animate="show"
                        >
                          {patientMatches.map((p, i) => (
                            <motion.div key={`patient-${p.id}`} {...rowMotion(i)}>
                              <CommandItem
                                value={`${t("common.patient")} ${p.patientName ?? ""} ${p.patientId ?? p.id}`}
                                onSelect={() => {
                                  desktopNav.open("patient-view", `/patients/${p.id}`)
                                  play("click")
                                  setOpen(false)
                                  setPatientTerm("")
                                }}
                              >
                                <Users />
                                <span className="truncate">{p.patientName ?? t("common.unknown")}</span>
                                <span className="ms-auto font-mono text-xs text-muted-foreground">
                                  {p.patientId ?? p.id}
                                </span>
                              </CommandItem>
                            </motion.div>
                          ))}
                        </motion.div>
                      </CommandGroup>
                    )}

                    {grouped.navigate.length > 0 && (
                      <CommandGroup heading={t("commandPalette.groups.navigate")}>
                        <motion.div
                          variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
                          initial={reducedMotion ? false : "hidden"}
                          animate="show"
                        >
                          {grouped.navigate.map((item, i) => {
                            const Icon = item.icon
                            return (
                              <motion.div key={item.id} {...rowMotion(i)}>
                                <CommandItem
                                  /* Match on BOTH the localized label and the
                                   * English fallback, so typing either finds
                                   * the route. */
                                  value={`${t(item.id)} ${item.label}`}
                                  onSelect={() => run(item)}
                                >
                                  <Icon />
                                  <span>{t(item.id)}</span>
                                  {item.appId && getApp(item.appId) && (
                                    <span className="ms-auto text-xs uppercase tracking-wider text-muted-foreground">
                                      App
                                    </span>
                                  )}
                                </CommandItem>
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      </CommandGroup>
                    )}

                    {grouped.actions.length > 0 && (
                      <CommandGroup heading={t("commandPalette.groups.actions")}>
                        <motion.div
                          variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
                          initial={reducedMotion ? false : "hidden"}
                          animate="show"
                        >
                          {grouped.actions.map((item, i) => {
                            const Icon = item.icon
                            return (
                              <motion.div key={item.id} {...rowMotion(i)}>
                                <CommandItem value={`${t(item.id)} ${item.label}`} onSelect={() => run(item)}>
                                  <Icon />
                                  <span>{t(item.id)}</span>
                                </CommandItem>
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      </CommandGroup>
                    )}

                    {grouped.theme.length > 0 && (
                      <CommandGroup heading={t("commandPalette.groups.theme")}>
                        <motion.div
                          variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
                          initial={reducedMotion ? false : "hidden"}
                          animate="show"
                        >
                          {grouped.theme.map((item, i) => {
                            const Icon = item.icon
                            return (
                              <motion.div key={item.id} {...rowMotion(i)}>
                                <CommandItem value={`${t(item.id)} ${item.label}`} onSelect={() => run(item)}>
                                  <Icon />
                                  <span>{t(item.id)}</span>
                                </CommandItem>
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      </CommandGroup>
                    )}

                    {grouped.account.length > 0 && (
                      <CommandGroup heading={t("commandPalette.groups.account")}>
                        <motion.div
                          variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
                          initial={reducedMotion ? false : "hidden"}
                          animate="show"
                        >
                          {grouped.account.map((item, i) => {
                            const Icon = item.icon
                            return (
                              <motion.div key={item.id} {...rowMotion(i)}>
                                <CommandItem value={`${t(item.id)} ${item.label}`} onSelect={() => run(item)}>
                                  <Icon />
                                  <span>{t(item.id)}</span>
                                </CommandItem>
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      </CommandGroup>
                    )}
                  </CommandList>

                  {/* Result count. Only the number is keyed, so typing
                      re-animates one glyph instead of remounting the list —
                      remounting the list would drop cmdk's selection state and
                      the user's place in a 50-row palette.
                      `aria-hidden`: cmdk already announces the selected item,
                      and a count that changes on every keystroke would talk
                      over it.
                      REPORT: needs `commandPalette.resultCount` in
                      `src/i18n/{en,ar}.ts` (en "{{count}} results",
                      ar "{{count}} نتيجة"). Until it exists the raw number is
                      shown, which is why the unresolved-key guard is here
                      rather than trusting `t()`. */}
                  <div
                    aria-hidden="true"
                    className="flex items-center justify-end border-t px-3 py-1.5 text-[11px] text-muted-foreground"
                  >
                    <span className="tabular-nums">
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span
                          key={resultCount}
                          initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reducedMotion ? undefined : { opacity: 0, y: 4 }}
                          transition={{ duration: DURATION.instant }}
                          className="inline-block"
                        >
                          {countLabel}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </div>
                </Command>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
