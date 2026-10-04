# Design tokens

Single source of truth for color, spacing, typography, radius, shadow,
and the few app-specific tokens (glass, density, skeleton). All tokens
are defined as CSS custom properties in
`artifacts/research-data/src/index.css` and consumed via Tailwind's
`@theme inline` map.

> If you change a value here, change it in **one place**: the `:root`
> block (and `.dark` block) in `index.css`. Do not duplicate in TS.

---

## 1. Color

All colors are HSL channels (no comma, no `hsl()` wrapper) so Tailwind
can compose them with the `hsl(var(--token) / <alpha>)` pattern.

### Surface & content

Values below are transcribed from `artifacts/research-data/src/index.css`
(2026-10). If you change a token, change it there and here.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--background` | App background | `210 20% 98%` | `222 47% 11%` |
| `--foreground` | Body text | `222 47% 11%` | `210 40% 98%` |
| `--muted` | Subdued surfaces | `210 40% 96%` | `217 32% 17%` |
| `--muted-foreground` | Subdued text | `215 16% 44%` | `215 20% 65%` |
| `--border` | 1px dividers (passive) | `214 32% 91%` | `217 32% 17%` |
| `--input` | Control boundary | `215 14% 52%` | `215 20% 48%` |
| `--card-border` | Card border | `214 32% 91%` | `217 32% 17%` |
| `--popover-border` | Popover border | `214 32% 91%` | `217 32% 17%` |
| `--ring` | Focus ring | `185 65% 25%` | `185 65% 35%` |
| `--card` | Card surface | `0 0% 100%` | `222 47% 11%` |
| `--card-foreground` | Card text | `222 47% 11%` | `210 40% 98%` |
| `--popover` | Popover surface | `0 0% 100%` | `222 47% 11%` |
| `--popover-foreground` | Popover text | `222 47% 11%` | `210 40% 98%` |

#### `--input` is no longer "same as `--border`"

`--input` is the boundary of an interactive control and must clear WCAG
**1.4.11 Non-text Contrast (3:1)**. `--border` is a passive divider and does
not have that obligation, so the two tokens were split:

| | Old | New | Contrast |
|---|---|---|---|
| light `--input` | `214 32% 91%` (shared with `--border`) | `215 14% 52%` | **1.19 → 3.75:1** on `--background` |
| dark `--input` | `217 32% 17%` (shared with `--border`) | `215 20% 48%` | **1.21 → 3.87:1** on `--background` |

Both new values clear the 3:1 non-text minimum. Under
`@media (prefers-contrast: more)` they are re-pinned to `--border`
(`0 0% 20%` light / `0 0% 80%` dark) because in forced-colors mode the
control boundary is what matters.

### Surface-vs-text splits: `--primary-text` and `--destructive-text`

Two tokens were **added** in 2026-10 and are not in `@theme inline` →
`--color-primary-text` / `--color-destructive-text` (so Tailwind generates
`text-primary-text` and `text-destructive-text`).

The reason is the same in both cases: a single token cannot be both a
**button surface** (needs enough contrast for a white label painted *on*
it) and **text on a surface** (needs enough contrast against the background
*behind* it). Those requirements pull in opposite directions.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--primary` | surface (button fill) | `185 65% 25%` | `185 65% 30%` |
| `--primary-foreground` | label on that surface | `0 0% 100%` | `0 0% 100%` |
| `--primary-text` | `--primary` used as *text* | `185 65% 25%` | `185 70% 58%` |
| `--destructive` | surface (button fill) | `0 84% 60%` | `0 62% 42%` |
| `--destructive-foreground` | label on that surface | `0 0% 100%` | `0 0% 100%` |
| `--destructive-text` | `--destructive` used as *text* | `0 72% 45%` | `0 80% 66%` |

