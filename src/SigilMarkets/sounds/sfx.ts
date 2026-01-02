// SigilMarkets/sounds/sfx.ts
"use client";

/**
 * Central SFX definitions (used by useSfx and future sound routing).
 * No external audio files; these are oscillator envelopes.
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

export const envForSfx = (kind: SfxKind): readonly SfxEnv[] => {
  switch (kind) {
    case "tap":
      return [{ freqHz: 420, durMs: 32, gain: 0.05, type: "sine", attackMs: 2, releaseMs: 18 }];
    case "toggle":
      return [{ freqHz: 520, durMs: 46, gain: 0.06, type: "triangle", attackMs: 3, releaseMs: 22 }];
    case "tick":
      return [{ freqHz: 880, durMs: 18, gain: 0.03, type: "sine", attackMs: 1, releaseMs: 10 }];
    case "lock":
      return [
        { freqHz: 392, durMs: 70, gain: 0.06, type: "sine", attackMs: 4, releaseMs: 35 },
        { freqHz: 588, durMs: 55, gain: 0.05, type: "sine", attackMs: 3, releaseMs: 30 },
      ];
    case "mint":
      return [
        { freqHz: 528, durMs: 80, gain: 0.06, type: "triangle", attackMs: 4, releaseMs: 42 },
        { freqHz: 792, durMs: 64, gain: 0.05, type: "sine", attackMs: 3, releaseMs: 34 },
      ];
    case "win":
      return [
        { freqHz: 528, durMs: 90, gain: 0.07, type: "sine", attackMs: 4, releaseMs: 48 },
        { freqHz: 660, durMs: 90, gain: 0.06, type: "sine", attackMs: 4, releaseMs: 48 },
        { freqHz: 792, durMs: 110, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 58 },
      ];
    case "loss":
      return [
        { freqHz: 220, durMs: 120, gain: 0.06, type: "sine", attackMs: 6, releaseMs: 70 },
        { freqHz: 196, durMs: 120, gain: 0.05, type: "triangle", attackMs: 6, releaseMs: 70 },
      ];
    case "resolve":
      return [
        { freqHz: 440, durMs: 70, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 35 },
        { freqHz: 660, durMs: 70, gain: 0.05, type: "sine", attackMs: 4, releaseMs: 35 },
      ];
    case "error":
      return [{ freqHz: 160, durMs: 140, gain: 0.07, type: "square", attackMs: 3, releaseMs: 90 }];
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = kind;
      return [{ freqHz: 420, durMs: 32, gain: 0.05, type: "sine", attackMs: 2, releaseMs: 18 }];
    }
  }
};
