# Motion

How animations work across the app, what the rules are, and where to
add new ones.

The motion library is **framer-motion**. We respect
`prefers-reduced-motion` globally via `<MotionConfig
reducedMotion="user">` at the app root — every `motion.*` component
and every `transition` short-circuits when the user has reduced motion
enabled.

---

## 1. Vocabulary (`lib/motion.tsx`)

A single file owns the easing and the entrance primitives. **Add new
reusable motion here, not inline in pages.**

```ts
export const EASE_OUT = [0.22, 1, 0.36, 1] as const   // "easeOutExpo"
export const containerVariants: Variants   // staggerChildren: 0.07, delayChildren: 0.04
export const itemVariants: Variants       // opacity 0→1, y 16→0, duration 0.45, ease EASE_OUT
export const hoverLift                     // y: -4, spring(320, 24)
```

**There is no `DURATION` map.** An earlier revision of this document
documented `export const DURATION = { fast, base, slow }` from this module.
No such export has ever existed — the file exports `EASE_OUT`,
`containerVariants`, `itemVariants`, `hoverLift` and nothing else. The
numeric durations live in the §2 table below and at their call sites.

`<Stagger>` and `<StaggerItem>` are the workhorses for list reveal:

```tsx
<Stagger>
  {items.map(it => <StaggerItem key={it.id}>{it.name}</StaggerItem>)}
</Stagger>
```

`<Stagger delay={0.04} stagger={0.07}>` and `<StaggerItem lift>` are the
props. `<FadeIn delay={…} y={12}>` is a one-shot for hero text or page
headers (0.5 s, `EASE_OUT`).

> Why a single file? So a future "disable all non-essential motion"
> kill switch has one place to edit.

---

## 2. Defaults

| Use | Duration | Easing | Notes |
|---|---|---|---|
| Hover (color) | 150 ms | `ease-out` | CSS `transition-colors` |
| Tap scale | 100 ms | spring | 0.97 scale on `:active` |
| Dialog open/close | 180 ms | `easeOut` | Radix `data-[state]` |
| Tooltip | 80 ms | `ease-out` | 4 px y-offset |
| Toast enter | 220 ms | spring | Slide from right + slight bounce |
| Toast exit | 160 ms | `ease-in` | Fade out |
| Page transition | 280 ms | `easeOut` | `AnimatedRoutes` in `App.tsx` |
| Stagger gap | 70 ms | — | `staggerChildren: 0.07`, `delayChildren: 0.04` |
| Stagger item | 450 ms | `EASE_OUT` | `itemVariants` |
| `FadeIn` | 500 ms | `EASE_OUT` | `FadeIn` component |
| Hover lift | spring `320/24` | — | `hoverLift`, `y: -4` |
| **Window open (shell)** | **180 ms** | `easeOut` | `scale 0.96 → 1` + fade |
| **Window close (shell)** | **180 ms** | `easeOut` | `scale 1 → 0.92` + fade |
| **Window minimize (shell)** | **180 ms** | `easeOut` | in-place `opacity → 0`, `scale → 0.85` — **no `layoutId`** |
| Dock expand/collapse | 300 ms | `easeOut` | `width` tween, `Dock.tsx:146` |
| Dock icon label reveal | 180 ms | `easeOut` | `Dock.tsx:161` |
| Tab pill slide | — | shared `layoutId` | `<AnimatedTabs>`, `animated-tabs.tsx:71` |

If you find yourself reaching for a value not in this table, prefer
to extend the table rather than hardcode it.

---

## 3. Stagger rules

- **40–80 ms** between children is the sweet spot. Below 30 ms reads
  as one motion; above 120 ms it gets boring.
- **Don't stagger more than ~20 items** in a single list — the last
  item feels forgotten. For longer lists, fade in the first viewport's
  worth and lazily reveal as the user scrolls.
- **Don't stagger on enter + exit simultaneously**. The
  `<AnimatedRoutes>` page transition uses `mode="wait"` so the
  outgoing page finishes before the incoming one starts.

