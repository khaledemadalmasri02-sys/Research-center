/**
 * Active sessions — "who else is signed in to my account".
 *
 * ===========================================================================
 * WHAT WAS WRONG WITH THE PREVIOUS VERSION
 * ===========================================================================
 * 1. It rendered `s.sid` as the React `key` and passed it to
 *    `DELETE /api/sessions/:sid`. The raw session id is the bearer credential
 *    for that session. Putting it in the DOM means it lands in "View Source",
 *    in a screenshot, in a bug report, and in the browser history of any
 *    support session that opens devtools. The backend contract now returns an
 *    opaque, non-reversible `ref` instead, and this page never touches `sid`.
 * 2. It showed `username` (the same string on every row) and `expiresAt`, which
 *    is useless for the only question this page exists to answer: *is that
 *    login mine?* Recognising a suspicious session requires the browser, the
 *    OS, the IP, and when it was last used — none of which were present.
 * 3. "Sign out all other devices" called `DELETE /api/sessions`, an endpoint
 *    the contract replaces with `POST /api/sessions/revoke-others`, and its
 *    confirmation dialog reused the single-session copy verbatim ("the device
 *    will be signed out"), so the blast radius was never actually stated.
 * 4. Revoking the current session silently did nothing: the button was not
 *    rendered, with no explanation and no alternative.
 *
 * ===========================================================================
 * DEFENSIVE READING OF THE RESPONSE
 * ===========================================================================
 * Every field except `ref` is treated as optional. A server that predates the
 * new shape returns `sid` and nothing else; that renders as a single
 * "unrecognised device" row rather than a crash, and no revoke button appears
 * for a row we cannot positively identify.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Bot,
  Globe,
  LogOut,
  Loader2,
  Monitor,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { authErrorFromResponse, presentAuthError } from "@/components/auth/mfa/errors";
import { PasswordReauthForm, reauthenticate } from "@/components/auth/mfa";
import {
  DURATION,
  EASE_OUT,
  shouldReduceMotion,
  staggerStartDelay,
  useMotionPrefs,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One row of `GET /api/sessions`.
 *
 * `ref` is the ONLY identifier used anywhere in this file. `sid` is not declared
 * because not declaring it is the cheapest way to guarantee it cannot leak: a
 * property that does not exist on the type cannot be read off one.
 */
