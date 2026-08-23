import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";

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

export const TOUR_STEPS: TourStep[] = [
  { key: "welcome", placement: "center" },
  { key: "dashboard", selector: 'a[href="/"]', placement: "right" },
  { key: "patients", selector: 'a[href="/patients"]', placement: "right" },
  { key: "collections", selector: 'a[href="/collections"]', placement: "right" },
  { key: "dataAnalysis", selector: 'a[href="/data-analysis"]', placement: "right" },
  { key: "feedback", selector: 'a[href="/feedback"]', placement: "right" },
  { key: "moreFeatures", selector: 'a[href="/more-features"]', placement: "right" },
  { key: "myActivity", selector: 'a[href="/activity/me"]', placement: "right" },
  { key: "apiTokens", selector: 'a[href="/api-tokens"]', placement: "right" },
  { key: "sessions", selector: 'a[href="/sessions"]', placement: "right" },
  { key: "notifications", selector: '[data-tour="notifications"]', placement: "bottom" },
  { key: "theme", selector: '[data-tour="theme"]', placement: "bottom" },
  { key: "language", selector: '[data-tour="language"]', placement: "bottom" },
  { key: "admin", selector: 'a[href="/admin"]', placement: "right", adminOnly: true },
  { key: "finish", placement: "center" },
];

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

  const steps = TOUR_STEPS.filter((s) => !s.adminOnly || canAdminAccess);

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
