// Two-axis camera store: X (sections) and Y (fields within a section).
// Inertia is applied per-axis using damped exponential easing, with a small
// "snap to anchor" pass at the end so the rest position is always a valid
// section/field.

type Listener = (state: { x: number; y: number; sectionIndex: number; fieldIndex: number }) => void;

const X_SPACING = 760; // px between section centers
const Y_SPACING = 96; // px between field centers
const X_LAMBDA = 7;
const Y_LAMBDA = 9;
const SNAP_DISTANCE = 60; // px around a target that counts as "at rest"

class SpatialCamera {
  private x = 0;
  private y = 0;
  private targetX = 0;
  private targetY = 0;
  private sectionIndex = 0;
  private fieldIndex = 0;
  private sectionCount = 1;
  private fieldCounts: number[] = [];
  private reduced = false;
  private listeners = new Set<Listener>();
  private raf = 0;

  configure(sectionCount: number, fieldCounts: number[]) {
    this.sectionCount = Math.max(1, sectionCount);
    this.fieldCounts = fieldCounts;
  }

  setReducedMotion(v: boolean) {
    this.reduced = v;
  }

  getX() { return this.x; }
  getY() { return this.y; }
  getTargetX() { return this.targetX; }
  getTargetY() { return this.targetY; }
  getSectionIndex() { return this.sectionIndex; }
  getFieldIndex() { return this.fieldIndex; }

  shiftX(delta: number) {
    const next = Math.max(0, Math.min(this.sectionCount - 1, this.sectionIndex + delta));
    this.setSection(next);
  }

  shiftY(delta: number) {
    const count = this.fieldCounts[this.sectionIndex] ?? 0;
    if (count === 0) return;
    const next = Math.max(0, Math.min(count - 1, this.fieldIndex + delta));
    this.setField(next);
  }

  setSection(i: number) {
    const clamped = Math.max(0, Math.min(this.sectionCount - 1, i));
    this.sectionIndex = clamped;
    this.fieldIndex = 0;
    this.targetX = clamped * X_SPACING;
    const count = this.fieldCounts[clamped] ?? 0;
    this.targetY = count > 0 ? Y_SPACING * 0.5 : 0;
    this.start();
  }

  setField(i: number) {
    const count = this.fieldCounts[this.sectionIndex] ?? 0;
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(count - 1, i));
    this.fieldIndex = clamped;
    this.targetY = (clamped + 0.5) * Y_SPACING;
    this.start();
  }

  panX(dx: number) {
    this.targetX += dx;
    this.start();
  }
  panY(dy: number) {
    this.targetY += dy;
    this.start();
  }

  /** Called when the user releases a drag — snap to nearest anchor. */
  snap() {
    if (this.sectionCount === 0) return;
    // Snap X to nearest section
    const idx = Math.max(0, Math.min(this.sectionCount - 1, Math.round(this.targetX / X_SPACING)));
    this.sectionIndex = idx;
    this.targetX = idx * X_SPACING;
    // Snap Y to current section's field
    const count = this.fieldCounts[idx] ?? 0;
    if (count === 0) {
      this.fieldIndex = 0;
      this.targetY = 0;
    } else {
      const f = Math.max(0, Math.min(count - 1, Math.round(this.targetY / Y_SPACING - 0.5)));
      this.fieldIndex = f;
      this.targetY = (f + 0.5) * Y_SPACING;
    }
    this.start();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn({ x: this.x, y: this.y, sectionIndex: this.sectionIndex, fieldIndex: this.fieldIndex });
    return () => {
      this.listeners.delete(fn);
    };
  }

  private start() {
    if (this.raf) return;
    const step = () => {
      const xLambda = this.reduced ? 18 : X_LAMBDA;
      const yLambda = this.reduced ? 22 : Y_LAMBDA;
      const kx = 1 - Math.exp(-xLambda * 0.016);
      const ky = 1 - Math.exp(-yLambda * 0.016);
      this.x += (this.targetX - this.x) * kx;
      this.y += (this.targetY - this.y) * ky;
      const dxRest = Math.abs(this.targetX - this.x);
      const dyRest = Math.abs(this.targetY - this.y);
      // Update live indices based on camera position
      if (this.sectionCount > 0) {
        const liveIdx = Math.max(0, Math.min(this.sectionCount - 1, Math.round(this.x / X_SPACING)));
        this.sectionIndex = liveIdx;
        const count = this.fieldCounts[liveIdx] ?? 0;
        if (count > 0) {
          this.fieldIndex = Math.max(0, Math.min(count - 1, Math.round(this.y / Y_SPACING - 0.5)));
        }
      }
      this.emit();
      if (dxRest < 0.5 && dyRest < 0.5) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.raf = 0;
        this.emit();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private emit() {
    const snap = { x: this.x, y: this.y, sectionIndex: this.sectionIndex, fieldIndex: this.fieldIndex };
    for (const fn of this.listeners) fn(snap);
  }

  /** For scroll progress (0..1) along the X axis. */
  progress() {
    if (this.sectionCount <= 1) return 0;
    const clamped = Math.max(0, Math.min(this.sectionCount - 1, this.x / X_SPACING));
    return clamped / (this.sectionCount - 1);
  }

  /** Distance from rest in px (for idle culling decisions). */
  isResting() {
    return Math.abs(this.targetX - this.x) < SNAP_DISTANCE && Math.abs(this.targetY - this.y) < SNAP_DISTANCE;
  }
}

export const camera = new SpatialCamera();
export const SPATIAL_X_SPACING = X_SPACING;
export const SPATIAL_Y_SPACING = Y_SPACING;
