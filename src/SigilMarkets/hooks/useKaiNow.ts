// SigilMarkets/hooks/useKaiNow.ts
"use client";

import { useMemo } from "react";
import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import { getKaiTimeSource, microPulsesSinceGenesis } from "../../utils/kai_pulse";

type UnknownRecord = Record<string, unknown>;

export type KaiNowSource = "global-fn" | "build-anchor" | "klock-engine" | "date-bridge";

/** 1 pulse = 1,000,000 micro-pulses. */
export const MICRO_PER_PULSE = 1_000_000n;

/** Grid constants for beat/step indexing (KKS indexing). */
const PULSES_PER_STEP = 11;
const STEPS_PER_BEAT = 44;
const BEATS_PER_DAY = 36;
const PULSES_PER_BEAT = PULSES_PER_STEP * STEPS_PER_BEAT; // 484
const PULSES_PER_DAY_GRID = PULSES_PER_BEAT * BEATS_PER_DAY; // 17424

const getGlobal = (): UnknownRecord => globalThis as unknown as UnknownRecord;

const isFn0 = (v: unknown): v is () => unknown => typeof v === "function";

const toBigIntSafe = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return BigInt(Math.floor(v));
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s.length === 0) return null;
    // allow leading minus? (not expected, but tolerate)
    const ok = /^-?\d+$/.test(s);
    if (!ok) return null;
    try {
      return BigInt(s);
    } catch {
      return null;
    }
  }
  return null;
};

const perfNowMs = (): number => {
  const g = getGlobal();
  const p = g["performance"];
  if (typeof p === "object" && p !== null) {
    const pn = (p as UnknownRecord)["now"];
    if (typeof pn === "function") {
      const out = pn.call(p);
      if (typeof out === "number" && Number.isFinite(out)) return out;
    }
  }
  return 0;
};

const dateNowMs = (): number => {
  const out = Date.now();
  return Number.isFinite(out) ? out : 0;
};

export type KaiNowClock = Readonly<{
  microNow: () => bigint;
  source: KaiNowSource;
  isSeeded: boolean;
}>;

/**
 * Create a clock that can produce "micro-pulses now".
 * Priority:
 * 1) globalThis.__KAI_NOW_MICRO__() -> bigint/number/string
 * 2) globalThis.__KAI_ANCHOR_MICRO__ + performance.now() delta (bridge)
 * 3) Kai-Klok engine time source (state machine)
 * 4) Date.now() bridge from epoch 0 (last resort)
 */
export const createKaiNowClock = (): KaiNowClock => {
  const g = getGlobal();

  const maybeFn = g["__KAI_NOW_MICRO__"];
  if (isFn0(maybeFn)) {
    return {
      microNow: () => {
        const v = maybeFn();
        const bi = toBigIntSafe(v);
        return bi ?? 0n;
      },
      source: "global-fn",
      isSeeded: true,
    };
  }

  const anchor = toBigIntSafe(g["__KAI_ANCHOR_MICRO__"]);
  if (anchor !== null) {
    const baseEpochMs = dateNowMs();
    const baseMicro = microPulsesSinceGenesis(BigInt(baseEpochMs));
    const t0 = perfNowMs();
    return {
      microNow: () => {
        const dtMs = perfNowMs() - t0;
        const epochMs = baseEpochMs + (Number.isFinite(dtMs) ? dtMs : 0);
        const microNow = microPulsesSinceGenesis(BigInt(Math.round(epochMs)));
        return anchor + (microNow - baseMicro);
      },
      source: "build-anchor",
      isSeeded: true,
    };
  }

  const engine = getKaiTimeSource();
  if (engine && typeof engine.nowMicroPulses === "function") {
    return {
      microNow: () => engine.nowMicroPulses(),
      source: "klock-engine",
      isSeeded: true,
    };
  }

  // Last resort: bridge from Date.now using the canonical KKS v1.0 genesis anchor.
  // (This keeps pulse counts stable across refreshes, even in standalone/demo contexts.)
  return {
    microNow: () => {
      return microPulsesSinceGenesis(BigInt(dateNowMs()));
    },
    source: "date-bridge",
    isSeeded: true,
  };
};

/** Convert micro-pulses -> integer pulse. */
export const pulseFromMicroPulses = (microPulses: bigint): KaiPulse => {
  if (microPulses <= 0n) return 0;
  const p = microPulses / MICRO_PER_PULSE;
  const asNum = Number(p);
  return Number.isFinite(asNum) && asNum >= 0 ? Math.floor(asNum) : 0;
};

/**
 * Compute beat + stepIndex using the 17,424 grid indexing (KKS).
 * This is the stable UI indexing model (0-based), independent of wall-clock.
 */
export const kaiMomentFromPulse = (pulse: KaiPulse): KaiMoment => {
  const p = Number.isFinite(pulse) && pulse >= 0 ? Math.floor(pulse) : 0;

  const inDay = ((p % PULSES_PER_DAY_GRID) + PULSES_PER_DAY_GRID) % PULSES_PER_DAY_GRID;
  const beat = Math.floor(inDay / PULSES_PER_BEAT);
  const inBeat = inDay % PULSES_PER_BEAT;
  const stepIndex = Math.floor(inBeat / PULSES_PER_STEP);

  return { pulse: p, beat, stepIndex };
};

export const kaiMomentFromMicroPulses = (microPulses: bigint): KaiMoment => {
  const pulse = pulseFromMicroPulses(microPulses);
  return kaiMomentFromPulse(pulse);
};

/**
 * Hook: returns a memoized clock + a snapshot "now".
 * This does NOT tick; use usePulseTicker for pulse-boundary updates.
 */
export const useKaiNow = (): Readonly<{
  clock: KaiNowClock;
  microPulses: bigint;
  moment: KaiMoment;
  source: KaiNowSource;
  isSeeded: boolean;
}> => {
  const clock = useMemo(() => createKaiNowClock(), []);
  const microPulses = clock.microNow();
  const moment = kaiMomentFromMicroPulses(microPulses);

  return {
    clock,
    microPulses,
    moment,
    source: clock.source,
    isSeeded: clock.isSeeded,
  };
};
