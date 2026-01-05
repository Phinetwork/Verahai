// SigilMarkets/views/MarketGrid/MarketHeat.tsx
"use client";

import { useMemo, type CSSProperties } from "react";

type HeatVariant = "dot" | "bar" | "pulse";

export type MarketHeatProps = Readonly<{
  /**
   * 0..1 heat (clamped). Higher = hotter / more active.
   */
  heat: number;

  /**
   * Optional accessible label. If provided, the indicator becomes announceable.
   * If omitted, it stays purely decorative (aria-hidden).
   */
  label?: string;

  /**
   * Visual variant hook for CSS (still renders a <span/>).
   */
  variant?: HeatVariant;

  /**
   * Optional size in px for variants that respect it via CSS vars.
   */
  sizePx?: number;

  /**
   * Adds a native tooltip (title) showing heat % + tier label.
   * Defaults to false to preserve “silent UI” behavior.
   */
  showTooltip?: boolean;

  /**
   * If you already computed reduced-motion upstream, pass it in to disable pulsing.
   */
  prefersReduce?: boolean;

  /**
   * Extra className for layout/styling.
   */
  className?: string;
}>;

type HeatTierKey = "hot" | "warm" | "live" | "dim";

type HeatTier = Readonly<{ key: HeatTierKey; cls: string; label: string }>;

// Allow CSS custom properties without `any`.
type HeatStyle = CSSProperties & Record<`--${string}`, string>;

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
};

/**
 * Smoothstep easing: 0..1 -> 0..1, continuous slope at ends.
 */
const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Golden Breath (exact):
 * T = 3 + √5 seconds
 * f = 1 / T  ≈ 0.190983... Hz
 */
const GOLDEN_BREATH_S = 3 + Math.sqrt(5);
const GOLDEN_BREATH_MS = GOLDEN_BREATH_S * 1000;

/**
 * Fibonacci phase offsets for breath-locked staggering (premium: not all rows blink together,
 * but everything is still aligned to the same Golden Breath carrier).
 */
const FIB_PHASE_MS = [0, 13, 21, 34, 55, 89, 144, 233] as const;

const hash32 = (s: string): number => {
  // FNV-1a (deterministic, tiny, no deps)
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const phaseMsFor = (seed: string): number => {
  const h = hash32(seed);
  return FIB_PHASE_MS[h % FIB_PHASE_MS.length];
};

const tierForHeat = (h01: number): HeatTier => {
  // Keep legacy thresholds to avoid breaking existing CSS semantics.
  if (h01 > 0.82) return { key: "hot", cls: "sm-heat is-hot", label: "Hot" };
  if (h01 > 0.58) return { key: "warm", cls: "sm-heat is-warm", label: "Warm" };
  if (h01 > 0.30) return { key: "live", cls: "sm-heat is-live", label: "Live" };
  return { key: "dim", cls: "sm-heat is-dim", label: "Dim" };
};

/**
 * Fibonacci divisors of the Golden Breath.
 * Hotter = more subdivisions of the same breath cycle (faster, still coherent).
 */
const pulseDivForTier = (tier: HeatTierKey): 3 | 5 | 8 | 13 => {
  switch (tier) {
    case "hot":
      return 13;
    case "warm":
      return 8;
    case "live":
      return 5;
    case "dim":
    default:
      return 3;
  }
};

export function MarketHeat(props: MarketHeatProps) {
  const model = useMemo(() => {
    const h = clamp01(props.heat);
    const eased = smoothstep01(h);

    // φ-shaped intensity (premium / organic, less “linear UI”).
    const coh = Math.pow(eased, 1 / PHI);

    const tier = tierForHeat(h);
    const variant: HeatVariant = props.variant ?? "dot";

    // Fibonacci endpoints for hue (cool -> hot), still deterministic:
    // 233 (cool) -> 34 (hot)
    const hue = Math.round(233 - (233 - 34) * coh);

    // “Premium” mapping using Fibonacci-derived constants:
    // alpha: 0.13 .. ~1.00 (clamped)
    // glow : 0.21 .. ~1.81 (≈ 0.21 + 1.597)
    // scale: 0.89 .. 1.10 (0.89 + 0.21)
    const alphaNum = Math.min(1, 0.13 + 0.89 * coh);
    const glowNum = 0.21 + 1.597 * coh;
    const scaleNum = 0.89 + 0.21 * coh;

    const alpha = alphaNum.toFixed(3);
    const glow = glowNum.toFixed(3);
    const scale = scaleNum.toFixed(3);

    // Golden-breath carrier + Fibonacci subdivision pulse.
    const breathMs = props.prefersReduce ? 0 : GOLDEN_BREATH_MS;
    const pulseDiv = pulseDivForTier(tier.key);
    const pulseMs = props.prefersReduce ? 0 : breathMs / pulseDiv;

    // Optional micro shimmer that *still* divides the same breath (34 is Fibonacci).
    const microMs = props.prefersReduce ? 0 : breathMs / 34;

    // Deterministic phase: stagger within the breath using Fibonacci offsets.
    const phaseSeed =
      (props.label && props.label.trim().length > 0 ? props.label : `${variant}:${tier.key}`) + ":sm-heat";
    const phaseMs = props.prefersReduce ? 0 : phaseMsFor(phaseSeed);

    const cls = [
      tier.cls,
      `is-${variant}`,
      props.prefersReduce ? "is-static" : "is-animated",
      props.className ?? "",
    ]
      .filter((v) => v.length > 0)
      .join(" ");

    const pct = Math.round(h * 100);
    const title = props.showTooltip ? `${tier.label} • ${pct}%` : undefined;

    const style: HeatStyle = {
      "--sm-heat": h.toFixed(6),
      "--sm-heat-tier": tier.key,
      "--sm-heat-hue": String(hue),
      "--sm-heat-alpha": alpha,
      "--sm-heat-glow": glow,
      "--sm-heat-scale": scale,

      // Keep legacy var name, but now it is breath-coherent.
      "--sm-heat-pulse-ms": `${pulseMs.toFixed(3)}ms`,

      // New vars for “full entrainment” CSS (breath carrier + phase + micro shimmer).
      "--sm-heat-breath-ms": `${breathMs.toFixed(3)}ms`,
      "--sm-heat-phase-ms": `${phaseMs}ms`,
      "--sm-heat-micro-ms": `${microMs.toFixed(3)}ms`,

      // Handy debug/telemetry (CSS can ignore).
      "--sm-heat-breath-hz": (1 / GOLDEN_BREATH_S).toFixed(9),

      ...(props.sizePx ? { "--sm-heat-size": `${props.sizePx}px` } : {}),
    };

    const a11y =
      props.label && props.label.trim().length > 0
        ? ({ role: "img", "aria-label": `${props.label} — ${tier.label} (${pct}%)` } as const)
        : ({ "aria-hidden": true } as const);

    return {
      cls,
      style,
      title,
      dataHeat: h.toFixed(6),
      dataTier: tier.key,
      dataPct: String(pct),
      a11y,
    };
  }, [
    props.heat,
    props.label,
    props.variant,
    props.sizePx,
    props.showTooltip,
    props.prefersReduce,
    props.className,
  ]);

  return (
    <span
      className={model.cls}
      style={model.style}
      title={model.title}
      data-heat={model.dataHeat}
      data-tier={model.dataTier}
      data-pct={model.dataPct}
      {...model.a11y}
    />
  );
}
