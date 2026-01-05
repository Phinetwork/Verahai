// SigilMarkets/hooks/useSfx.ts
"use client";

/**
 * SigilMarkets — useSfx
 *
 * UX goal:
 * - Micro-sounds that feel "alive" and Kai-bound.
 * - Never blast audio: respect user toggles, reduce-motion intent, and autoplay rules.
 *
 * Implementation:
 * - Uses WebAudio (AudioContext + oscillator envelopes).
 * - No external audio assets required.
 * - Callers should keep SFX sparse and meaningful.
 *
 * PREMIUM COHERENCE TUNING:
 * - Pitch + timing stay Fibonacci-clean (as before).
 * - A shared “Golden Breath” modulation bus runs at EXACT f = 1/(3+√5) Hz ≈ 0.191 Hz.
 *   This is the slow coherence carrier that everything rides on.
 * - UI sounds remain instant (no lag), but when a sound occurs close to a breath boundary,
 *   we *snap* it onto that boundary (≤ 55ms window) to feel “locked” without delaying UX.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSigilMarketsUi } from "../state/uiStore";

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

type AudioLike = AudioContext | null;

const canUseAudioContext = (): boolean => {
  const g = globalThis as unknown as Record<string, unknown>;
  const AC = (g["AudioContext"] ?? g["webkitAudioContext"]) as unknown;
  return typeof AC === "function";
};

const getAudioContext = (): AudioLike => {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const AC = (g["AudioContext"] ?? g["webkitAudioContext"]) as unknown;
    if (typeof AC !== "function") return null;
    return new (AC as { new (): AudioContext })();
  } catch {
    return null;
  }
};

// Pure Fibonacci tones in Hz (no non-fib frequencies).
const FIB_HZ = [34, 55, 89, 144, 233, 377, 610, 987, 1597] as const;
// Pure Fibonacci time constants in ms.
const FIB_MS = [13, 21, 34, 55, 89, 144, 233] as const;

const fibHz = (i: number): number => {
  const idx = Math.max(0, Math.min(FIB_HZ.length - 1, i | 0));
  return FIB_HZ[idx];
};

const fibMs = (i: number): number => {
  const idx = Math.max(0, Math.min(FIB_MS.length - 1, i | 0));
  return FIB_MS[idx];
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Golden Breath (exact):
 * T = 3 + √5 seconds
 * f = 1 / T  ≈ 0.190983... Hz  (~0.191 Hz)
 */
const GOLDEN_BREATH_S = 3 + Math.sqrt(5);
const GOLDEN_BREATH_HZ = 1 / GOLDEN_BREATH_S;

// Window to “snap” a sound onto the next Golden Breath boundary without introducing UX lag.
// 55ms is Fibonacci + feels instant in UI.
const ALIGN_WINDOW_S = fibMs(3) / 1000; // 55ms

// Subtle tremolo depth on the global breath bus (keep premium, never seasick).
const BREATH_DEPTH = 0.028; // ~±2.8% gain modulation

type Env = Readonly<{
  freqHz: number;
  durMs: number;
  gain: number;
  type: OscillatorType;
  attackMs: number;
  releaseMs: number;
  /** Optional arpeggio / stagger (also Fibonacci). */
  offsetMs: number;
  /** Premium: tiny chorus detune in cents (deterministic, subtle). */
  detuneCents: number;
}>;

const mk = (
  hzIndex: number,
  opts: Partial<Pick<Env, "durMs" | "gain" | "type" | "attackMs" | "releaseMs" | "offsetMs" | "detuneCents">> = {},
): Env => ({
  freqHz: fibHz(hzIndex),
  durMs: opts.durMs ?? fibMs(2), // 34ms
  gain: clamp(opts.gain ?? 0.055, 0, 0.12),
  type: opts.type ?? "sine",
  attackMs: opts.attackMs ?? fibMs(0), // 13ms
  releaseMs: opts.releaseMs ?? fibMs(1), // 21ms
  offsetMs: opts.offsetMs ?? 0,
  detuneCents: clamp(opts.detuneCents ?? 0, -9, 9),
});

