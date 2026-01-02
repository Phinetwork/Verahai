// src/utils/kai_cadence.ts
// Kai-native cadence scheduler: beat/pulse intervals with Fibonacci backoff.
// - NO Date.now
// - NO setInterval backlog (uses recursive setTimeout)
// - Mobile reality: resync on foreground, optional pause when hidden
// - Deterministic cadence in Kai units (as constants), not hours

import { PULSE_MS, PULSES_BEAT } from "./kai_pulse";

export type KaiCadenceUnit = "pulse" | "beat";

export type KaiCadenceOptions = {
  unit: KaiCadenceUnit;
  // Every N units. For SW updates you’ll likely use unit="beat", every=1.
  every: number;

  // If true, no timers run while hidden; resumes cleanly on visible.
  pauseWhenHidden?: boolean;

  // Called each tick. Throwing/rejecting can be used by wrappers to backoff.
  onTick: () => void | Promise<void>;
};

export type KaiCadenceHandle = {
  stop: () => void;
};

const clampInt = (n: number, min: number, max: number): number => {
  const x = Math.floor(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
};

const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 2 ** 31 - 1; // browser clamp for setTimeout

function unitMs(unit: KaiCadenceUnit): number {
  if (unit === "pulse") return PULSE_MS;
  // beat = pulses/beat * pulse_ms
  return PULSE_MS * PULSES_BEAT;
}

export function startKaiCadence(opts: KaiCadenceOptions): KaiCadenceHandle {
  const pauseWhenHidden = opts.pauseWhenHidden !== false; // default true
  const every = clampInt(opts.every, 1, 1_000_000);

  const baseMs = unitMs(opts.unit);
  const steadyDelay = clampInt(every * baseMs, MIN_DELAY_MS, MAX_DELAY_MS);

  let disposed = false;
  let timer: number | null = null;

  const clear = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number): void => {
    if (disposed) return;
    const d = clampInt(delayMs, MIN_DELAY_MS, MAX_DELAY_MS);
    timer = window.setTimeout(() => void tick(), d);
  };

  const tick = async (): Promise<void> => {
    if (disposed) return;

    if (pauseWhenHidden && document.visibilityState !== "visible") {
      // Don’t spin in background; re-armed on visibilitychange.
      schedule(steadyDelay);
      return;
    }

    try {
      await opts.onTick();
    } finally {
      // Always continue cadence; caller can implement backoff externally.
      schedule(steadyDelay);
    }
  };

  // Start cadence immediately (first tick after steadyDelay)
  schedule(steadyDelay);

  const onVis = (): void => {
    if (document.visibilityState !== "visible") return;
    clear();
    // Foreground: tick soon (but not immediately) then resume steady cadence
    schedule(Math.min(steadyDelay, 1000));
  };

  document.addEventListener("visibilitychange", onVis, { passive: true });

  return {
    stop: () => {
      disposed = true;
      clear();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}

// Fibonacci helper for backoff schedules (1,2,3,5,8,13,...)
export const KAI_FIB: readonly number[] = [
  1, 2, 3, 5, 8, 13, 21, 34,
] as const;

export type KaiFibBackoffOptions = {
  unit: KaiCadenceUnit;
  // Fibonacci list index cap (default last index)
  maxIndex?: number;
  pauseWhenHidden?: boolean;

  // On success: reset to fib[0]
  onSuccess?: () => void;
  // On failure: step to next fib index
  onFailure?: () => void;

  // Actual work (e.g., reg.update)
  work: () => Promise<void>;
};

export function startKaiFibBackoff(opts: KaiFibBackoffOptions): KaiCadenceHandle {
  const pauseWhenHidden = opts.pauseWhenHidden !== false; // default true
  const maxIdx = clampInt(
    typeof opts.maxIndex === "number" ? opts.maxIndex : KAI_FIB.length - 1,
    0,
    KAI_FIB.length - 1
  );

  const baseMs = unitMs(opts.unit);

  let disposed = false;
  let timer: number | null = null;
  let idx = 0;

  const clear = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const scheduleNext = (): void => {
    if (disposed) return;

    const beats = KAI_FIB[idx] ?? 1;
    const delay = clampInt(beats * baseMs, MIN_DELAY_MS, MAX_DELAY_MS);

    timer = window.setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async (): Promise<void> => {
    if (disposed) return;

    if (pauseWhenHidden && document.visibilityState !== "visible") {
      scheduleNext();
      return;
    }

    try {
      await opts.work();
      idx = 0;
      opts.onSuccess?.();
    } catch {
      idx = Math.min(idx + 1, maxIdx);
      opts.onFailure?.();
    }

    scheduleNext();
  };

  scheduleNext();

  const onVis = (): void => {
    if (document.visibilityState !== "visible") return;
    clear();
    // Foreground: poke once, then resume schedule
    void opts.work().catch(() => {});
    scheduleNext();
  };

  document.addEventListener("visibilitychange", onVis, { passive: true });

  return {
    stop: () => {
      disposed = true;
      clear();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