---

## 4. Page transitions

`<AnimatedRoutes>` in `App.tsx` wraps `<Switch>` with
`<AnimatePresence mode="wait" initial={false}>`. Each route fades up
on enter (`y: 10 → 0`, opacity `0 → 1`, 280 ms). The first render
skips the initial animation (`initial={false}`) so the app appears
immediately.

> Do not add custom page transitions inside individual pages — let
> `AnimatedRoutes` do it. If a page needs a one-off intro, use
> `<FadeIn>` on its hero element, not on the whole page.

---

## 5. Window & dock (Ubuntu shell)

The shell has its own choreography, all implemented in
`components/desktop/`:

- **Window open/close**: `scale 0.96 → 1` + fade on open; the reverse with
  `scale → 0.92` on close. **Both are 180 ms** `easeOut` — a single
  `transition={{ duration: 0.18, ease: "easeOut" }}` drives initial,
  animate and exit (`Window.tsx:418-428`). (An earlier revision of this doc
  said close was 160 ms; it is not.)
- **Window focus**: a 2 px accent ring (`ring-2 ring-[var(--accent-brand)]`,
  or `ring-1 ring-border` when inactive) plus an inset highlight. Instant;
  no spring, so it doesn't read as "the window is moving".
- **Window minimize**: an **in-place** transition on the window itself —
  `opacity → 0` and `scale → 0.85` over 180 ms — after which the window is
  `visibility: hidden`, `pointer-events: none` and `inert`
  (`Window.tsx:412-425`). Restoring runs it in reverse and announces
  "Restored: <app>" via the live region (`Desktop.tsx:146-147`).
- **Edge snap**: drag-to-edge preview uses a flat color, no spring
  (snapping should feel decisive). Implemented in `Window.tsx`
  (`computeSnapZone` / `applySnap`).
- **Dock expand/collapse**: `width` tween, 300 ms `easeOut`
  (`Dock.tsx:146`). Icon labels fade/reveal over 180 ms
  (`Dock.tsx:161`) — the previous "stagger in 20 ms" in this doc was
  wrong.
- **Window stacking**: `zIndex` from the store is now actually rendered,
  via `windowZ()` from `components/desktop/z-index.ts`. That module is the
  single source of truth for the shell's stacking order
  (`Z.wallpaper` 0, `Z.window` 10, `Z.snapPreview` 11, `Z.dock` 20,
  `Z.topbar` 30, `Z.menu` 50, `Z.modal`/`Z.launcher` 60, `Z.popover` 70,
  `Z.toast` 80; windows offset above `WINDOW_Z_BASE` 100 with a 10-step
  stride). Before that pass, `zIndex` was tracked and never applied, so
  stacking was DOM array order and the entire focus system was a no-op.

### There is no `layoutId` minimize choreography

This is the single most misleading claim in the previous revision of this
document, and it has been repeated in `docs/ui-ux-audit.md`:

> "Window minimize: `layoutId` to dock icon. This is the 'magical' detail —
> don't replace it."

**No `layoutId` exists anywhere in the desktop shell.** Every `layoutId`
in the codebase is in the classic shell or a UI primitive:

| `layoutId` | Where | Purpose |
|---|---|---|
| `animated-tabs-pill` | `components/ui/animated-tabs.tsx:71` | the sliding tab pill |
| `sidebar-active` | `components/layout.tsx:224` | classic bottom-nav active pill |
| `sidebar-active-pill` / `sidebar-active-bar` | `components/sidebar/AppSidebar.tsx:196,201` | sidebar active indicator |

A doc that says "don't replace this" about code that isn't there stops the
next engineer from fixing the actual behaviour, so it is removed rather than
repeated. If you want a real minimize-to-dock animation, it is a *new*
feature, not a repair: it needs a `layoutId` shared between the window and
its dock button, and framer's layout projection has to be tested against
the shell's `visibility`/`inert` handling (which currently removes the
minimized window from the render tree's accessibility surface and would
have to be relaxed for the duration of the animation).

