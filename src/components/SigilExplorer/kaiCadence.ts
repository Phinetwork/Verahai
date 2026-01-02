// src/components/SigilExplorer/kaiCadence.ts
/* ─────────────────────────────────────────────────────────────────────
   Kai cadence helpers (phase-locked)
────────────────────────────────────────────────────────────────────── */

export const hasWindow = typeof window !== "undefined";

export function nowMs(): number {
  return Date.now();
}

/** KKS-1.0 φ-exact breath (seconds). */
const KAI_BREATH_SEC = 3 + Math.sqrt(5);
/** Breath duration in ms (≈ 5236.0679ms). Used ONLY to schedule, never to order. */
const KAI_BREATH_MS = KAI_BREATH_SEC * 1000;

/**
 * Genesis epoch (bridge only) used to phase-lock “pulse ticks” to breath boundaries.
 * Ordering still uses payload pulse/beat/stepIndex; this is only the wake cadence.
 */
const KAI_GENESIS_EPOCH_MS = 1715323541888;

/** Timer guards (avoid 0ms storms / long sleeps). */
const KAI_TIMER_MIN_MS = 25;
const KAI_TIMER_MAX_MS = 30_000;

export function msUntilNextKaiBreath(now = nowMs()): number {
  const dt = now - KAI_GENESIS_EPOCH_MS;
  if (!Number.isFinite(dt)) return 5236;

  const breaths = dt / KAI_BREATH_MS;
  const nextBreathIndex = Math.floor(breaths) + 1;
  const nextAt = KAI_GENESIS_EPOCH_MS + nextBreathIndex * KAI_BREATH_MS;

  const ms = nextAt - now;
  const safe = Number.isFinite(ms) ? ms : 5236;

  return Math.min(KAI_TIMER_MAX_MS, Math.max(KAI_TIMER_MIN_MS, Math.round(safe)));
}
