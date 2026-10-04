import { useEffect, useRef } from "react";
import { camera } from "./cameraStore";
import { useReducedMotion } from "./useReducedMotion";

// Three parallax layers: stars (far), grid (mid), horizon glow (near).
// Drawn on a single canvas behind the DOM track.
type Props = {
  width: number;
  height: number;
};

export function ParallaxBackground({ width, height }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const rafRef = useRef(0);

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

    const stars = Array.from({ length: 40 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.6,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.6 + 0.2,
    }));

    let t = 0;
    let lastDraw = 0;
    const draw = (now: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (now - lastDraw < 33) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;
      const camX = camera.getCamX();
      t = reduced ? 0 : t + 0.004;

      ctx.clearRect(0, 0, w, h);
      // background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#04101a");
      grad.addColorStop(0.6, "#071b2c");
      grad.addColorStop(1, "#0c2a44");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // far stars (move slow)
      const farOffset = (camX * 0.05) % w;
      ctx.fillStyle = "rgba(230, 243, 255, 0.8)";
      for (const s of stars) {
        const sx = ((s.x * w * 2 - farOffset) % (w * 2) + w * 2) % (w * 2) - w * 0.2;
        const sy = s.y * h;
        const tw = reduced ? s.a : s.a * (0.6 + 0.4 * Math.sin(t * 2 + s.x * 7));
        ctx.globalAlpha = tw;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // mid grid floor
      const midOffset = (camX * 0.3) % 80;
      const horizonY = h * 0.7;
      ctx.strokeStyle = "rgba(94, 234, 212, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();
      // vertical grid lines receding
      for (let i = -2; i < 24; i++) {
        const x = ((i * 80 - midOffset) % (w + 240)) - 120;
        const ratio = 0.3 + 0.7 * Math.max(0, 1 - (i * 0.05));
        ctx.strokeStyle = `rgba(94, 234, 212, ${0.08 + 0.18 * ratio})`;
        ctx.beginPath();
        ctx.moveTo(x, horizonY);
        ctx.lineTo(w / 2 + (x - w / 2) * 4, h);
        ctx.stroke();
      }

      // near horizon glow
      const glow = ctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.7);
      glow.addColorStop(0, "rgba(94, 234, 212, 0.18)");
      glow.addColorStop(1, "rgba(94, 234, 212, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [width, height, reduced]);

  return <canvas ref={ref} className="ssc-bg" aria-hidden="true" />;
}
