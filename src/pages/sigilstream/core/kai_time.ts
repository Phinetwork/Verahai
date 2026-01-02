// src/sigilstream/core/kai_time.ts
// Eternal-Klok core (μpulse math): constants + conversions

import type { LocalKai, KaiMomentStrict } from "./types";
import {
  WEEKDAY,
  DAY_TO_CHAKRA,
  DAYS_PER_WEEK,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  ETERNAL_MONTH_NAMES,
  WEEK_TITLES,
} from "./types";
import { pad2, imod, floorDiv, roundTiesToEvenBigInt } from "./utils";

/** Genesis (bridge) — 2024-05-10 06:45:41.888 UTC */
export const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);

/** Breath period (seconds) — exact φ form */
export const KAI_PULSE_SEC = 3 + Math.sqrt(5); // ≈ 5.236s

/** One pulse in milliseconds (for UI timing) */
export const PULSE_MS = KAI_PULSE_SEC * 1000;

/** Micro-pulses per pulse (exact) */
export const ONE_PULSE_MICRO = 1_000_000n;

/** Exact daily closure in micro-pulses (canonical) */
export const N_DAY_MICRO = 17_491_270_421n;

/** Steps per beat (exact) */
export const STEPS_BEAT = 44 as const;

/** Micro-pulses per step (legacy grid: 11 pulses/step × 1e6) */
export const PULSES_PER_STEP_MICRO = 11_000_000n;

/**
 * Micro-pulses per beat. N_DAY_MICRO / 36 with half-step rounding.
 * (Legacy parity constant; keep exported for compatibility, but do NOT use for beat/step indices.)
 */
export const MU_PER_BEAT_EXACT = (N_DAY_MICRO + 18n) / 36n;

// ─────────────────────────────────────────────────────────────
// REAL-DAY PARTITION HELPERS (beat/step must be derived from N_DAY_MICRO)
// ─────────────────────────────────────────────────────────────

const BEATS_PER_DAY = 36n;
const STEPS_PER_BEAT_N = BigInt(STEPS_BEAT);

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function beatIndexFromDayMicro(pμ_in_day: bigint): number {
  // beat = floor(dayPhase * 36 / N_DAY_MICRO)
  return Number((pμ_in_day * BEATS_PER_DAY) / N_DAY_MICRO);
}

function beatBoundsMicro(beat: number): { beatStart: bigint; beatEnd: bigint; beatLen: bigint } {
  const b = BigInt(beat);
  // beatStart = floor(b*N/36), beatEnd = floor((b+1)*N/36)
  const beatStart = (b * N_DAY_MICRO) / BEATS_PER_DAY;
  const beatEnd = ((b + 1n) * N_DAY_MICRO) / BEATS_PER_DAY;
  return { beatStart, beatEnd, beatLen: beatEnd - beatStart };
}

function stepIndexFromBeatMicro(inBeat: bigint, beatLen: bigint): number {
  // step = floor(inBeat * 44 / beatLen)
  return beatLen > 0n ? Number((inBeat * STEPS_PER_BEAT_N) / beatLen) : 0;
}

function stepBoundsMicro(step: number, beatLen: bigint): { stepStart: bigint; stepEnd: bigint; stepLen: bigint } {
  const s = BigInt(step);
  // stepStart = floor(s*L/44), stepEnd = floor((s+1)*L/44)
  const stepStart = (s * beatLen) / STEPS_PER_BEAT_N;
  const stepEnd = ((s + 1n) * beatLen) / STEPS_PER_BEAT_N;
  return { stepStart, stepEnd, stepLen: stepEnd - stepStart };
}

/** Convert a JS Date to absolute micro-pulses since Genesis (ties-to-even) */
export function microPulsesSinceGenesis(date: Date): bigint {
  const deltaSec = (date.getTime() - GENESIS_TS) / 1000;
  const pulses = deltaSec / KAI_PULSE_SEC;
  const micro = pulses * 1_000_000;
  return roundTiesToEvenBigInt(micro);
}

