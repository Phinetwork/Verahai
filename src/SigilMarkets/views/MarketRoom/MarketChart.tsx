// SigilMarkets/views/MarketRoom/MarketChart.tsx
"use client";

/**
 * MarketChart (Atlantean Premium)
 *
 * Goals (MVP+):
 * - Canvas-first, DPR-correct, ResizeObserver-driven.
 * - Smooth curve (Catmull-Rom → Bézier) + area fill.
 * - “Official live chart” behavior:
 *   - Head ball is ALWAYS on the latest point (the head).
 *   - Motion is REALISTIC: the head pulses + emits a breath-locked halo/ripple,
 *     and the last segment gets a living “comet tail” (no gimmicky wandering spark).
 * - Golden Breath carrier for coherence:
 *   f = 1/(3+√5) Hz ≈ 0.190983...
 * - Frosted glass overlay (subtle sheen + deterministic micro-grain) via CSS vars.
 */

import { useEffect, useMemo, useRef } from "react";
import type { KaiMoment, PriceMicro } from "../../types/marketTypes";
import { formatPriceMicro } from "../../utils/format";

export type MarketChartProps = Readonly<{
  now: KaiMoment;

  /** YES price is primary (NO derived). */
  yesPriceMicro: PriceMicro;

  /** Optional historical series of YES prices (micro), oldest -> newest. */
  seriesYesMicro?: readonly PriceMicro[];

  /** Height in px (default 160). */
  height?: number;
}>;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const TWO_PI = Math.PI * 2;

// Golden Breath (exact): T = 3 + √5 seconds ; f = 1/T
const GOLDEN_BREATH_S = 3 + Math.sqrt(5);
const GOLDEN_BREATH_HZ = 1 / GOLDEN_BREATH_S;

// Fibonacci helpers (fallback wobble & smoothing)
const FIB = [13, 21, 34, 55, 89] as const;

const movingAverage = (arr: readonly number[], win: number): number[] => {
  const w = Math.max(1, win | 0);
  if (w <= 1) return [...arr];
  const out: number[] = new Array(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i += 1) {
    sum += arr[i];
    if (i >= w) sum -= arr[i - w];
    const denom = i + 1 < w ? i + 1 : w;
    out[i] = sum / denom;
  }
  return out;
};

const makeFallbackSeries = (nowPulse: number, yesPriceMicro: PriceMicro, points = 72): readonly number[] => {
  const p = Number(yesPriceMicro);
  const base = clamp01(p / 1_000_000);
  const out: number[] = [];

  // Deterministic Fibonacci wobble (stable & repeatable).
  for (let i = 0; i < points; i += 1) {
    const k = nowPulse - (points - 1 - i);
    const a = Math.sin((k / FIB[0]) * TWO_PI) * 0.018; // 13
    const b = Math.sin((k / FIB[1]) * TWO_PI) * 0.011; // 21
    const c = Math.sin((k / FIB[2]) * TWO_PI) * 0.007; // 34
    const d = Math.sin(((nowPulse / FIB[3]) + i / FIB[1]) * TWO_PI) * 0.004; // 55 + 21
    out.push(clamp01(base + a + b + c + d));
  }

  return movingAverage(out, 5);
};

type Theme = Readonly<{
  line: string;
  glow: string;
  fillTop: string;
  fillBottom: string;
  grid: string;
  base: string;
  dot: string;

  // Frosted glass overlay
  sheenA: string;
  sheenB: string;
  grainAlpha: number;
}>;

const readCssVar = (el: Element, name: string, fallback: string): string => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
};