---

## 6. Tabs

`components/ui/tabs.tsx` is the default shadcn `<Tabs>` (background
on the active trigger). For pages where a sliding pill is on-brand,
use `components/ui/animated-tabs.tsx` (`<AnimatedTabs>` family)
which uses framer's `layoutId="animated-tabs-pill"` to animate
between triggers.

The pill renders **on every trigger** (always mounted, hidden by
opacity), so framer measures both and animates the move. Don't
change this to a conditional render or the animation breaks.

---

## 7. Reduced motion

Three layers, and you need all three:

1. **framer-motion.** The global `<MotionConfig reducedMotion="user">`
   at the app root (`App.tsx:228`) short-circuits every `motion.*` component
   and every transform/opacity transition when the user prefers reduced
   motion. It does **not** affect layout-affecting properties, and it does
   not help outside React.
2. **CSS.** `@media (prefers-reduced-motion: reduce)` in `index.css:494-506`
   drops `animation-duration` / `transition-duration` to `0.001ms` and
   `animation-iteration-count` to 1 for every element, and sets
   `scroll-behavior: auto` on `html`. A second block disables
   `.auth-orb-animate`. `@media print` re-applies the same zeroing.
3. **Per-call-site gating with `useReducedMotion()`.** Where a motion is
   driven by framer's `animate` prop (which `MotionConfig` does not
   fully cover for a conditional target state), gate it explicitly:

   ```ts
   const reduceMotion = useReducedMotion();
   animate={win.minimized
     ? reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }
     : { opacity: 1, scale: 1 }}
   exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
   ```

   (`Window.tsx:418-428`.) `prefers-reduced-data: reduce` is handled
   separately in CSS (drops glass blur and all gradients,
   `index.css:762-771`), and `prefers-contrast: more` is handled at
   `index.css:742-759`.

There is also a plain-function helper, `prefersReducedMotion()` in
`lib/motion-preferences.ts`, for non-React callers (e.g. deciding whether to
autoplay a tour `<video>` in `product-tour.tsx:77`).

**Stacking order note:** `src/components/desktop/z-index.ts` exports a
TypeScript scale (`Z`, `z()`, `windowZ()`, `WINDOW_Z_BASE`,
`WINDOW_Z_STRIDE`), **not** CSS custom properties. Its header comment asks
the token owner to declare `--z-wallpaper` … `--z-toast` in `index.css`;
those declarations do not exist yet, so every consumer sets the value
through the inline `style` prop via `z()`. Not motion, but it lives in the
same folder — see §5.

Test the entire app with reduced motion on. Every animation should
either:
1. **Stop** (state changes are instant, e.g. window focus ring).
2. **Substantially shorten** (e.g. shimmer becomes a static placeholder).
3. **Be replaced with a non-animated cue** (e.g. error → persistent
   red border instead of shake).

If you find a place where reduced-motion is missing, fix it before
shipping.

---

## 8. Performance

- Prefer **transform** and **opacity** for animations; they composite
  on the GPU and don't trigger layout.
- `will-change` is rarely worth it. The browser only allocates the
  layer for the duration of the animation; a permanent `will-change`
  just spends memory.
- For long lists, virtualize before animating (PR5 ships the
  `<DataTable>` virtualizer). Animating 10 000 DOM nodes is a
  guaranteed jank.
- Keep total paint under **16 ms** per frame for 60 fps. If a single
  spring takes longer than that, it usually means you're animating
  something layout-heavy (width/height of a deep tree).

---

## 9. Adding a new motion

1. Pick a token from the table in §2. If none fits, add one to the
   table and to `lib/motion.tsx`.
2. If the motion is reusable (a list, a card, a button), add a
   variant or component to `lib/motion.tsx`.
3. If it's one-off (a hero illustration), keep the call site readable:
   3–4 lines max.
4. Test with `prefers-reduced-motion` on.
5. Update this doc if you introduced a new token.
