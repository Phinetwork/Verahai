// SigilMarkets/hooks/usePulseTicker.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KaiMoment, KaiPulse } from "../types/marketTypes";
import {
  createKaiNowClock,
  kaiMomentFromMicroPulses,
  MICRO_PER_PULSE,
  type KaiNowClock,
  type KaiNowSource,
} from "./useKaiNow";
import { msUntilNextPulseBoundary } from "../../utils/kai_pulse";

type UnknownRecord = Record<string, unknown>;

export type PulseTickerOptions = Readonly<{
  /** Default: true */
  enabled?: boolean;
  /**
   * Default: true
   * Re-sync immediately when the tab becomes visible or window gains focus.
   */
  syncOnVisibility?: boolean;
  /**
   * Default: false
   * If true, stop scheduling while hidden (saves battery). On visible, resync.
   * Most Kai-Klok UX wants this false (keep living even offscreen).
   */
  pauseWhenHidden?: boolean;
  /**
   * Optional callback fired when a new pulse is observed.
   * Called after state updates (best effort).
   */
  onPulse?: (moment: KaiMoment, microPulses: bigint) => void;
}>;

export type PulseTickerSnapshot = Readonly<{
  microPulses: bigint;
  pulse: KaiPulse;
  moment: KaiMoment;
  source: KaiNowSource;
  isSeeded: boolean;
}>;

const getGlobal = (): UnknownRecord => globalThis as unknown as UnknownRecord;

const isDocumentVisible = (): boolean => {
  const g = getGlobal();
  const d = g["document"];
  if (typeof d === "object" && d !== null) {
    const vis = (d as UnknownRecord)["visibilityState"];
    if (vis === "hidden") return false;
  }
  return true;
};

const pulseFromMicro = (micro: bigint): KaiPulse => {
  if (micro <= 0n) return 0;
  const p = micro / MICRO_PER_PULSE;
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const msUntilNextPulse = (micro: bigint): number => {
  const timeSource = {
    nowMicroPulses: () => micro,
    nowPulse: () => pulseFromMicro(micro),
  };
  const ms = msUntilNextPulseBoundary(undefined, timeSource as unknown as { nowMicroPulses: () => bigint });
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.max(1, Math.min(60_000, Math.ceil(ms)));
};

export const usePulseTicker = (
  options?: PulseTickerOptions,
  providedClock?: KaiNowClock,
): PulseTickerSnapshot => {
  const enabled = options?.enabled ?? true;
  const syncOnVisibility = options?.syncOnVisibility ?? true;
  const pauseWhenHidden = options?.pauseWhenHidden ?? false;
  const onPulse = options?.onPulse;

  const clock = useMemo(() => providedClock ?? createKaiNowClock(), [providedClock]);

  const [snap, setSnap] = useState<PulseTickerSnapshot>(() => {
    const micro = clock.microNow();
    const moment = kaiMomentFromMicroPulses(micro);
    return {
      microPulses: micro,
      pulse: moment.pulse,
      moment,
      source: clock.source,
      isSeeded: clock.isSeeded,
    };
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(false);
  const lastPulseRef = useRef<KaiPulse>(snap.pulse);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resyncNow = (): void => {
    const micro = clock.microNow();
    const moment = kaiMomentFromMicroPulses(micro);
    const p = moment.pulse;

    lastPulseRef.current = p;

    setSnap({
      microPulses: micro,
      pulse: p,
      moment,
      source: clock.source,
      isSeeded: clock.isSeeded,
    });

    if (onPulse) onPulse(moment, micro);
  };

  const scheduleNext = (): void => {
    clearTimer();
    if (!enabled) return;
    if (pauseWhenHidden && !isDocumentVisible()) return;

    const micro = clock.microNow();
    const delay = msUntilNextPulse(micro);

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;

      if (pauseWhenHidden && !isDocumentVisible()) {
        // If hidden, do not tick. We'll resync when visible.
        clearTimer();
        return;
      }

      const micro2 = clock.microNow();
      const moment2 = kaiMomentFromMicroPulses(micro2);
      const p2 = moment2.pulse;

      const prevPulse = lastPulseRef.current;

      if (p2 !== prevPulse) {
        lastPulseRef.current = p2;
        setSnap({
          microPulses: micro2,
          pulse: p2,
          moment: moment2,
          source: clock.source,
          isSeeded: clock.isSeeded,
        });
        if (onPulse) onPulse(moment2, micro2);
      } else {
        // We woke up before crossing the boundary due to timer granularity.
        // Re-schedule a tight follow-up tick.
      }

      scheduleNext();
    }, delay);
  };

  useEffect(() => {
    mountedRef.current = true;
    lastPulseRef.current = snap.pulse;
    scheduleNext();

    return () => {
      mountedRef.current = false;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pauseWhenHidden, clock]);

  useEffect(() => {
    if (!syncOnVisibility) return;

    const g = getGlobal();
    const d = g["document"];
    const w = g["window"];

    const onVis = (): void => {
      if (!enabled) return;
      if (pauseWhenHidden && !isDocumentVisible()) return;
      resyncNow();
      scheduleNext();
    };

    const onFocus = (): void => {
      if (!enabled) return;
      if (pauseWhenHidden && !isDocumentVisible()) return;
      resyncNow();
      scheduleNext();
    };

    if (typeof d === "object" && d !== null) {
      const add = (d as UnknownRecord)["addEventListener"];
      const rem = (d as UnknownRecord)["removeEventListener"];
      if (typeof add === "function" && typeof rem === "function") {
        add.call(d, "visibilitychange", onVis);
        return () => {
          rem.call(d, "visibilitychange", onVis);
        };
      }
    }

    if (typeof w === "object" && w !== null) {
      const add = (w as UnknownRecord)["addEventListener"];
      const rem = (w as UnknownRecord)["removeEventListener"];
      if (typeof add === "function" && typeof rem === "function") {
        add.call(w, "focus", onFocus);
        return () => {
          rem.call(w, "focus", onFocus);
        };
      }
    }

    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, syncOnVisibility, pauseWhenHidden, clock]);

  // Ensure pulse is monotonic in state even if the caller renders mid-pulse without ticking yet.
  // (We do NOT auto-advance here; usePulseTicker only advances on scheduled ticks.)
  const stablePulse = useMemo<KaiPulse>(() => {
    const micro = snap.microPulses;
    const computed = pulseFromMicro(micro);
    return computed === snap.pulse ? snap.pulse : computed;
  }, [snap.microPulses, snap.pulse]);

  return {
    microPulses: snap.microPulses,
    pulse: stablePulse,
    moment: snap.moment,
    source: snap.source,
    isSeeded: snap.isSeeded,
  };
};
