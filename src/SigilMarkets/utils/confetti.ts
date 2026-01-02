// SigilMarkets/utils/confetti.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — confetti
 *
 * Tiny, dependency-free confetti burst.
 * - Uses canvas overlay.
 * - No colors specified by request: uses white/alpha particles only.
 *   (Theme colors can be layered later if you explicitly want.)
 */

type ConfettiOpts = Readonly<{
  /** 0..1 intensity. Default 1 */
  intensity?: number;
  /** Duration ms. Default 900 */
  durationMs?: number;
}>;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  rot: number;
  vrot: number;
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export const confettiBurst = (opts?: ConfettiOpts): void => {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const intensity = clamp(opts?.intensity ?? 1, 0.1, 2);
  const durationMs = Math.max(200, Math.floor(opts?.durationMs ?? 900));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "200";
  canvas.style.pointerEvents = "none";

  document.body.appendChild(canvas);

  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const resize = (): void => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resize();

  const W = () => canvas.width / dpr;
  const H = () => canvas.height / dpr;

  const count = Math.floor(90 * intensity);
  const parts: Particle[] = [];

  const originX = W() / 2;
  const originY = H() * 0.35;

  for (let i = 0; i < count; i += 1) {
    parts.push({
      x: originX,
      y: originY,
      vx: rand(-2.2, 2.2) * (0.8 + Math.random() * 0.8),
      vy: rand(-5.2, -2.4) * (0.8 + Math.random() * 0.8),
      life: rand(0.7, 1.0),
      size: rand(2.5, 5.5),
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.25, 0.25),
    });
  }

  const t0 = performance.now();
  let lastT = t0;

  const step = (t: number): void => {
    const dtRaw = t - lastT;
    const dt = Math.min(33, dtRaw > 0 ? dtRaw : 16);
    lastT = t;

    const age = t - t0;
    const alpha = 1 - clamp(age / durationMs, 0, 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W(), H());

    // gravity
    const g = 0.16 * (dt / 16);

    for (const p of parts) {
      p.vy += g;
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.rot += p.vrot;

      // fade life
      p.life = Math.max(0, p.life - 0.012 * (dt / 16));

      // draw
      const a = alpha * p.life;
      if (a <= 0) continue;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4);

      ctx.restore();
    }

    if (age < durationMs) {
      requestAnimationFrame(step);
      return;
    }

    canvas.remove();
  };

  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(step);

  setTimeout(() => {
    window.removeEventListener("resize", resize);
  }, durationMs + 200);
};