const readCssNum = (el: Element, name: string, fallback: number): number => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const getTheme = (canvas: HTMLCanvasElement): Theme => {
  const root = canvas.closest(".sm-chart") ?? document.documentElement;

  return {
    line: readCssVar(root, "--sm-chart-line", "rgba(255,255,255,0.78)"),
    glow: readCssVar(root, "--sm-chart-glow", "rgba(191,252,255,0.18)"),
    fillTop: readCssVar(root, "--sm-chart-fill-top", "rgba(191,252,255,0.10)"),
    fillBottom: readCssVar(root, "--sm-chart-fill-bot", "rgba(255,255,255,0.00)"),
    grid: readCssVar(root, "--sm-chart-grid", "rgba(255,255,255,0.06)"),
    base: readCssVar(root, "--sm-chart-base", "rgba(255,255,255,0.10)"),
    dot: readCssVar(root, "--sm-chart-dot", "rgba(191,252,255,0.92)"),

    sheenA: readCssVar(root, "--sm-chart-sheen-a", "rgba(255,255,255,0.08)"),
    sheenB: readCssVar(root, "--sm-chart-sheen-b", "rgba(255,255,255,0.00)"),
    grainAlpha: clamp(readCssNum(root, "--sm-chart-grain-alpha", 0.035), 0, 0.12),
  };
};

/** Catmull-Rom → Bézier smoothing */
const buildSmoothPath = (
  ctx: CanvasRenderingContext2D,
  pts: readonly { x: number; y: number }[],
  tension = 0.55,
) => {
  const n = pts.length;
  if (n <= 1) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < n - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];

    const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
};

const quantile = (arr: readonly number[], q: number): number => {
  if (arr.length === 0) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const frac = pos - base;
  const v0 = a[base] ?? a[a.length - 1];
  const v1 = a[base + 1] ?? v0;
  return v0 + (v1 - v0) * frac;
};

// Deterministic micro-grain (seeded) for frosted glass.
const xorshift32 = (seed: number) => {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
};

type Noise = {
  seed: number;
  canvas: HTMLCanvasElement;
  pattern: CanvasPattern | null;
};

type CanvasState = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
};

