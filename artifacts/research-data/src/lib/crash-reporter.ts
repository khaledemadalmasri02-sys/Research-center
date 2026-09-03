/**
 * Crash reporter.
 *
 * The frontend hooks three crash sources into this module:
 *   1. React render-time errors (ErrorBoundary.componentDidCatch)
 *   2. Unhandled promise rejections (window.onunhandledrejection)
 *   3. Uncaught window errors (window.onerror)
 *
 * What we do here is deliberately minimal:
 *   - In dev: console.error with a tagged prefix so the dev sees it.
 *   - In prod: POST the crash payload to /api/crash-report. The
 *     payload is shape-stable so the receiver can switch to Sentry
 *     (or any other backend) without changing the sender.
 *
 * We intentionally do NOT depend on @sentry/react. Sentry's SDK
 * is heavy (~50 KB gzipped), and the api-server's crash-report
 * endpoint already writes to pino. The integration is a one-liner
 * when the project decides to add Sentry.
 */

export interface CrashReport {
  kind: "react" | "unhandledrejection" | "windowerror";
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  ts: string;
  // Free-form context callers may attach. Keep small; no PII.
  context?: Record<string, unknown>;
}

const REPORT_ENDPOINT = "/api/crash-report";

// A simple in-memory dedup. The first send for a given message goes
// through; subsequent identical messages within DEDUP_WINDOW_MS are
// dropped. This keeps a render-loop bug from generating 1000s of
// reports in a few seconds.
const recent = new Map<string, number>();
const DEDUP_WINDOW_MS = 5_000;

/**
 * Test-only: clear the in-memory dedup state so each test starts
 * from a clean slate. Exported here so the test file doesn't need
 * to reach into module internals.
 */
export function _resetCrashDedup(): void {
  recent.clear();
}

/**
 * Indirection so tests can override the dev check. `import.meta.env.DEV`
 * is a build-time constant in Vite; tests want to drive it dynamically.
 */
function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget crash report. Always safe to call — never throws
 * out to the caller.
 */
export function reportCrash(report: CrashReport): void {
  const key = `${report.kind}:${report.message}`;
  const last = recent.get(key) ?? 0;
  const now = Date.now();
  if (now - last < DEDUP_WINDOW_MS) {
    return;
  }
  recent.set(key, now);

  // Trim the dedup map so it doesn't grow forever.
  if (recent.size > 200) {
    for (const [k, t] of recent) {
      if (now - t > DEDUP_WINDOW_MS * 10) recent.delete(k);
    }
  }

  if (isDev()) {
    // Tagged so dev can grep.
    // eslint-disable-next-line no-console
    console.error(
      "[crash-reporter]",
      report.kind,
      report.message,
      report.stack,
    );
    return;
  }  // Prod: POST. Use sendBeacon when available so the request
  // survives page navigation (which is common during a crash).
  try {
    const body = JSON.stringify(report);
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(REPORT_ENDPOINT, blob);
      if (ok) return;
    }
    // Fallback to fetch + keepalive so the request survives even
    // when sendBeacon isn't available (older browsers, WebView).
    void fetch(REPORT_ENDPOINT, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {
      /* swallow — we don't want the reporter to throw during a crash */
    });
  } catch {
    /* never let the reporter throw out */
  }
}

/**
 * Wire window-level handlers. Idempotent: safe to call multiple
 * times (e.g. if a hot-reload re-runs `main.tsx`).
 */
let installed = false;
export function installGlobalHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => {
    reportCrash({
      kind: "windowerror",
      message: e.message || "(no message)",
      stack: e.error instanceof Error ? e.error.stack : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      ts: new Date().toISOString(),
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const err = e.reason;
    reportCrash({
      kind: "unhandledrejection",
      message:
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "(non-error rejection)",
      stack: err instanceof Error ? err.stack : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      ts: new Date().toISOString(),
    });
  });
}
