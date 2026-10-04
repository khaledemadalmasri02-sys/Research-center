import { useCallback, useEffect, useState } from "react"

export type Density = "compact" | "comfortable" | "spacious"

/**
 * Canonical persistence key. docs/design-tokens.md §4 ("Density") names this
 * key; index.html's pre-hydration script reads the same one and mirrors it to
 * the root `data-density` attribute so global CSS can key off it before React
 * mounts.
 */
const KEY = "app-table-density"

const LEGACY_KEY = "app-density"

/** Same-document fan-out so every mounted useDensity() consumer re-reads. */
const EVENT = "app-density-change"

/** Canonical option order, for consumers that render a density control. */
export const DENSITIES: readonly Density[] = ["compact", "comfortable", "spacious"]

export const DEFAULT_DENSITY: Density = "comfortable"

function isDensity(v: unknown): v is Density {
  return v === "compact" || v === "comfortable" || v === "spacious"
}

/** Mirror the value onto <html data-density> so CSS can react to it. */
function syncRootAttribute(d: Density): void {
  if (typeof document === "undefined") return
  document.documentElement.setAttribute("data-density", d)
}

function read(): Density {
  if (typeof document === "undefined") return DEFAULT_DENSITY
  // The attribute wins: it is what the pre-hydration script already wrote.
  const attr = document.documentElement.getAttribute("data-density")
  if (isDensity(attr)) return attr
  try {
    const v = localStorage.getItem(KEY)
    if (isDensity(v)) return v
    // Tolerate the key the FOUC script used before the key was unified.
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (isDensity(legacy)) return legacy
  } catch {
    /* localStorage unavailable (private mode) — fall through to the default. */
  }
  return DEFAULT_DENSITY
}

function write(d: Density): void {
  syncRootAttribute(d)
  try {
    localStorage.setItem(KEY, d)
    // Drop the pre-unification key so the two cannot disagree on a later read.
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Single source of truth for table row density.
 *
 * Returns the current density and a setter that persists to localStorage and
 * mirrors to `document.documentElement[data-density]`. Any number of consumers
 * may call `useDensity()`; they stay in sync because the setter also publishes
 * a custom event, which the hook listens for.
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensityState] = useState<Density>(() => read())

  // Keep every mounted consumer in sync with changes made anywhere else
  // (another table on the page, /settings, another browser tab).
  useEffect(() => {
    const onChange = () => setDensityState(read())
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === LEGACY_KEY || e.key === null) onChange()
    }
    window.addEventListener(EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const setDensity = useCallback((d: Density) => {
    write(d)
    setDensityState(d)
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [density, setDensity]
}