/** Compute LocalKai (display/state) at a Date — μpulse-true */
export function computeLocalKai(date: Date): LocalKai {
  const pμ_total = microPulsesSinceGenesis(date);
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  // ✅ REAL-DAY beat partition (no MU_PER_BEAT_EXACT)
  const beatRaw = beatIndexFromDayMicro(pμ_in_day);
  const beat = clampInt(beatRaw, 0, 35);

  const { beatStart, beatLen } = beatBoundsMicro(beat);
  const pμ_in_beat = pμ_in_day - beatStart;

  // ✅ REAL-DAY step partition (no fixed 11-pulse steps)
  const stepRaw = stepIndexFromBeatMicro(pμ_in_beat, beatLen);
  const step = clampInt(stepRaw, 0, STEPS_BEAT - 1);

  const { stepStart, stepLen } = stepBoundsMicro(step, beatLen);
  const pμ_in_step = pμ_in_beat - stepStart;
  const stepPct = stepLen > 0n ? Number(pμ_in_step) / Number(stepLen) : 0;

  const pulse = Number(floorDiv(pμ_total, ONE_PULSE_MICRO));
  const pulsesIntoBeat = Number(pμ_in_beat / ONE_PULSE_MICRO);
  const pulsesIntoDay = Number(pμ_in_day / ONE_PULSE_MICRO);

  const harmonicDayIndex = Number(imod(dayIndex, BigInt(DAYS_PER_WEEK)));
  const harmonicDay = WEEKDAY[harmonicDayIndex]!;
  const chakraDay = DAY_TO_CHAKRA[harmonicDay];

  const dayIndexNum = Number(dayIndex);
  const dayOfMonth =
    ((dayIndexNum % DAYS_PER_MONTH) + DAYS_PER_MONTH) % DAYS_PER_MONTH + 1;

  const monthsSinceGenesis = Math.floor(dayIndexNum / DAYS_PER_MONTH);
  const monthIndex0 =
    ((monthsSinceGenesis % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  const monthIndex1 = monthIndex0 + 1;
  const monthName = ETERNAL_MONTH_NAMES[monthIndex0]!;

  const yearIndex = Math.floor(dayIndexNum / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  const weekIndex = Math.floor((dayOfMonth - 1) / DAYS_PER_WEEK);
  const weekName = WEEK_TITLES[weekIndex]!;

  const chakraStepString = `${beat}:${pad2(step)}`;

  return {
    pulse,
    beat,
    step,
    stepPct,
    pulsesIntoBeat,
    pulsesIntoDay,
    harmonicDay,
    chakraDay,
    chakraStepString,
    dayOfMonth,
    monthIndex0,
    monthIndex1,
    monthName,
    yearIndex,
    weekIndex,
    weekName,
    _pμ_in_day: pμ_in_day,
    _pμ_in_beat: pμ_in_beat,
  };
}

/** Build a strict Kai label from an absolute pulse index */
export function kaiMomentFromAbsolutePulse(pulse: number): KaiMomentStrict {
  const pμ_total = BigInt(pulse) * ONE_PULSE_MICRO;
  const pμ_in_day = imod(pμ_total, N_DAY_MICRO);
  const dayIndex = floorDiv(pμ_total, N_DAY_MICRO);

  const beatRaw = beatIndexFromDayMicro(pμ_in_day);
  const beat = clampInt(beatRaw, 0, 35);

  const { beatStart, beatLen } = beatBoundsMicro(beat);
  const pμ_in_beat = pμ_in_day - beatStart;

  const stepRaw = stepIndexFromBeatMicro(pμ_in_beat, beatLen);
  const stepClamped = clampInt(stepRaw, 0, STEPS_BEAT - 1);

  const weekday = WEEKDAY[Number(imod(dayIndex, 6n)) as 0 | 1 | 2 | 3 | 4 | 5];
  const chakraDay = DAY_TO_CHAKRA[weekday];

  return { beat, stepIndex: stepClamped, weekday, chakraDay };
}
