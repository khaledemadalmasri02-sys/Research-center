import { Component, type ErrorInfo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertOctagon, RefreshCw } from "lucide-react";
import { reportCrash } from "@/lib/crash-reporter";
import { DURATION, EASE_OUT, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches render-time errors in the React tree so the user sees a
 * recoverable error UI instead of a blank page.
 *
 * - In dev: shows the full component stack.
 * - In prod: hides technical details; offers a "Reload" button.
 * - Always: reports the crash to `crashReporter` (which logs in
 *   dev and POSTs to /api/crash-report in prod).
 *
 * The api-server's /api/crash-report endpoint is a thin pino logger
 * that just records the event for later triage. It is intentionally
 * never authenticated (the user can't log in if the app is broken)
 * and rate-limited per-IP at the Worker level.
 */
/**
 * Fallback shell for the error state.
 *
 * `role="alert"` stays on the STATIC outer node and the motion lives on an
 * inner one. Assistive tech announces an alert when the node carrying the role
 * enters the DOM; if the animated element were the alert, an entrance that
 * starts at `opacity: 0` would leave the announcement describing something the
 * user cannot see yet, and any future `visibility`/`display` change on the
 * animated node would silently un-announce a crash. Static wrapper, animated
 * contents: the alert is readable on the first frame and the entrance is
 * decoration.
 *
 * A function component because it needs `useReducedMotion()`; the boundary
 * itself stays a class (it has to be one).
 */
function ErrorFallbackShell({ children }: { children: ReactNode }) {
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  return (
    <div
      role="alert"
      className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground"
    >
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: DURATION.fast, ease: EASE_OUT }}
        className="max-w-xl w-full"
      >
        {children}
      </motion.div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Fire-and-forget; the reporter has its own backoff and dedup.
    void reportCrash({
      kind: "react",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      /* pathname ONLY. The crash report is POSTed to a logger; `href`
       * carried `?tab=…` and `/patients/:id`, i.e. PHI and search terms,
       * into a third-party log store. */
      url: typeof window !== "undefined" ? window.location.pathname : "(server)",
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "(server)",
      ts: new Date().toISOString(),
    });
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = import.meta.env.DEV;
    return (
      <ErrorFallbackShell>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertOctagon className="h-6 w-6 text-destructive" />
            <CardTitle>Something went wrong.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The app hit an unexpected error. Your data is safe — reloading
              the page will start a fresh session. If this keeps happening,
              please contact your administrator with the time it happened.
            </p>

            {isDev && this.state.error && (
              <details className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                <summary className="cursor-pointer font-mono">
                  {this.state.error.name}: {this.state.error.message}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {this.state.error.stack}
                  {this.state.componentStack
                    ? "\n\nComponent stack:\n" + this.state.componentStack
                    : ""}
                </pre>
              </details>
            )}

            <div className="flex gap-2">
              <Button onClick={this.reset}>
                <RefreshCw className="mr-2 h-4 w-4" /> Try again
              </Button>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload page
              </Button>
            </div>
          </CardContent>
        </Card>
      </ErrorFallbackShell>
    );
  }
}
