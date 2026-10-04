import * as React from "react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

interface AnnouncerCtx {
  /** Announce a message via the polite live region. */
  announce: (msg: string) => void
  /** Announce a message via the assertive live region (interrupts current speech). */
  announceAssertive: (msg: string) => void
}

const Ctx = createContext<AnnouncerCtx | null>(null)

/**
 * Two hidden ARIA live regions — one polite, one assertive. Mount once
 * near the root of the app; consumers can call `announce(msg)` from
 * anywhere to surface status updates to screen readers without
 * stealing focus.
 */
export function LiveRegionProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("")
  const [assertive, setAssertive] = useState("")
  const clearTimers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      clearTimers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const announce = useCallback((msg: string) => {
    // Clear first so identical consecutive messages re-announce.
    setPolite("")
    const t = window.setTimeout(() => setPolite(msg), 30)
    clearTimers.current.push(t)
  }, [])

  const announceAssertive = useCallback((msg: string) => {
    setAssertive("")
    const t = window.setTimeout(() => setAssertive(msg), 30)
    clearTimers.current.push(t)
  }, [])

  return (
    <Ctx.Provider value={{ announce, announceAssertive }}>
      {children}
      {/* Visually hidden but readable by AT. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="sr-only"
      >
        {polite}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        className="sr-only"
      >
        {assertive}
      </div>
    </Ctx.Provider>
  )
}

export function useLiveAnnouncer(): AnnouncerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return { announce: () => {}, announceAssertive: () => {} }
  }
  return ctx
}
