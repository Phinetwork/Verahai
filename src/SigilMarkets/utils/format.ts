// SigilMarkets/utils/format.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — format
 *
 * UI formatting helpers (pure):
 * - microΦ (bigint) -> "Φ" strings
 * - price microΦ/share -> probability-ish percent or "¢-like" display
 * - pulses -> human time approximations (bridge only; UI convenience)
 *
 * Determinism note:
 * - These functions are UI-only and may use Intl when available.
 * - All core math stays in bigint micros elsewhere.
 */

import type { KaiPulse, PhiMicro, PriceMicro, ShareMicro } from "../types/marketTypes";
import { ONE_PHI_MICRO, ONE_SHARE_MICRO } from "../types/marketTypes";

/** Breath unit (bridge for UI time). T = 3 + √5 seconds. */
export const PHI_BREATH_SECONDS = 3 + Math.sqrt(5);

/** One pulse duration in seconds (bridge). In this module, 1 pulse == 1 breath. */
export const PULSE_SECONDS = PHI_BREATH_SECONDS;

/** Safe Intl access (SSR-friendly). */
const getNumberFormatter = (opts: Intl.NumberFormatOptions): Intl.NumberFormat | null => {
  try {
    if (typeof Intl === "undefined" || typeof Intl.NumberFormat !== "function") return null;
    return new Intl.NumberFormat(undefined, opts);
  } catch {
    return null;
  }
};

const stripTrailingZeros = (s: string): string => {
  // "1.230000" -> "1.23", "1.000" -> "1"
  if (s.indexOf(".") < 0) return s;
  let out = s;
  while (out.endsWith("0")) out = out.slice(0, -1);
  if (out.endsWith(".")) out = out.slice(0, -1);
  return out;
};

export type FormatPhiOptions = Readonly<{
  /** Max decimals to show (default 6). */
  maxDecimals?: number;
  /** Min decimals to show (default 0). */
  minDecimals?: number;
  /** If true, trims trailing zeros (default true). */
  trimZeros?: boolean;
  /** If true, append " Φ" (default true). */
  withUnit?: boolean;
}>;

const absBig = (v: bigint): bigint => (v < 0n ? -v : v);

const microToParts = (micro: bigint): Readonly<{ sign: "-" | ""; whole: bigint; frac: bigint }> => {
  const sign: "-" | "" = micro < 0n ? "-" : "";
  const a = absBig(micro);
  const whole = a / ONE_PHI_MICRO;
  const frac = a % ONE_PHI_MICRO;
  return { sign, whole, frac };
};

const padLeft = (s: string, n: number): string => (s.length >= n ? s : `${"0".repeat(n - s.length)}${s}`);

export const formatPhiMicro = (micro: PhiMicro, opts?: FormatPhiOptions): string => {
  const maxDecimals = Math.max(0, Math.min(6, Math.floor(opts?.maxDecimals ?? 6)));
  const minDecimals = Math.max(0, Math.min(maxDecimals, Math.floor(opts?.minDecimals ?? 0)));
  const trimZeros = opts?.trimZeros ?? true;
  const withUnit = opts?.withUnit ?? true;

  const { sign, whole, frac } = microToParts(micro as unknown as bigint);

  // Format whole part with grouping if Intl exists
  const fmtWhole = getNumberFormatter({ maximumFractionDigits: 0 });
  const wholeStr = fmtWhole ? fmtWhole.format(Number(whole)) : whole.toString(10);

  if (maxDecimals === 0) {
    return withUnit ? `${sign}${wholeStr} Φ` : `${sign}${wholeStr}`;
  }

  // Fractional string at 6 decimals, then cut down.
  const frac6 = padLeft(frac.toString(10), 6);
  let fracCut = frac6.slice(0, maxDecimals);

  // Enforce minDecimals
  if (fracCut.length < minDecimals) fracCut = fracCut.padEnd(minDecimals, "0");

  let out = `${sign}${wholeStr}`;
  if (fracCut.length > 0) {
    out = `${out}.${fracCut}`;
    if (trimZeros) out = stripTrailingZeros(out);
  }

  return withUnit ? `${out} Φ` : out;
};

export const formatPhiMicroCompact = (micro: PhiMicro, opts?: Readonly<{ withUnit?: boolean; maxSig?: number }>): string => {
  const withUnit = opts?.withUnit ?? true;
  const maxSig = Math.max(2, Math.min(6, Math.floor(opts?.maxSig ?? 4)));

  const sign = (micro as unknown as bigint) < 0n ? "-" : "";
  const a = absBig(micro as unknown as bigint);

  // thresholds in microΦ
  const k = 1_000n * ONE_PHI_MICRO;
  const m = 1_000_000n * ONE_PHI_MICRO;
  const b = 1_000_000_000n * ONE_PHI_MICRO;

  let value: number;
  let suffix = "";

  if (a >= b) {
    value = Number(a) / Number(b);
    suffix = "B";
  } else if (a >= m) {
    value = Number(a) / Number(m);
    suffix = "M";
  } else if (a >= k) {
    value = Number(a) / Number(k);
    suffix = "K";
  } else {
    value = Number(a) / Number(ONE_PHI_MICRO);
    suffix = "";
  }

  if (!Number.isFinite(value)) value = 0;

  const fmt = getNumberFormatter({ maximumSignificantDigits: maxSig });
  const s = fmt ? fmt.format(value) : value.toPrecision(maxSig);

  const out = `${sign}${stripTrailingZeros(s)}${suffix}`;
  return withUnit ? `${out} Φ` : out;
};

