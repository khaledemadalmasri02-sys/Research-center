import { useEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

type Props = {
  width?: number;
  height?: number;
  samples?: number;
  speed?: number;
  color?: string;
  background?: string;
};

function ecgSample(t: number): number {
  // piecewise: baseline, Q dip, R spike, S dip, T bump
  const beat = (t * 4) % 1;
  if (beat < 0.04) return -0.05;
  if (beat < 0.08) return -0.08;
  if (beat < 0.16) return 0.6;
  if (beat < 0.2) return -0.2;
  if (beat < 0.5) return 0;
  if (beat < 0.62) return 0.2;
  if (beat < 0.7) return 0.05;
  return 0;
}

export function EcgCanvas({
  width = 360,
  height = 90,
  samples = 220,
  speed = 0.6,
  color = "#5eead4",
  background = "rgba(8, 24, 38, 0.6)",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const rafRef = useRef(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let lastDraw = 0;
    const step = (now: number) => {
      if (now - lastDraw < 33) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      lastDraw = now;
      if (!reduced) {
        tRef.current = (now / 1000) * speed;
      }
      const t = tRef.current;
      // background
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      // grid
      ctx.strokeStyle = "rgba(94, 234, 212, 0.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      // trace
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const mid = height / 2;
      const amp = height * 0.4;
      for (let i = 0; i < samples; i++) {
        const x = (i / samples) * width;
        const phase = (t + i / samples) % 1;
        const y = mid - ecgSample(phase) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height, samples, speed, color, background, reduced]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
