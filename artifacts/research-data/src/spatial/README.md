# ResCenter Spatial Workspace

Premium 3D-feel patient record interface — pure DOM + CSS 3D transforms + 2D Canvas, no Three.js / WebGL dependency.

## Routes

| Route | Page | Notes |
|---|---|---|
| `/patients/spatial` | `PatientWorkspacePage` | Redirects to first record. |
| `/patients/spatial/:id` | `PatientWorkspacePage` | The immersive 3D workspace. |
| `/patients/vr` | `PatientCorridor` | Legacy 2D side-scroller (kept for reference). |

## Entry points

- Patients list → "Spatial View" button → `/patients/spatial/<first record id>`.
- Patients list → "2D Scroll" button → `/patients/vr`.
- Topbar "2D View" button in workspace → back to `/patients`.

## Architecture

```
src/spatial/
├── spatialTypes.ts            # SpatialField, SpatialSection types
├── spatialSections.ts         # RecordRow → 15 spatial sections
├── spatialCamera.ts           # Two-axis camera (X=sections, Y=fields)
├── useSpatialGestures.ts      # Wheel, drag, touch, keyboard
├── useReducedMotion.ts        # prefers-reduced-motion
├── SpatialEnvironment.tsx     # 2D Canvas background
├── SectionPanel.tsx           # One section as a floating glass card
├── FieldCard.tsx              # One field card
├── HorizontalSectionNav.tsx   # Top icon rail
├── PatientSwitcher.tsx        # Left avatar rail
├── SpatialA11y.tsx            # SR-only semantic mirror
├── SpatialFocusMode.tsx       # Centered field detail dialog
├── SpatialWorkspace.tsx       # Top-level shell
└── spatial.css                # ResCenter theme tokens

src/pages/patient-workspace.tsx  # Route entry
```

## Sections (15)

Overview · Demographics · History · Diagnoses · Medications · Allergies · Labs · Imaging · Vitals · Notes · Procedures · Visits · Research · Documents · Timeline

## Controls

- **← →** (or A/D) — navigate sections horizontally
- **↑ ↓** (or W/S) — highlight fields vertically
- **Drag** — pan the world horizontally
- **Shift + wheel** — horizontal scroll on any wheel
- **Wheel over a section** — scroll the field list inside that section
- **Click any field card** — open focus mode (Esc to close)
- **Home / End** — jump to first / last section
- **Enter** — open focus mode on the highlighted field

## Visual design

- Glassmorphic panels with `backdrop-filter: blur(14px) saturate(160%)`
- Emerald → teal → cyan gradient (ResCenter brand)
- 3D depth: active section in focus, ±1 panels at 90% scale and rotated Y, ±2 at 78% and blurred, ±3 at 66% with strong blur
- Soft teal glow + ambient particles in the background
- Severity colors: red only for critical, amber for warnings, green for normal, dim for muted

## Performance

- Bundle: 27.5 kB / ~9 kB gzip (`patient-workspace.js`)
- 60 Hz direct DOM writes for camera transform and progress bar (no React re-render)
- 30 Hz React state mirror for HUD chrome
- Idle culling: only `active ± 2` sections in DOM
- `React.memo` on `SectionPanel`, `FieldCard`, `SpatialA11y`, `SpatialEnvironment`
- All animations use `transform` + `opacity` only; no layout thrashing
- `prefers-reduced-motion`: removes all transitions and ambient motion

## Accessibility

- Keyboard: full nav with arrows, Home/End, Enter, Esc
- Screen reader: every section + field is in a hidden `<ol>`
- Focus rings on all interactive elements
- `aria-roledescription="spatial patient record workspace"` on root
- `prefers-reduced-motion` honored throughout
- 2D fallback link in the topbar

## Known limitations

- The vertical "2D view" of fields is a real scrollable list inside each section panel (not a separate page). This was the right UX choice — fields are part of the active section, not a separate destination.
- In the desktop shell, the patient switcher updates the global URL, which affects other windows. For now, switch patients by closing the workspace window and re-opening via the patients list, OR accept the global navigation.