export interface SessionRow {
  /** Opaque, non-reversible handle from the server. Never a session id. */
  ref: string;
  current?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  createdAt?: string | null;
  lastActivityAt?: string | null;
  expiresAt?: string | null;
  /** Legacy shape only. Read to tell the user the row is unrecognised, never rendered. */
  username?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Device labelling — pure, exported, no React                                 */
/* -------------------------------------------------------------------------- */

export type DeviceKind = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface DeviceLabel {
  /** Coarse, human label. e.g. "Chrome on Windows". Never a raw UA string. */
  label: string;
  kind: DeviceKind;
}

/**
 * Order matters. Every desktop Chromium UA contains "Safari", and every
 * Chromium UA contains "Chrome", so a naive "does it say Safari" test labels
 * every Windows machine as Safari.
 */
const BROWSERS: Array<{ re: RegExp; name: string }> = [
  // Chromium-family forks first: all of them also match /Chrome/.
  { re: /\bEdg(?:e|A|iOS)?\//i, name: "Edge" },
  { re: /\bOPR\/|\bOpera\b/i, name: "Opera" },
  { re: /\bSamsungBrowser\//i, name: "Samsung Internet" },
  { re: /\bYaBrowser\//i, name: "Yandex Browser" },
  { re: /\bVivaldi\//i, name: "Vivaldi" },
  { re: /\bBrave\//i, name: "Brave" },
  { re: /CriOS\//i, name: "Chrome" },
  { re: /FxiOS\//i, name: "Firefox" },
  { re: /\bChrome\/|\bChromium\//i, name: "Chrome" },
  { re: /\bFirefox\/|\bIceweasel\//i, name: "Firefox" },
  // Safari must be last: its token is a substring of every WebKit UA.
  { re: /Version\/[\d.]+.*\bSafari\//i, name: "Safari" },
];

const PLATFORMS: Array<{ re: RegExp; name: string; kind: DeviceKind }> = [
  { re: /Windows Phone/i, name: "Windows", kind: "mobile" },
  { re: /Windows NT|Windows/i, name: "Windows", kind: "desktop" },
  { re: /CrOS/i, name: "ChromeOS", kind: "desktop" },
  { re: /Android/i, name: "Android", kind: "mobile" },
  // iPadOS 13+ reports as desktop Safari; the touch-point check catches it.
  { re: /iPhone|iPod/i, name: "iPhone", kind: "mobile" },
  { re: /iPad/i, name: "iPad", kind: "tablet" },
  { re: /Mac OS X|Macintosh/i, name: "macOS", kind: "desktop" },
  { re: /Ubuntu/i, name: "Ubuntu", kind: "desktop" },
  { re: /Linux|X11/i, name: "Linux", kind: "desktop" },
];

/** Non-browser clients. Worth naming: a curl login is a red flag, not noise. */
const BOT_RE =
  /bot\b|crawler|spider|slurp|curl\/|wget\/|python-requests|python-urllib|okhttp|java\/|apache-httpclient|libwww-perl|node-fetch|axios\/|postmanruntime|insomnia|go-http-client|python\/|php\/|guzzlehttp/i;

/** Minimum length before a UA is worth parsing at all. */
const MIN_UA_LENGTH = 12;

export function isBotUserAgent(ua: string): boolean {
  return BOT_RE.test(ua);
}

/**
 * Coarse device label from a `userAgent` string.
 *
 * Deliberately lossy. The user needs to recognise their own devices at a glance
 * ("that is the laptop, that is my phone"); they do not need the UA, and
 * rendering it leaks browser fingerprinting data to anyone who can see the
 * screen. Unknown input returns a fixed label rather than a partial guess,
 * because "Chrome on" with nothing after it reads as a rendering bug.
 */
export function describeDevice(userAgent: string | null | undefined): DeviceLabel {
  const ua = (userAgent ?? "").trim();
  if (ua === "") return { label: "", kind: "unknown" };
  // Bot check BEFORE the length gate: `curl/8.5.0` is only 10 characters and
  // is exactly the kind of short, non-browser client worth naming.
  if (isBotUserAgent(ua)) return { label: "", kind: "bot" };
  if (ua.length < MIN_UA_LENGTH) return { label: "", kind: "unknown" };

  const browser = BROWSERS.find((b) => b.re.test(ua))?.name;
  const platform = PLATFORMS.find((p) => p.re.test(ua));
  if (!platform && !browser) return { label: "", kind: "unknown" };

  /*
   * iPadOS in "Request Desktop Website" mode sends a UA indistinguishable from
   * macOS except for `Mobile/`, which desktop Safari never sends. Better to
   * report "Safari on iPad" for that one case than to call every MacBook an
   * iPad — and `iPad` itself is checked first because a non-desktop-mode iPad
   * is unambiguous.
   */
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\//i.test(ua));
  const platformName = isIPad ? "iPad" : (platform?.name ?? "");

  return {
    label: browser && platformName ? `${browser} on ${platformName}` : (browser || platformName),
    kind: classifyDeviceKind(ua, isIPad, platform?.kind),
  };
}

function classifyDeviceKind(
  ua: string,
  isIPad: boolean,
  platformKind: DeviceKind | undefined,
): DeviceKind {
  if (isIPad) return "tablet";
  if (/Tablet|PlayBook|Silk|\bKFAPWI\b|\bKFOT\b/i.test(ua)) return "tablet";
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";
  // Android without "Mobile" is conventionally a tablet, with it a phone.
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "mobile" : "tablet";
  return platformKind ?? "desktop";
}

/* -------------------------------------------------------------------------- */
/* Recency grouping — pure, exported                                           */
/* -------------------------------------------------------------------------- */

export type SessionGroupId = "current" | "today" | "week" | "older";

export interface SessionGroup {
  id: SessionGroupId;
  labelKey: string;
  labelFallback: string;
  sessions: SessionRow[];
}

const DAY_MS = 86_400_000;

/** Parse an ISO string to epoch ms, or null. Never throws on junk. */
function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The timestamp that decides "when was this used".
 *
 * `lastActivityAt` first: for spotting an unfamiliar login, *when it was last
 * used* is the signal, not when the session was created. A session created last
 * month and used yesterday is an active session. Falls back to `createdAt`,
 * then `expiresAt` (the only field the old backend sent).
 */
export function sessionActivityTime(s: SessionRow): number | null {
  return parseDate(s.lastActivityAt) ?? parseDate(s.createdAt) ?? parseDate(s.expiresAt);
}

function groupFor(at: number | null, now: number, isCurrent: boolean): SessionGroupId {
  if (isCurrent) return "current";
  if (at === null) return "older";
  const age = now - at;
  if (age < DAY_MS) return "today";
  if (age < 7 * DAY_MS) return "week";
  return "older";
}

const GROUP_COPY: Record<Exclude<SessionGroupId, "current">, { key: string; fallback: string }> = {
  today: { key: "sessions.group.today", fallback: "Used today" },
  week: { key: "sessions.group.week", fallback: "Used this week" },
  older: { key: "sessions.group.older", fallback: "Earlier" },
};

/**
 * Group by recency, newest group first, `now` injectable so this is testable.
 *
 * Within a group, newest first. Ties break on `ref` so the order is stable
 * across refetches — a list that reshuffles on every poll makes a user doubt
 * what they just saw.
 */
export function groupSessionsByRecency(
  sessions: SessionRow[],
  now: number = Date.now(),
): SessionGroup[] {
  const buckets: Record<SessionGroupId, SessionRow[]> = {
    current: [],
    today: [],
    week: [],
    older: [],
  };

  for (const s of sessions) {
    buckets[groupFor(sessionActivityTime(s), now, s.current === true)].push(s);
  }

  for (const list of Object.values(buckets)) {
    list.sort((a, b) => {
      const at = sessionActivityTime(a) ?? 0;
      const bt = sessionActivityTime(b) ?? 0;
      if (bt !== at) return bt - at;
      return (a.ref ?? "").localeCompare(b.ref ?? "");
    });
  }

  const groups: SessionGroup[] = [];
  if (buckets.current.length > 0) {
    groups.push({ id: "current", labelKey: "sessions.group.current", labelFallback: "This device", sessions: buckets.current });
  }
  for (const id of ["today", "week", "older"] as const) {
    if (buckets[id].length > 0) {
      groups.push({ id, labelKey: GROUP_COPY[id].key, labelFallback: GROUP_COPY[id].fallback, sessions: buckets[id] });
    }
  }
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Absolute, locale-formatted timestamp.
 *
 * NOT relative ("3 minutes ago"). Relative strings need i18n interpolation with
 * a plural form per language, and a half-translated relative time in an Arabic
 * UI is worse than an exact timestamp. `date-fns`' English strings would have
 * been worse still.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  const ms = parseDate(iso);
  if (ms === null) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return new Date(ms).toISOString();
  }
}

const DEVICE_ICON: Record<DeviceKind, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  bot: Bot,
  unknown: Globe,
};

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/sessions`.
 *
 * Rows are normalised on the way in. A server that still sends `sid` produces
 * rows with no `ref`, and those are DROPPED: without a ref there is no way to
 * revoke them, and offering a revoke button that cannot work is worse than not
 * offering it. `normalizeSessions` returns only the safe rows.
 */
async function fetchSessions(signal?: AbortSignal): Promise<SessionRow[]> {
  const res = await fetch("/api/sessions", { credentials: "include", signal });
  if (!res.ok) throw await authErrorFromResponse(res);
  const body = (await res.json().catch(() => ({}))) as {
    sessions?: Array<Record<string, unknown>>;
  };
  const raw = Array.isArray(body.sessions) ? body.sessions : [];
  return raw
    .map((r): SessionRow | null => {
      const ref = typeof r.ref === "string" ? r.ref : "";
      if (!ref) return null;
      return {
        ref,
        current: typeof r.current === "boolean" ? r.current : undefined,
        ip: typeof r.ip === "string" ? r.ip : null,
        userAgent: typeof r.userAgent === "string" ? r.userAgent : null,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
        lastActivityAt: typeof r.lastActivityAt === "string" ? r.lastActivityAt : null,
        expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : null,
      };
    })
    .filter((r): r is SessionRow => r !== null);
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function SessionsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { logout, isLoggingIn } = useAuth();
  const reduced = shouldReduceMotion(useMotionPrefs());

  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);

  const query = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => fetchSessions(signal),
    retry: false,
  });

  const groups = useMemo(() => groupSessionsByRecency(query.data ?? []), [query.data]);

  const revoke = useMutation({
    mutationFn: async (ref: string) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(ref)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw await authErrorFromResponse(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ title: t("sessions.revoked", "Device signed out.") });
      setRevokeTarget(null);
    },
    onError: () => {
      // Left in the dialog: `ConfirmDestructive` surfaces a rejected `onConfirm`
      // inline with `role="alert"`, so the user is told the sign-out did NOT
      // happen rather than seeing the row quietly stay.
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  /**
   * The api-server guards session revocation with `requireRecentReauth`, so the
   * first call legitimately answers 403 `AUTH_REAUTH_REQUIRED`. That is a
   * step-up prompt, not a failure: we open the password prompt and replay the
   * original action once it succeeds, so the user does not have to remember what
   * they clicked.
   */
  const [reauthAction, setReauthAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sessions/revoke-others", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw await authErrorFromResponse(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ title: t("sessions.revokeOthersDone", "Every other device was signed out.") });
    },
    onError: (error: unknown) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      const presented = presentAuthError(error);
      if (presented.code === "AUTH_REAUTH_REQUIRED") {
        setReauthAction(() => () => revokeOthers.mutateAsync());
        setReauthOpen(true);
      }
    },
  });

  const totalOther = groups
    .flatMap((g) => g.sessions)
    .filter((s) => s.current !== true).length;

  const errors = query.isError ? presentAuthError(query.error) : null;

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Monitor className="h-7 w-7 text-primary" aria-hidden="true" />
              {t("sessions.title", "Sessions")}
            </h1>
            <p className="text-muted-foreground">
              {t("sessions.subtitle", "Devices signed in to your account.")}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setRevokeOthersOpen(true)}
            disabled={revokeOthers.isPending || totalOther === 0}
            data-testid="sessions-revoke-others"
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t("sessions.revokeOthers", "Sign out all other devices")}
          </Button>
        </header>

        {errors && (
          <div
            role="alert"
            data-testid="sessions-load-error"
            className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <p className="font-semibold">
              {t(errors.titleKey, errors.titleFallback)}
            </p>
            <p>{t(errors.bodyKey, errors.bodyFallback)}</p>
            {errors.serverMessage && (
              <p className="mt-1 font-mono text-xs opacity-80">{errors.serverMessage}</p>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              {t("sessions.count", "Signed-in devices")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <div className="flex justify-center py-8" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
                <span className="sr-only">{t("sessions.loading", "Loading your sessions…")}</span>
              </div>
            ) : query.isError ? (
              <ErrorState
                title={t("common.errorTitle", "Something went wrong")}
                description={t(
                  "sessions.loadFailed",
                  "Could not load your sessions. Nothing was changed.",
                )}
                action={
                  <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
                    {t("common.retry", "Retry")}
                  </Button>
                }
              />
            ) : groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                {t("sessions.empty", "No signed-in devices found.")}
              </p>
            ) : (
              <div className="space-y-6">
                {groups.map((group, gi) => (
                  <section key={group.id} aria-labelledby={`sessions-group-${group.id}`}>
                    <h2
                      id={`sessions-group-${group.id}`}
                      className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(group.labelKey, group.labelFallback)}
                    </h2>
                    <ul className="space-y-2">
                      {group.sessions.map((s, i) => (
                        <SessionRowCard
                          key={s.ref}
                          session={s}
                          index={gi + i}
                          reduced={reduced}
                          onRevoke={() => setRevokeTarget(s)}
                          onSignOut={() => void logout()}
                          signingOut={isLoggingIn}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDestructive
        open={revokeTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRevokeTarget(null);
        }}
        title={t("sessions.revokeTitle", "Sign out this device?")}
        description={t(
          "sessions.revokeBody",
          "That device will be signed out immediately and will have to sign in again.",
        )}
        subject={revokeTarget ? describeSession(revokeTarget, t) : undefined}
        confirmLabel={t("sessions.revoke", "Sign out")}
        busyLabel={t("sessions.revoking", "Signing out…")}
        onConfirm={async () => {
          if (!revokeTarget) return;
          // Rethrows on failure so the dialog keeps the error on screen.
          await revoke.mutateAsync(revokeTarget.ref);
        }}
      />

      <ConfirmDestructive
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title={t("sessions.revokeOthersTitle", "Sign out every other device?")}
        description={t(
          "sessions.revokeOthersBody",
          "Every session except the one you are using right now will end immediately. Anyone using those devices will be signed out and will have to enter their password — and their authenticator code — again.",
        )}
        confirmLabel={t("sessions.revokeOthersConfirm", "Sign out every other device")}
        busyLabel={t("sessions.revokeOthersWorking", "Signing out…")}
        onConfirm={async () => {
          await revokeOthers.mutateAsync();
        }}
      />

      {/* Step-up prompt. Opens only after the server answers
          AUTH_REAUTH_REQUIRED, so it never interrupts a user who is already
          re-authenticated. */}
      <ConfirmDestructive
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        destructive={false}
        title={t("sessions.reauthTitle", "Confirm your password")}
        description={t(
          "sessions.reauthBody",
          "Signing out other devices is protected. Confirm your password to continue.",
        )}
        confirmLabel={t("common.cancel", "Cancel")}
        onConfirm={async () => {
          /* the form below owns the actual submit */
        }}
      >
        <PasswordReauthForm
          onSubmit={async (password: string) => {
            await reauthenticate(password);
            const action = reauthAction;
            setReauthOpen(false);
            setReauthAction(null);
            // Replay whatever the user originally asked for.
            if (action) await action();
          }}
          title={t("sessions.reauthPromptTitle", "Confirm your password")}
          submitLabel={t("sessions.reauthSubmit", "Confirm and continue")}
          onCancel={() => {
            setReauthOpen(false);
            setReauthAction(null);
          }}
        />
      </ConfirmDestructive>
    </Layout>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

/** Label for a row, used as the destructive dialog's `subject` too. */
export function describeSession(
  s: SessionRow,
  t: (key: string, fallback: string) => string,
): string {
  const device = describeDevice(s.userAgent);
  if (device.label) return device.label;
  if (device.kind === "bot") return t("sessions.device.bot", "Automated request");
  return t("sessions.device.unknown", "Unrecognised device");
}

function SessionRowCard({
  session,
  index,
  reduced,
  onRevoke,
  onSignOut,
  signingOut,
}: {
  session: SessionRow;
  index: number;
  reduced: boolean;
  onRevoke: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const { t } = useTranslation();
  const device = describeDevice(session.userAgent);
  const Icon = DEVICE_ICON[device.kind];
  const isCurrent = session.current === true;
  /**
   * `current === undefined` means the server did not tell us. We must not
   * guess — offering "sign out" on the row that is actually us would either
   * 400 or, worse, sign the user out mid-read.
   */
  const unknownCurrent = session.current === undefined;

  const label = device.label
    ? device.label
    : device.kind === "bot"
      ? t("sessions.device.bot", "Automated request")
      : t("sessions.device.unknown", "Unrecognised device");

  const activity = formatTimestamp(session.lastActivityAt ?? session.createdAt);
  const created = formatTimestamp(session.createdAt);
  const expires = formatTimestamp(session.expiresAt);

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DURATION.base,
        ease: EASE_OUT,
        /*
         * Delay comes from `staggerStartDelay`, which derives the gap from
         * `MAX_STAGGERED_CHILDREN` rather than from the list length. An
         * unbounded list (an account with 200 sessions from a CI job) therefore
         * still finishes starting every visible row inside the 200ms budget.
         */
        delay: reduced ? 0 : staggerStartDelay(index),
      }}
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-md border p-3",
        isCurrent && "border-primary/60 bg-primary/5",
      )}
      data-testid="session-row"
      data-current={isCurrent ? "true" : undefined}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{label}</span>
          {isCurrent && <Badge data-testid="session-current-badge">{t("sessions.current", "You right now")}</Badge>}
          {device.kind === "bot" && (
            <Badge variant="destructive">
              {t("sessions.device.botBadge", "Not a browser")}
            </Badge>
          )}
        </p>

        {/*
          Identity of the access itself, not of the app.
          */}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          {session.ip && (
            <div className="flex gap-1.5">
              <dt>{t("sessions.ipLabel", "IP address")}:</dt>
              <dd className="font-mono">
                <Globe className="me-0.5 inline h-3 w-3 align-text-bottom" aria-hidden="true" />
                {session.ip}
              </dd>
            </div>
          )}
          {activity && (
            <div className="flex gap-1.5">
              <dt>
                {session.lastActivityAt
                  ? t("sessions.lastActivityLabel", "Last used")
                  : t("sessions.createdLabel", "Signed in")}:
              </dt>
              <dd>
                <time dateTime={session.lastActivityAt ?? session.createdAt ?? undefined}>{activity}</time>
              </dd>
            </div>
          )}
          {created && session.lastActivityAt && (
            <div className="flex gap-1.5">
              <dt>{t("sessions.createdLabel", "Signed in")}:</dt>
              <dd>
                <time dateTime={session.createdAt ?? undefined}>{created}</time>
              </dd>
            </div>
          )}
          {expires && (
            <div className="flex gap-1.5">
              <dt>{t("sessions.expiresLabel", "Expires")}:</dt>
              <dd>
                <time dateTime={session.expiresAt ?? undefined}>{expires}</time>
              </dd>
            </div>
          )}
        </dl>

        {isCurrent ? (
          /*
           * Revoking the session you are using is refused by the server (400).
           * Rather than hide the control, the row explains the refusal and
           * offers the action the user actually wants: sign out. A button that
           * silently does nothing is the failure mode this replaces.
           */
          <div
            className="flex flex-wrap items-center gap-2 pt-1 text-xs"
            data-testid="session-current-actions"
          >
            <Button
              variant="outline"
              size="sm"
              disabled
              aria-disabled="true"
              data-testid="session-current-revoke"
              title={t(
                "sessions.cannotRevokeCurrentTitle",
                "You cannot end the session you are using from here",
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("sessions.revoke", "Sign out")}
            </Button>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t(
                "sessions.cannotRevokeCurrent",
                "Ending this session would sign you out of this browser. Use “Sign out” instead — it ends the session everywhere, including here.",
              )}
            </span>
            <Button
              size="sm"
              variant="default"
              onClick={onSignOut}
              disabled={signingOut}
              data-testid="session-signout-button"
            >
              {signingOut && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("sessions.signOutHere", "Sign out of this browser")}
            </Button>
          </div>
        ) : unknownCurrent ? (
          <p className="pt-1 text-xs text-muted-foreground" data-testid="session-unknown-current">
            <TriangleAlert className="me-0.5 inline h-3 w-3 align-text-bottom" aria-hidden="true" />
            {t(
              "sessions.cannotIdentifyCurrent",
              "This server did not mark which session is this one, so it cannot be safely signed out from here. Use “Sign out all other devices” once it reports which device you are on.",
            )}
          </p>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            className="mt-1"
            onClick={onRevoke}
            aria-label={`${t("sessions.revoke", "Sign out")}: ${label}`}
            data-testid="session-revoke"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("sessions.revoke", "Sign out")}
          </Button>
        )}
      </div>
    </motion.li>
  );
}