export const MarketChart = (props: MarketChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const stRef = useRef<CanvasState | null>(null);
  const noiseRef = useRef<Noise | null>(null);

  const height = props.height ?? 160;

  const series01 = useMemo(() => {
    if (props.seriesYesMicro && props.seriesYesMicro.length >= 8) {
      const raw = props.seriesYesMicro.map((x) => clamp01(Number(x) / 1_000_000));
      return movingAverage(raw, 5);
    }
    return makeFallbackSeries(props.now.pulse, props.yesPriceMicro, 72);
  }, [props.seriesYesMicro, props.now.pulse, props.yesPriceMicro]);

  const label = useMemo(
    () => formatPriceMicro(props.yesPriceMicro, { mode: "cents", decimals: 0 }),
    [props.yesPriceMicro],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const prefersReduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const reconfigure = (): CanvasState | null => {
      const dpr = typeof window !== "undefined" ? clamp(window.devicePixelRatio || 1, 1, 2.5) : 1;
      const w = Math.max(1, Math.floor(c.clientWidth));
      const h = Math.max(1, Math.floor(height));

      const prev = stRef.current;
      if (prev && prev.w === w && prev.h === h && prev.dpr === dpr) return prev;

      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);

      const ctx = c.getContext("2d");
      if (!ctx) return null;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const st: CanvasState = { ctx, w, h, dpr };
      stRef.current = st;
      return st;
    };

    const ensureNoise = (ctx: CanvasRenderingContext2D, seed: number) => {
      const cur = noiseRef.current;
      if (cur && cur.seed === seed && cur.pattern) return cur;

      const nc = cur?.canvas ?? document.createElement("canvas");
      nc.width = 64;
      nc.height = 64;

      const nctx = nc.getContext("2d");
      if (!nctx) return null;

      const img = nctx.createImageData(nc.width, nc.height);
      const rnd = xorshift32(seed ^ 0x9e3779b9); // deterministic + “golden” constant

      for (let i = 0; i < img.data.length; i += 4) {
        const r = rnd() & 0xff;
        // grain: near-white variance so it feels like etched frost, not static
        const v = 210 + (r % 46); // 210..255
        img.data[i + 0] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }

      nctx.putImageData(img, 0, 0);

      const pat = ctx.createPattern(nc, "repeat");
      const next: Noise = { seed, canvas: nc, pattern: pat };
      noiseRef.current = next;
      return next;
    };

    const render = (tMs: number) => {
      const st = reconfigure();
      if (!st) return;

      const { ctx, w, h } = st;
      const theme = getTheme(c);

      ctx.clearRect(0, 0, w, h);

      const pad = 12;
      const innerW = Math.max(1, w - pad * 2);
      const innerH = Math.max(1, h - pad * 2);

      const n = series01.length;
      if (n < 2) return;

      // Official zoom: stable, robust quantiles (no animated axis scaling).
      const qLo = quantile(series01, 0.06);
      const qHi = quantile(series01, 0.94);
      const min = clamp(qLo - 0.02, 0, 1);
      const max = clamp(qHi + 0.02, 0, 1);
      const spanZ = Math.max(0.0001, max - min);

      const xAt = (i: number): number => pad + (i / (n - 1)) * innerW;
      const yAt = (v: number): number => pad + (1 - (v - min) / spanZ) * innerH;

      // Breath carriers (for *motion only*, not data scaling)
      const tS = tMs / 1000;
      const breathPhase = prefersReduce ? 0 : (tS * GOLDEN_BREATH_HZ) % 1;
      const breathWave = prefersReduce ? 0 : 0.5 - 0.5 * Math.cos(TWO_PI * breathPhase); // 0..1
      const microPhase = prefersReduce ? 0 : (tS * (GOLDEN_BREATH_HZ * 3)) % 1; // 3× breath (still coherent)
      const microWave = prefersReduce ? 0 : 0.5 - 0.5 * Math.cos(TWO_PI * microPhase);

      // GRID (instrument panel)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.grid;
      ctx.setLineDash([2, 7]);

      const rows = 4;
      for (let r = 1; r <= rows; r += 1) {
        const y = pad + (r / (rows + 1)) * innerH;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + innerW, y);
        ctx.stroke();
      }

      const cols = 5;
      for (let col = 1; col <= cols; col += 1) {
        const x = pad + (col / (cols + 1)) * innerW;
        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, pad + innerH);
        ctx.stroke();
      }
      ctx.restore();

      // Points
      const pts: { x: number; y: number }[] = new Array(n);
      for (let i = 0; i < n; i += 1) pts[i] = { x: xAt(i), y: yAt(series01[i]) };

      // Area fill
      ctx.save();
      const fill = ctx.createLinearGradient(0, pad, 0, pad + innerH);
      fill.addColorStop(0, theme.fillTop);
      fill.addColorStop(1, theme.fillBottom);

      buildSmoothPath(ctx, pts, 0.55);
      ctx.lineTo(pad + innerW, pad + innerH);
      ctx.lineTo(pad, pad + innerH);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      // Main line (glass glow)
      ctx.save();
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur = prefersReduce ? 0 : 12;
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.line;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      buildSmoothPath(ctx, pts, 0.55);
      ctx.stroke();
      ctx.restore();

      // Glow pass (thick & faint)
      ctx.save();
      ctx.lineWidth = 7;
      ctx.strokeStyle = theme.glow;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      buildSmoothPath(ctx, pts, 0.55);
      ctx.stroke();
      ctx.restore();

      // Baseline
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pad, pad + innerH);
      ctx.lineTo(pad + innerW, pad + innerH);
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.base;
      ctx.stroke();
      ctx.restore();

      // === HEAD (official live chart behavior) ===
      // The “ball” stays at the HEAD (latest point), and it MOVES by breath-locked pulse/halo/ripple.
      const head = pts[n - 1];
      const prev = pts[n - 2];

      // Comet tail on last segment (alive, but real-looking)
      ctx.save();
      ctx.globalAlpha = prefersReduce ? 0.55 : 0.55 + 0.25 * breathWave;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = theme.line;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.globalAlpha = prefersReduce ? 0.22 : 0.22 + 0.22 * breathWave;
      ctx.lineWidth = 11;
      ctx.strokeStyle = theme.glow;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.restore();

      // Price guide line at the latest point (subtle, “real chart”)
      ctx.save();
      ctx.setLineDash([3, 9]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.grid;
      ctx.globalAlpha = prefersReduce ? 0.55 : 0.45 + 0.25 * microWave;
      ctx.beginPath();
      ctx.moveTo(pad, head.y);
      ctx.lineTo(pad + innerW, head.y);
      ctx.stroke();
      ctx.restore();

      // Head halo (radial gradient)
      const haloR = prefersReduce ? 14 : 14 + 10 * breathWave;
      ctx.save();
      const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, haloR);
      halo.addColorStop(0, theme.dot);
      halo.addColorStop(0.45, theme.glow);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = prefersReduce ? 0.32 : 0.22 + 0.28 * breathWave;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(head.x, head.y, haloR, 0, TWO_PI);
      ctx.fill();
      ctx.restore();

      // Breath ripple ring (official “live” feel)
      if (!prefersReduce) {
        const ringR = 8 + 18 * breathWave;
        ctx.save();
        ctx.globalAlpha = 0.08 + 0.18 * (1 - breathWave);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.glow;
        ctx.beginPath();
        ctx.arc(head.x, head.y, ringR, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
      }

      // Core head ball (always on the HEAD)
      const coreR = prefersReduce ? 4.2 : 4.2 + 1.8 * microWave;
      ctx.save();
      ctx.beginPath();
      ctx.arc(head.x, head.y, coreR, 0, TWO_PI);
      ctx.fillStyle = theme.dot;
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.restore();

      // Frosted glass sheen (very subtle)
      ctx.save();
      ctx.globalAlpha = prefersReduce ? 0.10 : 0.08 + 0.06 * breathWave;
      const sheen = ctx.createLinearGradient(0, 0, w, h);
      sheen.addColorStop(0, theme.sheenA);
      sheen.addColorStop(0.45, theme.sheenB);
      sheen.addColorStop(1, theme.sheenB);
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Micro-grain (deterministic, frosted glass texture)
      const noise = ensureNoise(ctx, props.now.pulse);
      if (noise?.pattern) {
        const drift = prefersReduce ? 0 : 6 * breathWave; // tiny drift so it feels “alive”
        ctx.save();
        ctx.globalAlpha = theme.grainAlpha;
        ctx.translate(drift, drift);
        ctx.fillStyle = noise.pattern;
        ctx.fillRect(-drift, -drift, w + drift * 2, h + drift * 2);
        ctx.restore();
      }
    };

    const start = () => {
      const loop = (t: number) => {
        render(t);
        rafRef.current = window.requestAnimationFrame(loop);
      };

      // Immediate draw
      render(typeof performance !== "undefined" ? performance.now() : 0);

      // Animate only if motion allowed
      if (!prefersReduce) rafRef.current = window.requestAnimationFrame(loop);
    };

    // ResizeObserver -> redraw
    if (typeof ResizeObserver !== "undefined") {
      roRef.current?.disconnect();
      roRef.current = new ResizeObserver(() => {
        render(typeof performance !== "undefined" ? performance.now() : 0);
      });
      roRef.current.observe(c);
    }

    // Pause when hidden (battery discipline)
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }
      if (!prefersReduce && rafRef.current == null) start();
      else render(typeof performance !== "undefined" ? performance.now() : 0);
    };

    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      roRef.current?.disconnect();
      roRef.current = null;
      stRef.current = null;
    };
  }, [series01, height, props.now.pulse]);

  return (
    <div className="sm-chart" data-sm="chart">
      <div className="sm-chart-head">
        <div className="sm-chart-title">Live odds</div>
        <div className="sm-chart-right">
          <span className="sm-chart-pill">YES {label}</span>
          <span className="sm-chart-pill dim">pulse {props.now.pulse}</span>
        </div>
      </div>

      <div className="sm-chart-canvas-wrap">
        <canvas ref={canvasRef} className="sm-chart-canvas" style={{ height }} />
      </div>
    </div>
  );
};
