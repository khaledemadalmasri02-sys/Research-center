# Sound

How sound effects are generated, gated, and toggled. Every sound is
synthesized in the browser with the Web Audio API — no asset bundles,
no autoplay, no overlap.

The feature is opt-in by default. **Sound is off until the user turns
it on.** A user who never opens the menu never hears a peep.

---

## 1. The five rules

1. **No autoplay.** The `AudioContext` is created lazily on the first
   `pointerdown` or `keydown`. Until then every `play()` is a no-op.
2. **No sound while the tab is hidden.** Backgrounded tabs are silent.
3. **No sound when `prefers-reduced-motion: reduce` is on.** Sound
   correlates with motion sensitivity; treat them as one knob.
4. **One sound at a time.** New sounds cut the previous one. No
   notification chimes piling up.
5. **Master mute via `M` key, anywhere.** Persisted across reloads.

---

## 2. Sound map

| Name | Trigger | Synthesis | Gain (peak) |
|---|---|---|---|
| `click` | Button press (general) | 800 Hz triangle, 50 ms | 0.08 |
| `toggle-on` | Switch / theme → dark | Sweep 500→900 Hz, 120 ms | 0.10 |
| `toggle-off` | Switch / theme → light | Sweep 900→500 Hz, 120 ms | 0.10 |
| `dialog-open` | Command palette / modal open | 700 Hz sine, 80 ms | 0.07 |
| `success` | Operation completed | C5→E5 arpeggio | 0.16 |
| `error` | Operation failed | 220 Hz square, 180 ms | 0.16 |
| `notification` | Toast appears | A5→C#6 arpeggio | 0.12 |
| `upload-start` | File upload begins | Filtered noise, 220 ms | 0.10 |
| `upload-done` | File upload finished | E5→G5→B5 arpeggio | 0.14 |
| `window-open` | New desktop window | Filtered noise pop, 120 ms | 0.08 |
| `window-close` | Window X button | 400 Hz sine, 100 ms | 0.07 |
| `window-minimize` | Window _ button | Sweep 600→250 Hz, 180 ms | 0.09 |
| `login-success` | OTP / login success | C5→E5→G5 arpeggio | 0.18 |
| `login-fail` | OTP / login failure | 200 Hz square, 200 ms | 0.18 |
| `otp-sent` | Resend code triggered | A5→C6 arpeggio | 0.14 |
| `clipboard` | Copy-to-clipboard | Two short triangle blips | 0.08 |

Add new sounds by extending the `SoundName` union and adding a case
to `playByName()` in `components/sound-provider.tsx`. Keep durations
≤ 300 ms; medical users are often working in shared spaces.

---

## 3. Architecture

```
            ┌─────────────────────┐
            │ components/         │
 click ─────▶│  useSound().play() │──┐
 hover ─────▶│  (gated)           │  │
 dialog ────▶│                    │  │
   ...       └─────────────────────┘  │
                                       ▼
            ┌─────────────────────┐    ┌──────────────────────┐
            │ lib/sfx.ts          │◀───│ playByName()         │
            │ playBlip / playSweep│    │ switch (SoundName)  │
            │ playArpeggio / etc. │    └──────────────────────┘
            └─────────────────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │ AudioContext        │
            │ (single, lazy)      │
            └─────────────────────┘
```

- **`lib/sfx.ts`** owns the `AudioContext` and the four generators
  (`playBlip`, `playSweep`, `playNoise`, `playArpeggio`). The
  generators are pure: they take parameters, schedule the buffer,
  and forget about it.
- **`components/sound-provider.tsx`** owns the gates (enabled flag,
  reduced-motion, `document.hidden`), the `M`-key shortcut, and the
  name → generator mapping.
- **`components/sound-toggle.tsx`** is the UI.

The split lets us unit-test `lib/sfx.ts` (it's a thin wrapper around
`AudioContext` — no React) and gives consumers a stable
`useSound().play(name)` API.

---

## 4. Live-region announcements

When a high-signal sound fires, the announcer also fires:

| Sound | Announced |
|---|---|
| `success`, `login-success`, `upload-done` | "Completed" (polite) |
| `error`, `login-fail` | "Error" (assertive) |
| `notification`, `otp-sent` | "Notification" (polite) |

This keeps the two channels in sync without doubling work at every
call site.

## 4a. Volume

`useSound()` also returns `volume` and `setVolume`. `playByName(name,
volume)` multiplies **every** cue's peak gain by a clamped `0..1` factor
(`components/sound-provider.tsx:81-85`), so the volume control is global
rather than per-cue. The value persists to `localStorage` under
`app-sound-volume` and the slider lives in a popover under the sound
toggle. The per-cue gains in §2 are therefore **pre-volume** peaks; the
audible peak is `peak × volume`.

The gains in §2 have not been re-tuned since `hover` was dropped from the
map. If you add a cue, sanity-check it at `volume = 0.5` before shipping.

---

## 5. Adding a new sound

1. Add the name to the `SoundName` union in
   `components/sound-provider.tsx`.
2. Add a `case` to `playByName()`. Pick one of the four generators;
   if you need a new shape, add it to `lib/sfx.ts` first.
3. If the sound has a screen-reader equivalent, add a line in
   `play()` to announce it.
4. Call `useSound().play("your-name")` from the relevant handler.
5. Mention it in §2 and the IMPROVEMENT_PLAN if it ships a new
   trigger.

---

## 6. Testing

`lib/sfx.ts` exports an internal `_debugContext()` that returns the
`AudioContext`. Use this in unit tests:

```ts
import { initAudio, playBlip, _debugContext } from "@/lib/sfx"
initAudio()
expect(_debugContext()).not.toBeNull()
```

`lib/sfx.ts` exports exactly seven things: `initAudio`, `playBlip`,
`playSweep`, `playNoise`, `playArpeggio`, `stopAll` and `_debugContext`.
There is no `_playBlip` — an earlier revision of this doc imported one and
would not have compiled.

The `AudioContext` can only be created in a browser; mock
`window.AudioContext` for jsdom tests.

---

## 7. Why Web Audio, not `<audio>` tags

| | Web Audio | `<audio>` tags |
|---|---|---|
| Asset weight | 0 KB | 10–50 KB per cue |
| Latency | < 10 ms (when resumed) | 50–150 ms |
| Variability | Identical per device | Varies with browser cache |
| Pause/resume | Trivial | Awkward |
| Volume control | Single gain node per cue | Per-tag |

The trade-off is that **we can't record "real" sounds** (a bell, a
marimba, a piano note) without loading samples. For the cues we need
(blips, sweeps, arpeggios, noise bursts) the trade is clearly worth
it.