const envFor = (kind: SfxKind): readonly Env[] => {
  // Fibonacci pitch + Fibonacci timing; premium shaping happens in the graph.
  switch (kind) {
    case "tap":
      return [mk(4, { durMs: fibMs(0), attackMs: fibMs(0), releaseMs: fibMs(1), gain: 0.044, type: "sine" })]; // 233
    case "toggle":
      return [
        mk(4, { durMs: fibMs(1), attackMs: fibMs(0), releaseMs: fibMs(2), gain: 0.044, type: "triangle", detuneCents: 2 }),
        mk(5, { durMs: fibMs(1), attackMs: fibMs(0), releaseMs: fibMs(2), gain: 0.038, type: "triangle", offsetMs: fibMs(0), detuneCents: -2 }),
      ];
    case "tick":
      return [mk(6, { durMs: fibMs(0), attackMs: fibMs(0), releaseMs: fibMs(0), gain: 0.03, type: "sine" })]; // 610
    case "lock":
      return [
        mk(3, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(3), gain: 0.048, type: "sine", offsetMs: 0 }),
        mk(4, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(3), gain: 0.052, type: "sine", offsetMs: fibMs(2), detuneCents: 2 }),
        mk(5, { durMs: fibMs(2), attackMs: fibMs(1), releaseMs: fibMs(3), gain: 0.044, type: "sine", offsetMs: fibMs(3), detuneCents: -2 }),
      ];
    case "mint":
      return [
        mk(4, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.048, type: "triangle", offsetMs: 0, detuneCents: 1 }),
        mk(5, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.046, type: "sine", offsetMs: fibMs(2), detuneCents: -1 }),
        mk(6, { durMs: fibMs(2), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.04, type: "sine", offsetMs: fibMs(3) }),
      ];
    case "win":
      return [
        mk(4, { durMs: fibMs(4), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.05, type: "sine", offsetMs: 0, detuneCents: 2 }),
        mk(5, { durMs: fibMs(4), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.046, type: "sine", offsetMs: fibMs(1), detuneCents: -2 }),
        mk(6, { durMs: fibMs(4), attackMs: fibMs(1), releaseMs: fibMs(4), gain: 0.042, type: "sine", offsetMs: fibMs(2) }),
        mk(7, { durMs: fibMs(4), attackMs: fibMs(1), releaseMs: fibMs(5), gain: 0.038, type: "sine", offsetMs: fibMs(3) }),
      ];
    case "loss":
      return [
        mk(2, { durMs: fibMs(5), attackMs: fibMs(2), releaseMs: fibMs(5), gain: 0.048, type: "sine", offsetMs: 0 }),
        mk(1, { durMs: fibMs(5), attackMs: fibMs(2), releaseMs: fibMs(5), gain: 0.042, type: "triangle", offsetMs: fibMs(2) }),
      ];
    case "resolve":
      return [
        mk(4, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(3), gain: 0.043, type: "sine", offsetMs: 0 }),
        mk(5, { durMs: fibMs(3), attackMs: fibMs(1), releaseMs: fibMs(3), gain: 0.043, type: "sine", offsetMs: fibMs(1) }),
      ];
    case "error":
      return [
        mk(3, { durMs: fibMs(4), attackMs: fibMs(0), releaseMs: fibMs(4), gain: 0.058, type: "square", offsetMs: 0 }),
        mk(2, { durMs: fibMs(4), attackMs: fibMs(0), releaseMs: fibMs(4), gain: 0.048, type: "square", offsetMs: fibMs(1) }),
      ];
    default: {
      // exhaustive
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = kind;
      return [mk(4)];
    }
  }
};

type Graph = Readonly<{
  // voice inputs connect here
  inGain: GainNode;
  // breath-modulated gain (global .191Hz carrier)
  breathGain: GainNode;
  // gentle glue
  comp: DynamicsCompressorNode;
  // breath LFO + depth
  breathOsc: OscillatorNode;
  breathDepth: GainNode;
}>;

export type UseSfx = Readonly<{
  supported: boolean;
  enabled: boolean;
  /** Ensure audio is unlocked (call on first user gesture). */
  unlock: () => void;
  play: (kind: SfxKind) => void;
}>;