export type FormatPriceOptions = Readonly<{
  /** "prob" shows percent; "micro" shows Φ/share; "cents" shows 0–100 (Polymarket feel). */
  mode?: "prob" | "micro" | "cents";
  /** Decimals for prob/cents (default 0 for cents, 1 for prob). */
  decimals?: number;
}>;

/**
 * PriceMicro is microΦ per 1 share (0..ONE_PHI_MICRO typical).
 * Interpretable as:
 * - probability-ish = price / ONE_PHI_MICRO
 * - cents-ish = probability * 100
 */
export const formatPriceMicro = (priceMicro: PriceMicro, opts?: FormatPriceOptions): string => {
  const mode = opts?.mode ?? "cents";

  const p = priceMicro as unknown as bigint;
  const clamped = p < 0n ? 0n : p > ONE_PHI_MICRO ? ONE_PHI_MICRO : p;

  if (mode === "micro") {
    // show "0.532 Φ/share"
    const s = formatPhiMicro(clamped as unknown as PhiMicro, { withUnit: true, maxDecimals: 6, trimZeros: true });
    return `${s}/share`;
  }

  if (mode === "prob") {
    const decimals = Math.max(0, Math.min(2, Math.floor(opts?.decimals ?? 1)));
    // percent = clamped / ONE_PHI_MICRO * 100
    const num = Number(clamped) / Number(ONE_PHI_MICRO);
    const pct = num * 100;
    const fmt = getNumberFormatter({ minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const s = fmt ? fmt.format(pct) : pct.toFixed(decimals);
    return `${stripTrailingZeros(s)}%`;
  }

  // cents mode (default): "62" or "62.3"
  const decimals = Math.max(0, Math.min(1, Math.floor(opts?.decimals ?? 0)));
  const num = Number(clamped) / Number(ONE_PHI_MICRO);
  const cents = num * 100;
  const fmt = getNumberFormatter({ minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const s = fmt ? fmt.format(cents) : cents.toFixed(decimals);
  return stripTrailingZeros(s);
};

/** Shares micro -> "x.xx shares" */
export const formatSharesMicro = (shares: ShareMicro, opts?: Readonly<{ maxDecimals?: number }>): string => {
  const maxDecimals = Math.max(0, Math.min(6, Math.floor(opts?.maxDecimals ?? 2)));
  const a = shares as unknown as bigint;
  const sign = a < 0n ? "-" : "";
  const abs = absBig(a);

  const whole = abs / ONE_SHARE_MICRO;
  const frac = abs % ONE_SHARE_MICRO;

  const wholeStr = whole.toString(10);
  if (maxDecimals === 0) return `${sign}${wholeStr} shares`;

  const frac6 = padLeft(frac.toString(10), 6).slice(0, maxDecimals);
  const out = stripTrailingZeros(`${sign}${wholeStr}.${frac6}`);
  return `${out} shares`;
};

/** Pulses -> human-ish duration string (bridge). */
export const formatPulsesAsDuration = (pulses: KaiPulse): string => {
  const p = Number.isFinite(pulses) ? Math.max(0, Math.floor(pulses)) : 0;
  const seconds = p * PULSE_SECONDS;

  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";

  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

/** Close countdown label */
export const formatCloseIn = (closeInPulses: KaiPulse): string => {
  const p = Number.isFinite(closeInPulses) ? Math.max(0, Math.floor(closeInPulses)) : 0;
  if (p === 0) return "closed";
  if (p === 1) return "1 pulse";
  if (p < 20) return `${p} pulses`;
  return `${p} pulses • ${formatPulsesAsDuration(p as KaiPulse)}`;
};

export const shortHash = (h: string, left = 8, right = 4): string => {
  const s = (h ?? "").trim();
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
};

export const shortKey = (k: string): string => shortHash(k, 8, 2);

/**
 * Parse a user input like "1.25" into microΦ bigint.
 * - max 6 decimals
 * - rejects negatives and NaN
 */
export const parsePhiToMicro = (input: string): Readonly<{ ok: true; micro: PhiMicro } | { ok: false; error: string }> => {
  const s = (input ?? "").trim();
  if (s.length === 0) return { ok: false, error: "empty" };
  if (s.startsWith("-")) return { ok: false, error: "negative not allowed" };

  // Accept "123", "123.4", "123.456789" (we clamp to 6)
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return { ok: false, error: "invalid number" };

  const wholeStr = m[1];
  const fracStr = m[2] ?? "";

  let whole: bigint;
  try {
    whole = BigInt(wholeStr);
  } catch {
    return { ok: false, error: "invalid whole" };
  }

  const frac6 = (fracStr + "000000").slice(0, 6);
  let frac: bigint;
  try {
    frac = BigInt(frac6);
  } catch {
    return { ok: false, error: "invalid fraction" };
  }

  const micro = whole * ONE_PHI_MICRO + frac;
  return { ok: true, micro: micro as PhiMicro };
};
