// SigilMarkets/sounds/sfx.ts
"use client";

/**
 * Central SFX definitions (used by useSfx and future sound routing).
 * No external audio files; these are oscillator envelopes.
 *
 * GOD MODE COHERENCE (Kai Breath Entrainment):
 * - Major actions include a low-gain BREATH BED whose duration is derived from the
 *   *actual* Kai breath math:  T = 3 + √5  seconds
 * - Breath frequency is therefore: f = 1 / T  ≈ 0.1909830056 Hz  (≈ 0.191 Hz)
 * - The bed uses a coherent Fibonacci partial ladder (sub + root) while the *envelope*
 *   follows inhale/exhale split by φ so the body “locks in”.
 */

export type SfxKind =
  | "tap"
  | "toggle"
  | "tick"
  | "lock"
  | "mint"
  | "win"
  | "loss"
  | "resolve"
  | "error";

export type SfxEnv = Readonly<{
  freqHz: number;
  durMs: number;
  gain: number;
  type: OscillatorType;
  attackMs: number;
  releaseMs: number;
}>;

/** φ (exact math). */
const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Kai breath math (exact):
 * T = 3 + √5 seconds
 * f = 1/T Hz  (~0.1909830056 Hz)
 */
const KAI_BREATH_T_S = 3 + Math.sqrt(5);
export const KAI_BREATH_HZ = 1 / KAI_BREATH_T_S; // ~0.1909830056 Hz (≈ 0.191)
const KAI_BREATH_MS = KAI_BREATH_T_S * 1000;

/**
 * Inhale / Exhale split by φ (smooth nervous-system entrainment envelope):
 * inhale = T/φ, exhale = T - inhale  (≈ 3.236s + 2.000s)
 */
const KAI_INHALE_MS = (KAI_BREATH_T_S / PHI) * 1000;
const KAI_EXHALE_MS = KAI_BREATH_MS - KAI_INHALE_MS;

/** Fibonacci constants (Hz + ms). */
const F = {
  // time (ms)
  n5: 5,
  n8: 8,
  n13: 13,
  n21: 21,
  n34: 34,
  n55: 55,
  n89: 89,
  n144: 144,
  n233: 233,
  n377: 377,

  // frequency (Hz) — Fibonacci ladder
  hz55: 55,
  hz89: 89,
  hz144: 144,
  hz233: 233,
  hz377: 377,
  hz610: 610,
  hz987: 987,
  hz1597: 1597,

  // gain denominator (Fib)
  n610: 610,
} as const;

/** Gain ratios (Fib/Fib only). Keep safe; scale overall volume in your audio engine if needed. */
const G = {
  g5: F.n5 / F.n610, // ~0.0082
  g8: F.n8 / F.n610, // ~0.0131
  g13: F.n13 / F.n610, // ~0.0213
  g21: F.n21 / F.n610, // ~0.0344
  g34: F.n34 / F.n610, // ~0.0557
} as const;

const env = (
  freqHz: number,
  durMs: number,
  gain: number,
  type: OscillatorType,
  attackMs: number,
  releaseMs: number,
): SfxEnv => ({ freqHz, durMs, gain, type, attackMs, releaseMs });

/**
 * Breath-bed: a gentle “landing pad” whose *duration* is derived from Kai breath math,
 * and whose envelope follows inhale/exhale split by φ.
 *
 * We keep the tones Fibonacci-pure; the entrainment comes from the breath-period + φ envelope.
 */
const breathBed = (): readonly SfxEnv[] =>
  [
    // deep-ish anchor (still audible on more devices than true sub)
    env(F.hz89, KAI_BREATH_MS, G.g5, "triangle", KAI_INHALE_MS, KAI_EXHALE_MS),
    // warm body
    env(F.hz144, KAI_BREATH_MS, G.g8, "triangle", KAI_INHALE_MS, KAI_EXHALE_MS),
    // audible center (always translates on phone speakers)
    env(F.hz233, KAI_BREATH_MS, G.g8, "sine", KAI_INHALE_MS, KAI_EXHALE_MS),
  ] as const;

/** Breath “halo” sparkle: tiny overtone that decays fast so it never feels sharp. */
const halo = (): SfxEnv => env(F.hz987, F.n89, G.g5, "sine", F.n13, F.n55);

export const envForSfx = (kind: SfxKind): readonly SfxEnv[] => {
  switch (kind) {
    // Tiny actions: no breath bed (prevents stacking fatigue)
    case "tap":
      return [env(F.hz233, F.n34, G.g21, "sine", F.n5, F.n21)] as const;

    case "toggle":
      return [
        env(F.hz233, F.n55, G.g21, "sine", F.n8, F.n34),
        env(F.hz377, F.n34, G.g13, "sine", F.n5, F.n21),
      ] as const;

    case "tick":
      return [env(F.hz610, F.n21, G.g8, "sine", F.n5, F.n13)] as const;

    // Major actions: add Kai-breath entrainment bed (T = 3 + √5, f ≈ 0.191 Hz)
    case "lock":
      return [
        // event chime (seal)
        env(F.hz144, F.n144, G.g21, "sine", F.n13, F.n89),
        env(F.hz233, F.n89, G.g21, "sine", F.n13, F.n55),
        env(F.hz377, F.n55, G.g13, "sine", F.n8, F.n34),
        halo(),
        // entrainment bed
        ...breathBed(),
      ] as const;

    case "mint":
      return [
        // event chime (birth / ascent)
        env(F.hz233, F.n89, G.g21, "triangle", F.n13, F.n55),
        env(F.hz377, F.n144, G.g21, "sine", F.n21, F.n89),
        env(F.hz610, F.n233, G.g13, "sine", F.n21, F.n144),
        halo(),
        // entrainment bed
        ...breathBed(),
      ] as const;

    case "win":
      return [
        // event chord (blessing)
        env(F.hz233, F.n144, G.g34, "sine", F.n21, F.n89),
        env(F.hz377, F.n233, G.g21, "sine", F.n21, F.n144),
        env(F.hz610, F.n377, G.g13, "sine", F.n34, F.n233),
        env(F.hz1597, F.n89, G.g5, "sine", F.n13, F.n55), // bright crown (soft + short)
        halo(),
        // entrainment bed
        ...breathBed(),
      ] as const;

    case "resolve":
      return [
        // completion (calm φ-unison)
        env(F.hz233, F.n233, G.g21, "sine", F.n21, F.n144),
        env(F.hz377, F.n233, G.g21, "sine", F.n21, F.n144),
        halo(),
        // entrainment bed
        ...breathBed(),
      ] as const;

    case "loss":
      return [
        // grounding descent (still coherent, not scary)
        env(F.hz144, F.n377, G.g21, "sine", F.n34, F.n233),
        env(F.hz89, 2584, G.g5, "triangle", 610, 1597), // slow settle (kept gentle)
        env(F.hz233, F.n144, G.g8, "sine", F.n21, F.n89), // audible re-center
      ] as const;

    case "error":
      return [
        // sharp edge but still Fibonacci-coherent
        env(F.hz610, F.n233, G.g21, "square", F.n13, F.n144),
        env(F.hz233, F.n89, G.g13, "sine", F.n13, F.n55), // immediate re-center
      ] as const;

    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = kind;
      return [env(F.hz233, F.n34, G.g21, "sine", F.n5, F.n21)] as const;
    }
  }
};
