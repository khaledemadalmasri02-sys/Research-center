import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./use-auth";
import { isDesktopMode } from "@/lib/desktop-mode";

const LAST_ACTIVE_KEY = "mr_tour_last_active";
const SEEN_KEY = "mr_tour_seen";
const IDLE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_EVENT = "mr-tour:open";

export interface TourStep {
  key: string;
  /** CSS selector of the element to spotlight. Omit for a centered step. */
  selector?: string;
  /** Preferred side for the tooltip. */
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /** Optional short looping clip shown in the guide card. */
  videoSrc?: string;
  /** Only show this step for admin users. */
  adminOnly?: boolean;
}

/**
 * Every spotlighted step is anchored to a stable `data-tour="<key>"`
 * attribute. The sidebar renders `<button>`s, not `<a>`s, so the previous
 * `a[href="/…"]` selectors never matched anything and 14/14 steps silently
 * degraded to centered cards. Each shell (classic sidebar / desktop dock)
 * now owns one `data-tour` attribute per step; a step whose target is absent
 * from the DOM is dropped rather than rendered as a context-free card.
 */
export const TOUR_STEPS: TourStep[] = [
  { key: "welcome", placement: "center" },
  { key: "dashboard", selector: '[data-tour="dashboard"]', placement: "right" },
  { key: "patients", selector: '[data-tour="patients"]', placement: "right" },
  { key: "collections", selector: '[data-tour="collections"]', placement: "right" },
  { key: "dataAnalysis", selector: '[data-tour="dataAnalysis"]', placement: "right" },
  { key: "feedback", selector: '[data-tour="feedback"]', placement: "right" },
  { key: "moreFeatures", selector: '[data-tour="moreFeatures"]', placement: "right" },
  { key: "myActivity", selector: '[data-tour="myActivity"]', placement: "right" },
  { key: "apiTokens", selector: '[data-tour="apiTokens"]', placement: "right" },
  { key: "sessions", selector: '[data-tour="sessions"]', placement: "right" },
  { key: "notifications", selector: '[data-tour="notifications"]', placement: "bottom" },
  { key: "theme", selector: '[data-tour="theme"]', placement: "bottom" },
  { key: "language", selector: '[data-tour="language"]', placement: "bottom" },
  { key: "admin", selector: '[data-tour="admin"]', placement: "right", adminOnly: true },
  { key: "finish", placement: "center" },
];

function hasTarget(selector: string | undefined): boolean {
  if (!selector) return true;
  if (typeof document === "undefined") return false;
  try {
    return document.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

function readLastActive(): number | null {
  try {
    const v = localStorage.getItem(LAST_ACTIVE_KEY);
    return v ? new Date(v).getTime() : null;
  } catch {
    return null;
  }
}

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function useProductTour() {
  const { authenticated, canAdminAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const sessionShown = useRef(false);

  const authored = useMemo(
    () => TOUR_STEPS.filter((s) => !s.adminOnly || canAdminAccess),
    [canAdminAccess],
  );

  /**
   * Steps that can actually be shown in the *current* shell. Recomputed
   * whenever the tour opens, because the sidebar/dock markup is not in the
   * document before the shell mounts.
   *
   * In desktop mode the classic sidebar never renders, so only the two
   * authored-as-centered steps survive until the desktop dock/top bar grow
   * matching `data-tour` attributes (see the report: the desktop shell
   * should add them; until then the tour degrades instead of lying).
   */
  const steps = useMemo(() => {
    if (!open) return authored;
    const desktop = isDesktopMode();
    return authored.filter((s) => {
      if (!s.selector) return true;
      if (desktop) return false;
      return hasTarget(s.selector);
    });
  }, [authored, open]);

  const bumpLastActive = useCallback(() => {
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, []);

  const openTour = useCallback(
    (reset = true) => {
      if (reset) setStep(0);
      setOpen(true);
      sessionShown.current = true;
      bumpLastActive();
    },
    [bumpLastActive],
  );

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    bumpLastActive();
  }, [bumpLastActive]);

  const next = useCallback(() => {
    setStep((s) => {
      if (s >= steps.length - 1) {
        finish();
        return s;
      }
      return s + 1;
    });
  }, [steps.length, finish]);

  const back = useCallback(() => {
    setStep((s) => (s > 0 ? s - 1 : 0));
  }, []);

  const skip = useCallback(() => {
    finish();
  }, [finish]);

  // The visible list can shrink when the tour opens (a target is missing) or
  // when the user gains admin rights mid-session. Clamp so `step` can never
  // point past the end of the list.
  useEffect(() => {
    setStep((s) => (s > steps.length - 1 ? 0 : s));
  }, [steps.length]);

  // Decide whether to auto-open on sign-in / after idle days.
  useEffect(() => {
    if (!authenticated) return;
    if (sessionShown.current) return;
    const last = readLastActive();
    const seen = readSeen();
    const idleMs = last ? Date.now() - last : Infinity;
    const shouldShow = !seen || idleMs >= IDLE_DAYS * DAY_MS;
    if (shouldShow) openTour(true);
  }, [authenticated, openTour]);

  // Track user activity so the "2 idle days" rule works across reloads.
  useEffect(() => {
    if (!authenticated) return;
    bumpLastActive();
    let throttled = false;
    const onActivity = () => {
      if (throttled) return;
      throttled = true;
      window.setTimeout(() => {
        throttled = false;
      }, 5000);
      bumpLastActive();
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [authenticated, bumpLastActive]);

  // Manual replay via custom event (e.g. a help button).
  useEffect(() => {
    const handler = () => openTour(true);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, [openTour]);

  return {
    open,
    step,
    steps,
    total: steps.length,
    next,
    back,
    skip,
    finish,
    openTour,
  };
}

export function openProductTour() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
