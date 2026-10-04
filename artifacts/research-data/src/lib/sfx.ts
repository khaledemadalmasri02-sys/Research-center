/**
 * Sound effects — Web Audio API primitives.
 *
 * Goals
 * - No asset bloat: every sound is generated on the fly.
 * - No autoplay: the AudioContext is created lazily, on the first user
 *   pointerdown/keydown. Until then every `play*` call is a no-op.
 * - Respect `prefers-reduced-motion`: the provider reports that flag up
 *   the chain and refuses to play in that mode.
 * - Single-channel: only one sound can play at a time; new sounds cut
 *   the previous one. This avoids the cacophony of overlapping
 *   notification chimes.
 *
 * Naming follows the "sound map" doc in `.kilo/agent/PLAN.md` PR10.
 */

type OscType = OscillatorType

interface BlipOptions {
  /** Base frequency in Hz. Default 800. */
  freq?: number
  /** Duration in ms. Default 50. */
  durationMs?: number
  /** Oscillator wave. Default "triangle". */
  type?: OscType
  /** Peak gain (0–1). Default 0.1. */
  gain?: number
}

interface SweepOptions extends BlipOptions {
  /** End frequency in Hz. Required. */
  endFreq: number
}

interface NoiseOptions {
  durationMs?: number
  gain?: number
  /** Lowpass cutoff in Hz. Default 1200. */
  cutoff?: number
}

interface ArpeggioOptions {
  /** Frequencies in Hz, played in order. Required. */
  freqs: number[]
  /** Step duration in ms. Default 80. */
  stepMs?: number
  gain?: number
  type?: OscType
}

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
/** Single-slot queue: the currently-playing source so we can cut it. */
let current: { stop: () => void } | null = null

function isAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.AudioContext !== "undefined"
}

function ensureCtx(): AudioContext | null {
  if (!isAvailable()) return null
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
    masterGain = ctx.createGain()
    masterGain.gain.value = 0.85
    masterGain.connect(ctx.destination)
  } catch {
    ctx = null
    masterGain = null
  }
  return ctx
}

/** Called from SoundProvider on first user gesture. Idempotent. */
export function initAudio(): void {
  const c = ensureCtx()
  if (c && c.state === "suspended") {
    void c.resume()
  }
}

function cutoffIfActive(): void {
  if (current) {
    try {
      current.stop()
    } catch {
      /* ignore */
    }
    current = null
  }
}

function scheduleEnvelope(gain: GainNode, peak: number, durationMs: number, startOffset = 0): void {
  if (!ctx) return
  const t0 = ctx.currentTime + startOffset
  const t1 = t0 + durationMs / 1000
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t1)
}

/** A short, soft single-tone blip. */
export function playBlip({ freq = 800, durationMs = 50, type = "triangle", gain = 0.1 }: BlipOptions = {}): void {
  const c = ensureCtx()
  if (!c || !masterGain) return
  cutoffIfActive()

  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.connect(g)
  g.connect(masterGain)
  scheduleEnvelope(g, gain, durationMs)
  osc.start()
  osc.stop(c.currentTime + durationMs / 1000 + 0.02)
  current = {
    stop: () => {
      try {
        osc.stop()
      } catch {
        /* ignore */
      }
    },
  }
}

/** A frequency sweep from `freq` to `endFreq`. */
export function playSweep({ freq = 500, endFreq, durationMs = 120, type = "sine", gain = 0.12 }: SweepOptions): void {
  const c = ensureCtx()
  if (!c || !masterGain) return
  cutoffIfActive()

  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  const t0 = c.currentTime
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + durationMs / 1000)
  osc.connect(g)
  g.connect(masterGain)
  scheduleEnvelope(g, gain, durationMs)
  osc.start()
  osc.stop(t0 + durationMs / 1000 + 0.02)
  current = {
    stop: () => {
      try {
        osc.stop()
      } catch {
        /* ignore */
      }
    },
  }
}

/** Filtered white noise burst. Great for whoosh/pop. */
export function playNoise({ durationMs = 200, gain = 0.12, cutoff = 1200 }: NoiseOptions = {}): void {
  const c = ensureCtx()
  if (!c || !masterGain) return
  cutoffIfActive()

  const bufferSize = Math.max(1, Math.floor(c.sampleRate * (durationMs / 1000)))
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = "lowpass"
  filter.frequency.value = cutoff
  const g = c.createGain()
  src.connect(filter)
  filter.connect(g)
  g.connect(masterGain)
  scheduleEnvelope(g, gain, durationMs)
  src.start()
  current = {
    stop: () => {
      try {
        src.stop()
      } catch {
        /* ignore */
      }
    },
  }
}

/** A short arpeggio (one osc retriggered per step). */
export function playArpeggio({ freqs, stepMs = 80, gain = 0.18, type = "sine" }: ArpeggioOptions): void {
  const c = ensureCtx()
  if (!c || !masterGain) return
  cutoffIfActive()

  const totalMs = stepMs * freqs.length
  const gainNode = c.createGain()
  gainNode.connect(masterGain)
  gainNode.gain.setValueAtTime(gain, c.currentTime)
  // Fade out the master so notes blend.
  gainNode.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + totalMs / 1000)

  const oscs: OscillatorNode[] = []
  freqs.forEach((f, i) => {
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = f
    o.connect(gainNode)
    const startAt = c.currentTime + (i * stepMs) / 1000
    o.start(startAt)
    o.stop(startAt + stepMs / 1000 + 0.02)
    oscs.push(o)
  })
  current = {
    stop: () => {
      for (const o of oscs) {
        try {
          o.stop()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

/** Stop whatever is currently playing. */
export function stopAll(): void {
  cutoffIfActive()
}

/** Used by tests / diagnostics. */
export function _debugContext(): AudioContext | null {
  return ctx
}