export const useSfx = (): UseSfx => {
  const { state } = useSigilMarketsUi();
  const enabled = state.sfxEnabled && !state.motion.reduceMotion; // reduce-motion implies "less sensory"
  const ctxRef = useRef<AudioLike>(null);
  const graphRef = useRef<Graph | null>(null);
  const unlockedRef = useRef<boolean>(false);

  const supported = useMemo(() => {
    return canUseAudioContext();
  }, []);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (!supported) return null;
    if (ctxRef.current) return ctxRef.current;
    const ctx = getAudioContext();
    ctxRef.current = ctx;
    return ctx;
  }, [supported]);

  const ensureGraph = useCallback((): Graph | null => {
    const ctx = ensureCtx();
    if (!ctx) return null;
    if (graphRef.current) return graphRef.current;

    // Global chain: voices -> inGain -> breathGain -> compressor -> destination
    const inGain = ctx.createGain();
    inGain.gain.value = 1.0;

    const breathGain = ctx.createGain();
    breathGain.gain.value = 1.0;

    const comp = ctx.createDynamicsCompressor();
    // Premium glue (subtle, avoids spikes)
    comp.threshold.value = -26;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.12;

    inGain.connect(breathGain);
    breathGain.connect(comp);
    comp.connect(ctx.destination);

    // Golden Breath LFO: oscillator -> depthGain -> breathGain.gain (AudioParam sums)
    const breathOsc = ctx.createOscillator();
    breathOsc.type = "sine";
    breathOsc.frequency.setValueAtTime(GOLDEN_BREATH_HZ, ctx.currentTime);

    const breathDepth = ctx.createGain();
    breathDepth.gain.value = BREATH_DEPTH;

    breathOsc.connect(breathDepth);
    breathDepth.connect(breathGain.gain);

    try {
      breathOsc.start();
    } catch {
      // ignore
    }

    const g: Graph = { inGain, breathGain, comp, breathOsc, breathDepth };
    graphRef.current = g;
    return g;
  }, [ensureCtx]);

  const unlock = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (unlockedRef.current) return;

    try {
      if (ctx.state === "suspended") {
        void ctx.resume().then(() => {
          if (ctx.state === "running") {
            unlockedRef.current = true;
            ensureGraph();
          }
        });
        return;
      }
      if (ctx.state === "running") {
        unlockedRef.current = true;
        ensureGraph();
      }
    } catch {
      // ignore
    }
  }, [ensureCtx, ensureGraph]);

  const play = useCallback(
    (kind: SfxKind) => {
      if (!enabled) return;

      const ctx = ensureCtx();
      if (!ctx) return;

      if (!unlockedRef.current && ctx.state !== "running") return;

      const graph = ensureGraph();
      if (!graph) return;

      if (ctx.state === "suspended" && unlockedRef.current) {
        try {
          void ctx.resume();
        } catch {
          // ignore
        }
      }

      const now = ctx.currentTime;

      // Breath boundary alignment (without UX lag):
      // If next boundary is within 55ms, snap. Otherwise, play immediately.
      const phase = now % GOLDEN_BREATH_S;
      const toNext = (GOLDEN_BREATH_S - phase) % GOLDEN_BREATH_S;
      const baseT = toNext <= ALIGN_WINDOW_S ? now + toNext : now;

      const envs = envFor(kind);

      for (let i = 0; i < envs.length; i += 1) {
        const e = envs[i];

        const offsetS = clamp(e.offsetMs, 0, 500) / 1000;
        const t0 = baseT + offsetS;

        // Voice nodes (premium chain):
        // osc -> filter -> gainEnv -> (optional pan) -> graph.inGain
        const osc = ctx.createOscillator();
        const filt = ctx.createBiquadFilter();
        const gainEnv = ctx.createGain();
        const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;

        osc.type = e.type;
        osc.frequency.setValueAtTime(e.freqHz, t0);
        if (e.detuneCents !== 0) osc.detune.setValueAtTime(e.detuneCents, t0);

        // Premium smoothness: tame harsh edges while keeping clarity.
        // Lowpass cutoff follows the fundamental (still deterministic).
        filt.type = "lowpass";
        const cutoff = clamp(e.freqHz * 8, 800, 5200);
        filt.frequency.setValueAtTime(cutoff, t0);
        filt.Q.setValueAtTime(0.9, t0);

        // Deterministic tiny stereo spread (by kind) to feel “expensive”, never gimmicky.
        if (pan) {
          const k: Record<SfxKind, number> = {
            tap: -0.04,
            toggle: 0.04,
            tick: 0.0,
            lock: -0.02,
            mint: 0.02,
            win: 0.03,
            loss: -0.03,
            resolve: 0.0,
            error: 0.0,
          };
          pan.pan.setValueAtTime(clamp(k[kind] ?? 0, -0.12, 0.12), t0);
        }

        // Envelope (exponential = premium, no clicks).
        const g0 = 0.0001;
        const peak = clamp(e.gain, 0, 0.12);

        const attack = clamp(e.attackMs, 0, 500) / 1000;
        const release = clamp(e.releaseMs, 0, 1000) / 1000;
        const dur = clamp(e.durMs, 8, 1500) / 1000;

        // Exponential ramps can’t ramp to 0, so we stay above 0.
        const atk = Math.max(0.001, attack);
        const rel = Math.max(0.004, release);
        const d = Math.max(0.008, dur);

        gainEnv.gain.setValueAtTime(g0, t0);
        gainEnv.gain.exponentialRampToValueAtTime(Math.max(g0, peak), t0 + atk);
        gainEnv.gain.exponentialRampToValueAtTime(g0, t0 + atk + d + rel);

        // Connect chain
        osc.connect(filt);
        filt.connect(gainEnv);
        if (pan) {
          gainEnv.connect(pan);
          pan.connect(graph.inGain);
        } else {
          gainEnv.connect(graph.inGain);
        }

        const tEnd = t0 + atk + d + rel + 0.02;

        // Start/stop scheduled at the aligned time
        try {
          osc.start(t0);
          osc.stop(tEnd);
        } catch {
          // ignore
        }

        // Cleanup on end to avoid node buildup in long sessions
        osc.onended = () => {
          try {
            osc.disconnect();
            filt.disconnect();
            gainEnv.disconnect();
            if (pan) pan.disconnect();
          } catch {
            // ignore
          }
        };
      }
    },
    [enabled, ensureCtx, ensureGraph],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      ctxRef.current = null;

      const g = graphRef.current;
      graphRef.current = null;

      if (g) {
        try {
          g.breathOsc.stop();
        } catch {
          // ignore
        }
        try {
          g.breathOsc.disconnect();
          g.breathDepth.disconnect();
          g.inGain.disconnect();
          g.breathGain.disconnect();
          g.comp.disconnect();
        } catch {
          // ignore
        }
      }

      if (!ctx) return;
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported, enabled, unlock, play };
};
