import * as React from "react"
import { playArpeggio, playBlip, playNoise, playSweep, playBlip as _playBlip, initAudio, stopAll } from "@/lib/sfx"
import { useReducedMotion } from "framer-motion"
import { useLiveAnnouncer } from "@/components/live-region"

const STORAGE_KEY = "app-sound-enabled"
const VOLUME_KEY = "app-sound-volume"

export type SoundName =
  | "click"
  | "toggle-on"
  | "toggle-off"
  | "dialog-open"
  | "success"
  | "error"
  | "notification"
  | "upload-start"
  | "upload-done"
  | "window-open"
  | "window-close"
  | "window-minimize"
  | "login-success"
  | "login-fail"
  | "otp-sent"
  | "clipboard"

interface SoundProviderValue {
  enabled: boolean
  volume: number
  setEnabled: (v: boolean) => void
  toggle: () => void
  setVolume: (v: number) => void
  play: (name: SoundName) => void
}

const SoundCtx = React.createContext<SoundProviderValue | null>(null)

function readStored(): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === "1") return true
    if (raw === "0") return false
  } catch {
    /* ignore */
  }
  return false
}

function writeStored(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0")
  } catch {
    /* ignore */
  }
}

function readVolume(): number {
  if (typeof window === "undefined") return 1
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw == null) return 1
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1
  } catch {
    return 1
  }
}

function writeVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v))
  } catch {
    /* ignore */
  }
}

/**
 * Map a sound name to the Web Audio call. Keep the list flat — any
 * complexity here should go in `lib/sfx.ts`, not in a giant switch.
 * The supplied `volume` (0..1) multiplies every cue's peak gain so the
 * global volume slider works across all sounds.
 */
function playByName(name: SoundName, volume: number): void {
  const g = (peak: number) => Math.max(0, Math.min(1, peak * volume))
  switch (name) {
    case "click":
      playBlip({ freq: 800, durationMs: 50, type: "triangle", gain: g(0.08) })
      return
    case "toggle-on":
      playSweep({ freq: 500, endFreq: 900, durationMs: 120, gain: g(0.1) })
      return
    case "toggle-off":
      playSweep({ freq: 900, endFreq: 500, durationMs: 120, gain: g(0.1) })
      return
    case "dialog-open":
      playBlip({ freq: 700, durationMs: 80, type: "sine", gain: g(0.07) })
      return
    case "success":
      // C5 -> E5
      playArpeggio({ freqs: [523.25, 659.25], stepMs: 90, gain: g(0.16), type: "sine" })
      return
    case "error":
      playBlip({ freq: 220, durationMs: 180, type: "square", gain: g(0.16) })
      return
    case "notification":
      playArpeggio({ freqs: [880, 1100], stepMs: 70, gain: g(0.12), type: "sine" })
      return
    case "upload-start":
      playNoise({ durationMs: 220, gain: g(0.1), cutoff: 800 })
      return
    case "upload-done":
      playArpeggio({ freqs: [659.25, 783.99, 987.77], stepMs: 75, gain: g(0.14), type: "sine" })
      return
    case "window-open":
      playNoise({ durationMs: 120, gain: g(0.08), cutoff: 1800 })
      return
    case "window-close":
      playBlip({ freq: 400, durationMs: 100, type: "sine", gain: g(0.07) })
      return
    case "window-minimize":
      playSweep({ freq: 600, endFreq: 250, durationMs: 180, type: "sine", gain: g(0.09) })
      return
    case "login-success":
      playArpeggio({ freqs: [523.25, 659.25, 783.99], stepMs: 110, gain: g(0.18), type: "sine" })
      return
    case "login-fail":
      playBlip({ freq: 200, durationMs: 200, type: "square", gain: g(0.18) })
      return
    case "otp-sent":
      playArpeggio({ freqs: [880, 1046.5], stepMs: 100, gain: g(0.14), type: "sine" })
      return
    case "clipboard":
      playBlip({ freq: 1000, durationMs: 60, type: "triangle", gain: g(0.08) })
      setTimeout(() => playBlip({ freq: 1400, durationMs: 40, type: "triangle", gain: g(0.06) }), 60)
      return
  }
}

interface SoundProviderProps {
  children: React.ReactNode
  /** Disable the keyboard mute shortcut. Default false. */
  disableKeyShortcut?: boolean
}

export function SoundProvider({ children, disableKeyShortcut = false }: SoundProviderProps) {
  const prefersReducedMotion = useReducedMotion()
  const { announce, announceAssertive } = useLiveAnnouncer()
  const [enabled, setEnabledState] = React.useState<boolean>(() => readStored())
  const [volume, setVolumeState] = React.useState<number>(() => readVolume())

  React.useEffect(() => {
    writeStored(enabled)
  }, [enabled])

  React.useEffect(() => {
    writeVolume(volume)
  }, [volume])

  // Initialise AudioContext on the first user interaction.
  React.useEffect(() => {
    const onFirstGesture = () => {
      initAudio()
      window.removeEventListener("pointerdown", onFirstGesture)
      window.removeEventListener("keydown", onFirstGesture)
    }
    window.addEventListener("pointerdown", onFirstGesture, { passive: true })
    window.addEventListener("keydown", onFirstGesture)
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture)
      window.removeEventListener("keydown", onFirstGesture)
    }
  }, [])

  // M-key master mute toggle.
  React.useEffect(() => {
    if (disableKeyShortcut) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return
      if (e.key === "m" || e.key === "M") {
        e.preventDefault()
        setEnabledState((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [disableKeyShortcut])

  const play = React.useCallback(
    (name: SoundName) => {
      // Three guards: opt-in, no reduced-motion, and the page must be
      // visible (a backgrounded tab should never chirp).
      if (!enabled) return
      if (prefersReducedMotion) return
      if (typeof document !== "undefined" && document.hidden) return
      playByName(name, volume)
      // Screen-reader announcements for high-signal events.
      if (name === "success" || name === "login-success" || name === "upload-done") {
        announce("Completed")
      } else if (name === "error" || name === "login-fail") {
        announceAssertive("Error")
      } else if (name === "notification" || name === "otp-sent") {
        announce("Notification")
      }
    },
    [enabled, volume, prefersReducedMotion, announce, announceAssertive],
  )

  const setEnabled = React.useCallback((v: boolean) => {
    setEnabledState(v)
    if (!v) stopAll()
  }, [])

  const toggle = React.useCallback(() => {
    setEnabledState((v) => {
      const next = !v
      if (!next) stopAll()
      return next
    })
  }, [])

  const setVolume = React.useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)))
  }, [])

  const value = React.useMemo<SoundProviderValue>(
    () => ({ enabled, volume, setEnabled, toggle, setVolume, play }),
    [enabled, volume, setEnabled, toggle, setVolume, play],
  )

  return <SoundCtx.Provider value={value}>{children}</SoundCtx.Provider>
}

export function useSound(): SoundProviderValue {
  const ctx = React.useContext(SoundCtx)
  if (!ctx) {
    // Allow the hook to be used outside a provider (no-op fallback).
    return {
      enabled: false,
      volume: 1,
      setEnabled: () => {},
      toggle: () => {},
      setVolume: () => {},
      play: () => {},
    }
  }
  return ctx
}

// Re-export a couple of primitives for ad-hoc usage in tests.
export { _playBlip }
