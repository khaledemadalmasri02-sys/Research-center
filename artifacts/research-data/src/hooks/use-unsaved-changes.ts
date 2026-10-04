import * as React from "react";

/**
 * Warn the user before they navigate away or close the tab while a form
 * has unsaved changes. Pass `dirty=true` when the form is in a modified
 * state. The hook:
 *
 * - Calls `beforeunload` to block native tab close / refresh.
 * - Patches `history.pushState` and `history.replaceState` so client-side
 *   route changes fire a confirmation prompt (works for wouter, react-router,
 *   and any other client router that goes through the History API).
 *
 * Cleanup runs on unmount or when `dirty` flips back to false.
 *
 * NOTE: this uses the native, **untranslated** `window.confirm`, which can
 * only offer leave/stay. New code should prefer {@link useNavigationGuard},
 * which raises a three-way in-app dialog (Save draft / Discard / Stay).
 */
export function useUnsavedChanges(dirty: boolean, message = "You have unsaved changes. Leave anyway?") {
  React.useEffect(() => {
    if (!dirty || typeof window === "undefined") return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    const wrap = (method: "pushState" | "replaceState") => {
      const original = history[method];
      const wrapped: typeof history[typeof method] = function (
        this: History,
        data: any,
        unused: string,
        url?: string | URL | null,
      ) {
        if (typeof url === "string" && url !== window.location.pathname + window.location.search) {
          if (!window.confirm(message)) return;
        }
        return original.call(this, data, unused, url);
      };
      history[method] = wrapped;
      return () => {
        history[method] = original;
      };
    };

    const unPush = wrap("pushState");
    const unReplace = wrap("replaceState");

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unPush();
      unReplace();
    };
  }, [dirty, message]);
}

/* -------------------------------------------------------------------------- */
/* Three-way navigation guard                                                  */
/* -------------------------------------------------------------------------- */

type PendingNav = {
  method: "pushState" | "replaceState";
  data: unknown;
  unused: string;
  url: string;
};

/**
 * Like {@link useUnsavedChanges} but renders nothing and leaves the decision
 * to the caller: an attempted navigation is intercepted, reverted, and exposed
 * via `open`. The caller renders a three-way dialog and then calls
 * `proceed()`, `discardAndProceed()`, or `stay()`.
 *
 * This is what a clinical form needs. The native confirm cannot offer "Save
 * draft", and on a 40-field patient record losing every keystroke to a
 * refresh is a real harm, not a nuisance.
 *
 * `beforeunload` is still registered: the browser's tab-close prompt cannot be
 * customised, but blocking the close outright is better than silently losing
 * the record.
 */
export function useNavigationGuard(dirty: boolean, message?: string) {
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef<PendingNav | null>(null);
  const bypass = React.useRef(false);
  const originals = React.useRef<Partial<Record<PendingNav["method"], typeof history.pushState>>>({});

  const proceed = React.useCallback(() => {
    const nav = pending.current;
    pending.current = null;
    bypass.current = true;
    try {
      if (nav) {
        const original = originals.current[nav.method];
        original?.call(history, nav.data, nav.unused, nav.url);
      }
    } finally {
      // Reset on the next tick: wouter reads the URL synchronously during the
      // patched call, and re-arming immediately would re-intercept it.
      window.setTimeout(() => {
        bypass.current = false;
      }, 0);
    }
    setOpen(false);
  }, []);

  const stay = React.useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  React.useEffect(() => {
    if (!dirty || typeof window === "undefined") return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message ?? "";
      return message ?? "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    const wrap = (method: "pushState" | "replaceState") => {
      const original = history[method];
      originals.current[method] = original;
      const wrapped: typeof history[typeof method] = function (
        this: History,
        data: any,
        unused: string,
        url?: string | URL | null,
      ) {
        const current = window.location.pathname + window.location.search;
        const isNavigation =
          (typeof url === "string" || url instanceof URL) &&
          String(url) !== current &&
          !bypass.current;

        if (isNavigation) {
          // Put the address bar back where it was: the router never sees this
          // call, so React state and history stay in sync.
          original.call(history, history.state, "", window.location.href);
          pending.current = {
            method,
            data,
            unused,
            url: String(url),
          };
          setOpen(true);
          return;
        }
        return original.call(this, data, unused, url);
      };
      history[method] = wrapped;
      return () => {
        history[method] = original;
        delete originals.current[method];
      };
    };

    const unPush = wrap("pushState");
    const unReplace = wrap("replaceState");

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unPush();
      unReplace();
      pending.current = null;
      setOpen(false);
    };
  }, [dirty, message]);

  return { open, proceed, stay };
}