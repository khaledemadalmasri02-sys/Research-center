// Tiny pub/sub store for the side-scroller camera. No external deps.
type Listener = (camX: number) => void;

class CameraStore {
  private camX = 0;
  private targetX = 0;
  private listeners = new Set<Listener>();
  private stopPositions: number[] = [];
  private currentIndex = 0;
  private raf = 0;
  private reducedMotion = false;

  setStops(positions: number[]) {
    this.stopPositions = positions;
  }

  setReducedMotion(v: boolean) {
    this.reducedMotion = v;
  }

  getCamX() {
    return this.camX;
  }
  getTargetX() {
    return this.targetX;
  }
  getStopPositions() {
    return this.stopPositions;
  }
  getCurrentIndex() {
    return this.currentIndex;
  }

  setTargetX(x: number) {
    this.targetX = x;
    this.start();
  }

  jumpToIndex(i: number) {
    if (this.stopPositions.length === 0) return;
    const clamped = Math.max(0, Math.min(i, this.stopPositions.length - 1));
    this.currentIndex = clamped;
    this.setTargetX(this.stopPositions[clamped]);
  }

  snapToCurrent() {
    if (this.stopPositions.length === 0) return;
    this.setTargetX(this.stopPositions[this.currentIndex]);
  }

  shiftIndex(delta: number) {
    if (this.stopPositions.length === 0) return;
    this.jumpToIndex(this.currentIndex + delta);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.camX);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private start() {
    if (this.raf) return;
    const step = () => {
      const lambda = this.reducedMotion ? 12 : 6;
      const k = 1 - Math.exp(-lambda * 0.016);
      const dx = this.targetX - this.camX;
      this.camX += dx * k;
      if (Math.abs(dx) < 0.05) {
        this.camX = this.targetX;
        this.raf = 0;
        this.updateIndex();
        this.emit();
        return;
      }
      this.updateIndex();
      this.emit();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private updateIndex() {
    if (this.stopPositions.length === 0) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.stopPositions.length; i++) {
      const d = Math.abs(this.stopPositions[i] - this.camX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    this.currentIndex = best;
  }

  private emit() {
    for (const fn of this.listeners) fn(this.camX);
  }
}

export const camera = new CameraStore();
