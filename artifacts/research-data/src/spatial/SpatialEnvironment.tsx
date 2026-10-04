import { memo, useEffect, useRef } from "react";

type Props = {
  width: number;
  height: number;
  // -1..1 progress along the X axis (0 = center)
  xProgress: number;
  // Pause the ambient animation (e.g. under reduced motion)
  paused?: boolean;
};

export function SpatialEnvironmentInner({ width, height, xProgress, paused = false }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => ro.disconnect();
    ctx.scale(dpr, dpr);

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.3 + 0.3,
      a: Math.random() * 0.4 + 0.2,
      speed: Math.random() * 0.0006 + 0.0002,
    }));

    let lastDraw = 0;
    const draw = (t: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Throttle to 30 fps to save CPU when nothing changes
      if (t - lastDraw < 33) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDraw = t;
      tRef.current += 1;
      const tt = tRef.current * 0.02;
      ctx.clearRect(0, 0, w, h);

      // horizon line
      const horizonY = h * 0.55;
      ctx.strokeStyle = "rgba(94, 234, 212, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();

      // receding grid lines
      const offset = xProgress * 240;
      for (let i = -3; i < 20; i++) {
        const x = ((i * 80) - offset) % (w + 320);
        const xPos = x < -80 ? x + w + 320 : x;
        const ratio = 0.25 + 0.75 * (i / 20);
        ctx.strokeStyle = `rgba(20, 184, 166, ${0.04 + 0.14 * ratio})`;
        ctx.beginPath();
        ctx.moveTo(xPos, horizonY);
        ctx.lineTo(w / 2 + (xPos - w / 2) * 3.5, h);
        ctx.stroke();
      }

      // ambient particles
      if (!paused) {
        for (const p of particles) {
          const py = (p.y * 0.9 + 0.05) * h;
          const drift = Math.sin(tt * p.speed * 30 + p.x * 12) * 8;
          const px = (p.x * w + drift + offset * 0.3) % w;
          const tw = p.a * (0.6 + 0.4 * Math.sin(tt * 1.5 + p.x * 7));
          ctx.fillStyle = `rgba(94, 234, 212, ${tw})`;
          ctx.beginPath();
          ctx.arc(px, py, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // soft glow under horizon
      const glow = ctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.7);
      glow.addColorStop(0, "rgba(16, 185, 129, 0.18)");
      glow.addColorStop(1, "rgba(16, 185, 129, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [width, height, paused, xProgress]);

  return <canvas ref={ref} className="spc-env" aria-hidden="true" style={{ width, height }} />;
}

export const SpatialEnvironment = memo(SpatialEnvironmentInner);