**Do not merge these back.** The regression that motivated the split: dark
`--destructive` was `0 62% 30%` — dark enough to carry a white label
(needed for `bg-destructive`), but **1.75:1 against the dark card**, i.e.
effectively invisible as error text. Form validation messages on
`FormLabel` / `FormMessage` in dark mode were unreadable. Likewise,
dark `--primary` had to darken from `185 65% 35%` to `185 65% 30%` so
white button labels pass 4.5:1, which made it illegible as accent *text*
on the dark background.

Rule of thumb: `bg-destructive` for fills, `text-destructive-text` for
error text. The legacy `text-destructive` utility name still resolves to
`--destructive`, so unmigrated call sites keep compiling — but they render
the surface colour as text, which is the bug. Migrate them.

### `color-scheme`

`:root { color-scheme: light }` and `.dark { color-scheme: dark }` are
declared (`index.css:80`, `:226`). Without them the UA renders native
widgets — `<select>` popups, date pickers, scrollbars, autofill — in its
default **light** appearance even while `.dark` is active. This was the
single most visible dark-mode defect and these two declarations alone fix
it. If you add a third theme mode, it needs its own `color-scheme`.

### Contrast, as measured

Computed with WCAG relative luminance from the values above
(`index.css` inlines most of these figures too):

| Pair | Before | After | Verdict |
|---|---|---|---|
| light `--muted-foreground` on `--muted` | 4.30:1 | **4.79:1** | passes AA |
| light `--input` on `--background` | 1.19:1 | **3.75:1** | passes 1.4.11 |
| dark `--input` on `--background` | 1.21:1 | **3.87:1** | passes 1.4.11 |
| dark `--destructive-text` on `--card` | (n/a — token did not exist) | **5.61:1** | passes AA |
| light `--destructive-text` on `--card` | (n/a) | **5.81:1** | passes AA |
| dark `--primary-text` on `--card` | (n/a) | **9.89:1** | passes AAA |
| dark `--primary`, white label on it | 4.12:1 | **5.33:1** | passes AA |
| dark `--sidebar-primary`, white label on it | 4.12:1 | **5.33:1** | passes AA |
| dark `--muted-foreground` on `--muted` | 5.76:1 | 5.76:1 | unchanged |
| light `--primary`, white label on it | 7.01:1 | 7.01:1 | unchanged |

#### STILL FAILING — light `--destructive`

Light `--destructive` is `0 84% 60%` and `--destructive-foreground` is
`0 0% 100%`. White text on it measures **3.78:1**, which is **below the
4.5:1** required for normal-size text. A `bg-destructive` button with a
visible label in light mode is therefore **not AA-compliant today**.

This is **an open item, not a fixed one.** The tension is structural: the
token has to stay light enough for `--destructive-text` (5.81:1 on a white
card) and dark enough to carry white text — and `0 84% 60%` cannot do both.
Options, none taken yet:

- darken `--destructive` and lighten `--destructive-text` in lockstep
  (changes the brand's error colour);
- ship the destructive Button variant with a dark foreground and a dark
  fill in light mode only;
- accept it with a documented exception.

Whatever is chosen, `SECURITY.md` / this doc must record the decision.
Until then do not claim light-mode destructive buttons pass AA.

### Brand & accent

The Ubuntu desktop shell reads `--accent-brand`, `--accent-soft`, and
`--accent-soft-strong` from the active **theme preset** (set by
`ThemePresetProvider`). Defaults match the "Amethyst" preset so the
shell looks right before hydration.

| Token | Default | Notes |
|---|---|---|
| `--accent-brand` | `#a855f7` (Amethyst 500) | Single accent color |
| `--accent-soft` | `rgba(168,85,247,0.18)` | Tint for active surfaces |
| `--accent-soft-strong` | `rgba(168,85,247,0.34)` | Tint for emphasized surfaces |

### State

| Token | Light | Dark |
|---|---|---|
| `--secondary` / `--secondary-foreground` | `210 40% 96%` / `222 47% 11%` | `217 32% 17%` / `210 40% 98%` |

`--primary`, `--destructive` and their `-text` / `-foreground` companions
are in the surface-vs-text split table above. **`--success` and `--warning`
are not defined** — this table previously listed them (`142 76% 36%` /
`38 92% 50%`) but no such tokens exist in `index.css` and no component
reads them. Use `--primary` / `--destructive` plus an icon or text label
instead; do not reintroduce them without adding the declaration to
`index.css` and the `@theme inline` map.

### Chart palette

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `185 65% 25%` | `185 65% 35%` |
| `--chart-2` | `215 50% 35%` | `215 50% 55%` |
| `--chart-3` | `160 50% 40%` | `160 50% 60%` |
| `--chart-4` | `195 40% 60%` | `195 40% 80%` |
| `--chart-5` | `225 30% 70%` | `225 30% 90%` |

Used by Recharts. Keep them distinct in both lightness and hue; note that
chart-1 tracks `--ring`/`--primary`, not `--primary-text` — if you use a
chart colour as *text*, use the `-text` variant.

### Elevation

| Token | Light | Dark |
|---|---|---|
| `--elevate-1` | `rgba(0,0,0,.03)` | `rgba(255,255,255,.04)` |
| `--elevate-2` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.09)` |

Also `--button-outline` (`rgba(0,0,0,.10)` light / `rgba(255,255,255,.10)`
dark), `--badge-outline` (`rgba(0,0,0,.05)` / `rgba(255,255,255,.05)`) and
`--opaque-button-border-intensity` (`-8` light / `9` dark), which drives the
auto-computed `*-border` tokens (`--primary-border`, `--muted-border`,
`--destructive-border`, …). Each has a plain
`hsl(var(--x))` fallback line for browsers without relative-colour syntax.

---

## 2. Spacing & radius

Tailwind v4 spacing scale is the default. Don't introduce a new
spacing step. Component-level padding comes from utility classes
(`p-2`, `px-3`, `gap-6`, etc.).

### Radius

| Token | Value | Used for |
|---|---|---|
| `--radius` | base |  |
| `--radius-sm` | `calc(--radius - 4px)` | Tags, small chips |
| `--radius-md` | `calc(--radius - 2px)` | Inputs, small buttons |
| `--radius-lg` | `--radius` | Cards |
| `--radius-xl` | `calc(--radius + 4px)` | Large cards, modals |

Default `--radius` is `0.5rem`.

### Shadow

Tailwind `shadow-sm/md/lg` map to the theme. Ubuntu windows use
`shadow-2xl` for a "floating panel" feel.

---

## 3. Typography

| Token | Value | Notes |
|---|---|---|
| `--font-sans` | `--app-font-sans` (Inter) | Set by the app shell |
| `--font-serif` | `--app-font-serif` | Reserved; not yet used |
| `--font-mono` | `--app-font-mono` | IDs, hashes, code |

Type scale uses Tailwind's defaults. Headings are
`text-3xl font-bold tracking-tight` for page titles, `text-base
font-semibold` for cards.

---

## 4. App-specific tokens

### Glass (Ubuntu shell)

Previously documented as `hsl(var(--background) / 0.72)` /
`hsl(var(--border) / 0.6)` / `16px`, which was wrong — they are literal
rgba values and they differ per mode:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--glass-bg` | `rgba(255,255,255,0.65)` | `rgba(18,18,22,0.55)` | Top bar, dock, window |
| `--glass-border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.12)` | Subtle hairline |
| `--glass-blur` | `12px` | `16px` | `backdrop-filter: blur(...)` |
| `--glass-radius` | `16px` | `16px` | `.glass-panel` radius |
| `--glass-shadow` | `0 8px 32px rgba(0,0,0,0.08)` | `0 20px 60px rgba(0,0,0,0.4)` | drop shadow |
| `--glass-inner` | `inset 0 1px 0 rgba(255,255,255,0.8)` | `inset 0 1px 0 rgba(0,0,0,0.06)` | top highlight |
| `--glass-hairline` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.10)` | titlebar divider |

Consumed by `.glass-panel`, `.glass-titlebar`, `.dock-app-btn`,
`.launch-tile` and `.rail-icon*`. `@media (prefers-reduced-data: reduce)`
strips `backdrop-filter` from `.glass-panel` and removes all
`radial-gradient` / `linear-gradient` backgrounds.

### Print

`@media print` (`index.css:870-946`) hides `[data-print="chrome"]` and
`[data-print="hidden"]`, every portalled Radix layer (`[role=dialog]`,
`[role=alertdialog]`, `[role=menu]`, `[role=listbox]`,
`[data-radix-popper-content-wrapper]`, `.toaster`,
`[data-sonner-toaster]`), unclips `main` / `[data-print="scroll"]` so long
records paginate, forces white-on-black, sets
`break-after: avoid-page` on headings and `break-inside: avoid` on
`table/tr/li/blockquote/figure/img`, repeats `thead` on every page
(`display: table-header-group`), and zeroes animation/box-shadow.

`print-color-adjust: exact` is opted in **only** for
`[data-print="keep-color"]` and `.skeleton-shimmer`, so colour is not
globally forced (ink waste / muddy printouts).

**Contract for layout code, owned outside this file:** add
`data-print="chrome"` to any sidebar / top bar / dock / command palette, and
`data-print="hidden"` to anything that must not reach paper. These rules are
opt-in, so the inverse holds: a shell element that forgets the attribute
prints anyway.

**This block is not a compliance control.** It removes application chrome.
It does not decide what may be printed, does not redact PHI, and does not
make printing safe. Whether a given record may be printed, in which
jurisdictions, and with what retention/disposal guarantees is the operator's
responsibility under local PHI/PII policy.

### RTL convention

`index.css:773-845` carries the written convention. Summary:

- **Mandatory for new code — logical properties/utilities only:** `ms-*` /
  `me-*` (never `ml-*`/`mr-*`), `ps-*`/`pe-*`, `inset-inline-*` / `start` /
  `end`, `border-s`/`border-e`, `text-start`/`text-end`,
  `float-start`/`float-end`.
- A physical direction utility in new code is a **defect**, not a style
  preference: it renders mirrored-but-wrong in `ar`. Run
  `rg -n "\b(ml|mr|pl|pr)-|\b(left|right)-|border-[lr]\b|text-(left|right)" src`
  before opening a PR.
- **Exceptions** (physical is correct): flip/carousel/chart geometry driven
  by numeric indices; overlays anchored to a viewport edge; anything
  intentionally reading-order specific.
- `dir` is set pre-hydration by the inline script in `index.html`. Tailwind
  v4's `rtl:` / `ltr:` variants are available for genuine
  direction-specific overrides.
- The only direction-sensitive declarations in `index.css` itself are the
  mirrored `auth-gradient` angle / anchor, `.auth-welcome`'s radial anchor
  and `.auth-shell`'s gradient angle.

The convention is **enforced by review, not by tooling** — there is no lint
rule that fails a physical utility.

### Density

| Value | Use |
|---|---|
| `compact` | Dense tables, power-user lists. `h-8 text-xs`, `px-2 py-1` cells. |
| `comfortable` | Default. `h-10 text-sm`, `px-3 py-2` cells. |
| `spacious` | Touch-friendly, screen-shared. `h-12 text-[15px]`, `px-4 py-3`. |

Persisted to `localStorage` under `app-table-density` and mirrored to
the root `data-density` attribute so global CSS (e.g. auth styles) can
key off it.

### Skeleton

| Token | Light | Dark |
|---|---|---|
| `--skeleton-base` | `hsl(var(--muted) / 0.55)` | `hsl(var(--muted) / 0.6)` |
| `--skeleton-highlight` | `hsl(var(--muted-foreground) / 0.12)` | `hsl(var(--muted-foreground) / 0.18)` |

Animated by `.skeleton-shimmer` (`@keyframes skeleton-shimmer`, 1.6 s
ease-in-out infinite, a moving `linear-gradient` rather than an opacity
pulse). Killed by the global `prefers-reduced-motion` block, and given
`print-color-adjust: exact` under `@media print` so a placeholder is not
mistaken for a real value on paper.

---

## 5. Focus rings

`:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px }`
is a global safety net (`index.css:476-479`) for any interactive element
without a Tailwind focus utility.

Three rules for it:

1. **Do not add `border-radius` to `:focus-visible`.** Setting a radius
   mutates the *shape* of the focused element — a `rounded-full` avatar or
   `rounded-2xl` card visibly squares off its corners while focused. An
   outline follows the element's own radius. The auth screen's shared ring
   (`index.css:730-733`) previously did this and no longer does.
2. **Do not suppress the outline on inputs, textareas and selects.** An
   earlier version had
   `input:focus-visible, textarea:focus-visible, select:focus-visible { outline: none }`
   on the assumption that every field draws its own ring. That is false:
   bare `<input className="border-input … rounded-md">` elements (e.g. the
   clinical fields in `src/components/patient-record-form.tsx`) carry no
   focus utility at all and were left with **no** focus indicator.
   shadcn's Input / Textarea / Select opt into `focus-visible:outline-none`
   themselves and draw a 2 px ring instead. WCAG 2.2 SC **2.4.11 Focus
   Appearance (AA)**.
3. `@media (prefers-contrast: more)` raises the ring to
   `outline: 3px solid CanvasText; outline-offset: 2px` on
   `button, a, input, select, textarea, [role="button"]`.

Component primitives use `focus-visible:ring-2 ring-ring
ring-offset-1 ring-offset-background` (2 px, WCAG 2.2 2.4.11) — `ring-1`
was upgraded to `ring-2` in the 2026-10 pass. `Checkbox` keeps a 16 px
visual box and grows a **28 px pointer target** with
`after:absolute after:-inset-1.5` inside a `pointer-events-none h-6 w-6`
wrapper (WCAG 2.5.8 Target Size, Minimum).

---

## 6. Adding a new token

1. Add the value to `:root` (and `.dark` if it needs a different
   value) in `index.css`.
2. If Tailwind needs to consume it, add it to the `@theme inline` map
   in the same file.
3. Reference it in components via `bg-[hsl(var(--your-token))]` or by
   naming it in `@theme inline` and using the generated utility.
4. Mention it in this file.

If the token is **app-specific** (glass, skeleton, density), prefer
`var(--your-token)` directly. Avoid `useTheme()` from `next-themes`
for non-color values — the FOUC script in `index.html` already sets
`data-theme` and `data-density` pre-hydration.

Before you add a semantic colour, ask whether it needs a
surface/text split like `--primary-text` / `--destructive-text`. If it will
ever be used both as a fill behind a label and as text on a card, split it
from the start.

---

## 7. Typography note

`--app-font-sans` is
`'Inter', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', system-ui, sans-serif`
and `--app-font-serif` is `Georgia, 'Noto Naskh Arabic', serif`.
**Arabic faces are named *and* actually loaded** — `index.html` pulls
`Noto Sans Arabic` (sans) and `Noto Naskh Arabic` (serif) from Google Fonts
alongside Inter. `IBM Plex Sans Arabic` stays in the stack as a second
choice; an unavailable family is simply skipped by the browser, which is
harmless.

Keep this stack and those `<link>`s in sync: a name here with no matching
webfont means Arabic silently falls back to whatever the OS picks, which
differs per platform. (This table previously said "Inter only", which
described the bug, not the code.)

---

## 8. FOUC

`artifacts/research-data/index.html` and
`artifacts/mockup-sandbox/index.html` contain an inline script that
sets `data-theme`, `data-density`, `dir`, and `lang` **before** React
hydrates. This avoids the flash of wrong theme on first paint.

If you add a new pre-hydration attribute (e.g. a new `data-*` switch
that affects the very first paint), add it there too. The script
runs synchronously before the React bundle, so it must be tiny and
self-contained.
