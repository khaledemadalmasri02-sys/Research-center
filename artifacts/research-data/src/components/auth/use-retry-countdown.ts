import { useEffect, useState } from "react";

/**
 * Live countdown for `AUTH_RATE_LIMITED`.
 *
 * The backend sends `retryAfterSec` on every 429. Rendering that number once
 * and then leaving it on screen is worse than useless — the user cannot tell
 * whether the wait is over, so they either hammer the button or give up. This
 * ticks it down once a second and reports `0` the moment it elapses, which is
 * the UI's cue to re-enable Submit.
 *
 * Returns `null` when there is no countdown at all (no throttle, or the field
 * was missing), which is deliberately distinct from `0` ("the wait is over").
 *
 * A note on reduced motion: a countdown is *information*, not decoration, so
 * it runs regardless of `prefers-reduced-motion` and `prefers-reduced-data`.
 * Honouring those preferences by freezing a security timer would be actively
 * harmful. The surrounding *animation* is reduced elsewhere; this is text.
 */
export function useRetryCountdown(
  retryAfterSec: number | null | undefined,
): number | null {
  const initial = normalize(retryAfterSec);
  const [remaining, setRemaining] = useState<number | null>(initial);

  // Re-seed whenever a new throttle arrives (including going back to none).
  useEffect(() => {
    setRemaining(normalize(retryAfterSec));
  }, [retryAfterSec]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const id = setTimeout(() => {
      setRemaining((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  return remaining;
}

function normalize(seconds: number | null | undefined): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.ceil(seconds));
}
