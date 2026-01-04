// src/components/KaiSigil.tsx
// (QR-FREE) KaiSigil — wired with ledger + DHT embed (Atomic Build Upgrade)
// KKS v1.0: ALL RUNTIME LATTICE VALUES ARE DERIVED FROM PULSE ONLY (single source of truth).
// Any caller-provided beat/stepIndex/stepPct are treated as *inputs to validate* (strict) but never as truth.
// stepPct == percentIntoStep ∈ [0,1)  → percent-to-next-step = 1 - stepPct.
// RAH • VEH • YAH • DAH — In the pattern of φ (phi), let every step agree with itself.

"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { canonicalUrlFromContext } from "../utils/sigilUrl";
import {
  PULSE_MS,
  STEPS_BEAT,
  PULSES_STEP,
  latticeFromMicroPulses,
  normalizePercentIntoStep,
} from "../utils/kai_pulse";

import type {
  KaiSigilHandle,
  KaiSigilProps,
  Built,
  SnapshotKey,
  WeekdayName,
} from "./KaiSigil/types";

import {
  CHAKRA_GATES,
  CHAKRAS,
  CENTER,
  PHI,
  SPACE,
  hsl,
  lissajousPath,
  polygonPath,
  normalizeChakraDayKey,
} from "./KaiSigil/constants";

import { deriveFrequencyHzSafe } from "./KaiSigil/freq";

import {
  coerceInt,
  coercePct,
  getStrField,
  isPlainObj,
  safeStringify,
  clean,
} from "./KaiSigil/utils";

import {
  base58CheckEncode,
  bytesToHex,
  mulberry32,
  sha256,
} from "./KaiSigil/crypto";

import { deriveCreatorIdentity } from "./KaiSigil/identity";
import { useKaiData, useMediaPrefs, useSeed } from "./KaiSigil/hooks";
import { useStableSha256 } from "./KaiSigil/valuationBridge";

import ZKGlyph from "./KaiSigil/ZKGlyph";
import { buildEmbeddedBundle, stringifyEmbeddedMeta } from "./KaiSigil/embed";
import { makeExporters } from "./KaiSigil/exporters";

/* valuation imports */
import type { ValueSeal, SigilMetadataLite } from "../utils/valuation";
import { buildValueSeal, computeIntrinsicUnsigned } from "../utils/valuation";

/* modularized subcomponents/helpers */
import Defs from "./KaiSigil/Defs";
import MetadataBlocks from "./KaiSigil/Metadata";
import Art from "./KaiSigil/Art";

import {
  isWeekdayName,
  isRecord,
  qMap,
  hexToBinaryBits,
  makeSummary,
  toSummaryB64, // UTF-8 safe encoder
  fromSummaryB64, // UTF-8 safe decoder
  getSnapshots,
  precomputeLedgerDht,
  makeOuterRingText,
  phaseColorFrom,
} from "./KaiSigil/helpers";

/* ────────────────────────────────────────────────────────────────
   KKS v1.0 — pulse → (beat, stepIndex, percentIntoStep)
   - Uses kai_pulse.ts lattice (single source of truth).
   - We derive from integer pulse by converting to μpulses exactly:
       pμ = pulse * 1_000_000
   - Then feed pμ to latticeFromMicroPulses().
────────────────────────────────────────────────────────────────── */

/**
 * IMPORTANT: We keep validation, but we do NOT hard-crash the app anymore.
 * If a caller passes mismatched beat/stepIndex/stepPct, we emit an error via onError
 * and console.error (DEV), but we still render using pulse-derived canon.
 *
 * This preserves determinism (pulse is truth) while avoiding UX-breaking runtime throws.
 */
const THROW_ON_KKS_INVARIANT = false;

type KksV1 = Readonly<{
  beat: number; // 0..35
  stepIndex: number; // 0..43
  stepPct: number; // percentIntoStep ∈ [0,1)
  stepPctToNext: number; // ∈ (0,1]  (1 at step start, ~0 near boundary)
  stepsPerBeat: number; // 44
  pulsesPerStep: number; // 11
}>;

function deriveKksV1FromPulse(pulse: number): KksV1 {
  const p = Number.isFinite(pulse) ? Math.trunc(pulse) : 0;

  // Exact μpulses at the pulse boundary for pulse p:
  // (NOTE: keep this in sync with kai_pulse.ts ONE_PULSE_MICRO = 1_000_000n)
  const pμ = BigInt(p) * 1_000_000n;

  const { beat, stepIndex, percentIntoStep } = latticeFromMicroPulses(pμ);

  // Clamp to [0,1) open top for stable trig & determinism.
  const stepPct = normalizePercentIntoStep(percentIntoStep);
  const stepPctToNext = 1 - stepPct;

  return {
    beat,
    stepIndex,
    stepPct,
    stepPctToNext,
    stepsPerBeat: STEPS_BEAT,
    pulsesPerStep: PULSES_STEP,
  };
}

type ZkDisplayState = {
  verified: boolean;
  scheme: string;
  poseidonHash: string;
  proofPresent: boolean;
};

function isZkProofLike(proof: unknown): boolean {
  if (!isRecord(proof)) return false;
  const piA = proof["pi_a"];
  const piB = proof["pi_b"];
  const piC = proof["pi_c"];
  return (
    Array.isArray(piA) &&
    Array.isArray(piB) &&
    Array.isArray(piC) &&
    piA.length >= 2 &&
    piB.length >= 2 &&
    piC.length >= 2
  );
}

/**
 * KaiSigil
 * - Deterministic KKS v1.0: beat/stepIndex/stepPct derived ONLY from pulse.
 * - Props beat/stepIndex/stepPct are accepted for backward compatibility but are validation-only.
 */
const KaiSigil = forwardRef<KaiSigilHandle, KaiSigilProps>((props, ref) => {
  const {
    id: htmlId,
    pulse: pulseProp,

    // accepted for backward compatibility, but NOT used as truth
    beat: beatProp,
    stepIndex: stepIndexProp,
    stepPct: stepPctProp,

    chakraDay,
    size = 240,
    hashOverride,
    strict = true,
    quality = "high",
    animate = true,
    debugOutline = false,
    goldenId,
    hashMode = "moment",
    userPhiKey: propPhiKey,
    kaiSignature: propSignature,
    intentionSigil,
    creatorPublicKey,
    origin,
    canonicalShareUrl,
    canonicalPayloadHash,
    onReady,
    onError,
    showZKBadge = true,
    qrHref,
    klock,
    embed,
  } = props;

  // Pulse is the ONLY runtime source of truth.
  const pulse = coerceInt(pulseProp);
  const pulseDisplay = pulse;

  // Deterministic lattice from pulse only.
  const kks = useMemo(() => deriveKksV1FromPulse(pulse), [pulse]);

  // ✅ Display beat is ALWAYS pulse-derived.
  const beatDisplay = kks.beat;

  // Chakra/day visuals (still supplied via prop; step lattice is independent).
  const chakraDayKey = normalizeChakraDayKey(chakraDay);
  const weekdayResolved: WeekdayName | undefined = isWeekdayName(chakraDay)
    ? chakraDay
    : undefined;

  /* Strict validation: if caller provides beat/stepIndex/stepPct, they MUST match pulse-derived values. */
  useEffect(() => {
    if (!strict) return;

    const problems: string[] = [];

    if (beatProp != null) {
      const callerBeat = coerceInt(beatProp);
      if (callerBeat !== kks.beat) {
        problems.push(`beatProp(${callerBeat}) != pulseBeat(${kks.beat})`);
      }
    }

    if (stepIndexProp != null) {
      const callerStep = coerceInt(stepIndexProp);
      if (callerStep !== kks.stepIndex) {
        problems.push(`stepIndexProp(${callerStep}) != pulseStepIndex(${kks.stepIndex})`);
      }
    }

    if (stepPctProp != null) {
      const callerPct = normalizePercentIntoStep(coercePct(stepPctProp, Number.NaN));
      const d = Math.abs(callerPct - kks.stepPct);
      if (!Number.isFinite(callerPct) || d > 1e-9) {
        problems.push(`stepPctProp(${String(stepPctProp)}) != pulseStepPct(${kks.stepPct})`);
      }
    }

    if (problems.length) {
      const err = new Error(
        `[KaiSigil] KKS v1.0 determinism invariant violation → ${problems.join("; ")}`
      );

      // Report, but do not break UX by default.
      onError?.(err);
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.error(err);
      }

      if (THROW_ON_KKS_INVARIANT) {
        throw err;
      }
    }
  }, [
    strict,
    beatProp,
    stepIndexProp,
    stepPctProp,
    kks.beat,
    kks.stepIndex,
    kks.stepPct,
    onError,
  ]);

  // Canonical render state (used for DOM attrs, metadata, exports).
  // ✅ Everything here is pulse-derived (beat/stepIndex/stepPct).
  const canon = useMemo(
    () => ({
      pulse,
      beat: kks.beat,
      stepIndex: kks.stepIndex,
      stepsPerBeat: kks.stepsPerBeat,
      chakraDayKey,
      // stepPct is percentIntoStep; used for visuals only.
      visualClamped: kks.stepPct,
      // optionally useful for UI/debugging
      stepPctToNext: kks.stepPctToNext,
    }),
    [
      pulse,
      kks.beat,
      kks.stepIndex,
      kks.stepsPerBeat,
      chakraDayKey,
      kks.stepPct,
      kks.stepPctToNext,
    ]
  );

  const { prefersReduce, prefersContrast } = useMediaPrefs();
  const { kaiData, kaiDataRef } = useKaiData(hashMode);

  /* Seeds & visuals */
  const seedKey = `${canon.pulse}|${canon.beat}|${canon.stepIndex}|${canon.chakraDayKey}`;
  const seed = useSeed(seedKey);
  const rnd = useMemo(() => mulberry32(seed), [seed]);

  const { sides, hue } = CHAKRAS[chakraDayKey];

  const a = (canon.pulse % 7) + 1;
  const b = (canon.beat % 5) + 2;
  const delta = canon.visualClamped * 2 * Math.PI;

  const rotation = (PHI ** 2 * Math.PI * (canon.pulse % 97)) % (2 * Math.PI);
  const light = 50 + 15 * Math.sin(canon.visualClamped * 2 * Math.PI);
  const baseColor = hsl((hue + 360 * 0.03 * canon.visualClamped) % 360, 100, light);

  const chakraGate = CHAKRA_GATES[chakraDayKey];

  const frequencyHzCurrent = useMemo(
    () => deriveFrequencyHzSafe(chakraDayKey, canon.stepIndex),
    [chakraDayKey, canon.stepIndex]
  );

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1;
  const doAnim = animate && !prefersReduce;

  const resolvedGoldenId = goldenId ? `${goldenId}-${canon.stepIndex}` : undefined;
  const uid = resolvedGoldenId ?? `ks-${canon.pulse}-${canon.beat}-${canon.stepIndex}`;

  const pad = Math.max(10, Math.floor((size ?? 240) * 0.08));
  const safeTextWidth = Math.max(40, (size ?? 240) - pad * 2);
  const outlineWidth = Math.max(0.6, (size ?? 240) * 0.003);
  const strokeCore = Math.max(1.4, (size ?? 240) * 0.009);
  const dotR = Math.max(2.5, (size ?? 240) * 0.016);

  const durMs = 5000 + Math.floor(rnd() * 800) + Math.floor((seed % 436) / 2);
  const offMs = Math.floor((seed >>> 1) % durMs);

  const corePath = useMemo(() => polygonPath(sides, rotation), [sides, rotation]);
  const auraPath = useMemo(() => lissajousPath(a, b, delta), [a, b, delta]);

  /* identity fallbacks */
  const [autoSig, setAutoSig] = useState<string>();
  const [autoPhi, setAutoPhi] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let sigLocal = propSignature;

      if (!sigLocal) {
        const base = `${canon.pulse}|${canon.beat}|${canon.stepIndex}|${chakraDayKey}|${intentionSigil ?? ""}`;
        sigLocal = bytesToHex(await sha256(base));
        if (!cancelled) setAutoSig(sigLocal);
      }

      let phiLocal = propPhiKey;
      if (!phiLocal && sigLocal) {
        const hashBytes = await sha256(`${sigLocal}φ`);
        phiLocal = await base58CheckEncode(hashBytes.slice(0, 20));
        if (!cancelled) setAutoPhi(phiLocal);
      }
    })().catch(onError);

    return () => {
      cancelled = true;
    };
  }, [
    propSignature,
    propPhiKey,
    canon.pulse,
    canon.beat,
    canon.stepIndex,
    chakraDayKey,
    intentionSigil,
    onError,
  ]);

  const kaiSignature = propSignature ?? autoSig;
  const userPhiKey = propPhiKey ?? autoPhi;

  /* valuation */
  const hasher = useStableSha256();
  const [liveValuePhi, setLiveValuePhi] = useState<number | null>(null);
  const [mintSeal, setMintSeal] = useState<ValueSeal | null>(null);
  const valuationMetaRef = useRef<SigilMetadataLite | null>(null);

  useEffect(() => {
    valuationMetaRef.current = {
      pulse: canon.pulse,
      kaiPulse: canon.pulse,
      kaiSignature: kaiSignature ?? undefined,
      userPhiKey: userPhiKey ?? undefined,
      beat: canon.beat,
      stepIndex: canon.stepIndex,
      stepsPerBeat: canon.stepsPerBeat,
      quality: qMap(quality),
      frequencyHz: frequencyHzCurrent,
      chakraDay: canon.chakraDayKey,
      chakraGate,
    };
  }, [
    canon.beat,
    canon.stepIndex,
    canon.stepsPerBeat,
    kaiSignature,
    userPhiKey,
    quality,
    frequencyHzCurrent,
    canon.chakraDayKey,
    chakraGate,
    canon.pulse,
  ]);

  const stateKey: SnapshotKey = useMemo(
    () => `${canon.pulse}|${canon.beat}|${canon.stepIndex}|${canon.chakraDayKey}`,
    [canon.pulse, canon.beat, canon.stepIndex, canon.chakraDayKey]
  );

  const [built, setBuilt] = useState<Built | null>(null);

  /**
   * Atomic Build:
   * - snapshot this render’s exact inputs and build once.
   * - exported metadata uses the SAME (pulse-derived) beat/stepIndex the DOM uses.
   */
  useEffect(() => {
    let cancelled = false;

    // Snapshot for coherent export.
    const pulse0 = canon.pulse;
    const beat0 = canon.beat;
    const step0 = canon.stepIndex;
    const day0 = canon.chakraDayKey;
    const stepsPerBeat0 = canon.stepsPerBeat;
    const freq0 = frequencyHzCurrent;
    const state0 = stateKey;
    const weekday0: WeekdayName | null = isWeekdayName(chakraDay) ? chakraDay : null;

    void (async () => {
      try {
        const creatorMeta = await deriveCreatorIdentity({
          creatorPublicKey,
          userPhiKey,
          kaiSignature,
          origin,
          pulse: pulse0,
          beat: beat0,
          chakraDay: day0,
          stepIndex: step0,
        });

        const kd = kaiDataRef.current;
        const title =
          clean(getStrField(kd, "kaiMomentSummary")) ??
          clean(getStrField(kd, "kairos_seal")) ??
          clean(getStrField(kd, "kairos_seal_day_month_percent")) ??
          `Kairos HarmoniK Sigil • ${day0} • Beat ${beat0} • Step ${step0}`;

        const valuationSource: SigilMetadataLite = {
          pulse: pulse0,
          kaiPulse: pulse0,
          kaiSignature: kaiSignature ?? undefined,
          userPhiKey: userPhiKey ?? undefined,

          // ✅ deterministic render snapshot
          beat: beat0,
          stepIndex: step0,
          stepsPerBeat: stepsPerBeat0,

          quality: quality === "low" ? "low" : "high",
          frequencyHz: freq0,
          chakraDay: day0,
          chakraGate,
        };

        // Build the seal atomically so embed/export sees the same value used for attrs.
        let sealLocal: ValueSeal | null = null;
        try {
          const { seal } = await buildValueSeal(valuationSource, pulse0, hasher);
          sealLocal = seal;
          if (!cancelled) setMintSeal(seal);
        } catch (e) {
          onError?.(e);
        }

        const rawBundle: unknown = await buildEmbeddedBundle({
          canon: {
            pulse: pulse0,
            beat: beat0,
            stepIndex: step0, // ← SAME pulse-derived step as DOM
            chakraDayKey: day0,
            stepsPerBeat: stepsPerBeat0,
          },
          hashMode,
          chakraGate,
          kaiSignature,
          userPhiKey,
          intentionSigil,
          origin,
          title,
          klockSnapshot: isPlainObj(klock)
            ? (JSON.parse(safeStringify(klock)) as Record<string, unknown>)
            : null,
          kaiApiSnapshot: isPlainObj(kaiData)
            ? (JSON.parse(safeStringify(kaiData)) as Record<string, unknown>)
            : null,
          weekdayResolved: weekday0,
          valuationSource,
          mintSeal: null, // keep bundle base clean; we add seal outside
          frequencyHzCurrent: freq0,
          qrHref,
          canonicalUrlFromContext,
          creatorResolved: creatorMeta,
        });

        // Narrow bundle safely
        let embeddedBase: Record<string, unknown> = {};
        let payloadHashHex = "";
        let parityUrl = "";
        let innerRingText = "";
        let sigilUrl = "";
        let hashB58 = "";
        let zkPoseidonHash = "";
        let zkPoseidonSecret = "";

        if (isRecord(rawBundle)) {
          const eb = rawBundle["embeddedBase"];
          if (isRecord(eb)) embeddedBase = eb;

          const ph = rawBundle["payloadHashHex"];
          if (typeof ph === "string") payloadHashHex = ph;

          const pu = rawBundle["parityUrl"];
          if (typeof pu === "string") parityUrl = pu;

          const ir = rawBundle["innerRingText"];
          if (typeof ir === "string") innerRingText = ir;

          const su = rawBundle["sigilUrl"];
          if (typeof su === "string") sigilUrl = su;

          const hb = rawBundle["hashB58"];
          if (typeof hb === "string") hashB58 = hb;

          const zph = rawBundle["zkPoseidonHash"];
          if (typeof zph === "string") zkPoseidonHash = zph;

          const zps = rawBundle["zkPoseidonSecret"];
          if (typeof zps === "string") zkPoseidonSecret = zps;
        }

        const headerValuationRuntime = {
          PULSE_MS,
          STEPS_BEAT: stepsPerBeat0,
          PHI,
          algorithm: "computeIntrinsicUnsigned" as const,
          version: "1",
        };

        const valuationLiveAtExport = computeIntrinsicUnsigned(valuationSource, pulse0).unsigned
          .valuePhi;

        const embedded = {
          ...embeddedBase,
          valuation: sealLocal,
          valuationSource,
          valuationRuntime: headerValuationRuntime,
          valuationLiveAtExport,
        };

        const embeddedMetaJson = stringifyEmbeddedMeta(embedded);

        const next: Built = {
          createdFor: {
            pulse: pulse0,
            beat: beat0,
            stepIndex: step0, // ← SAME pulse-derived step as DOM
            chakraDayKey: day0,
            stateKey: state0,
          },
          payloadHashHex,
          shareUrl: parityUrl,
          embeddedMetaJson,
          valuationSourceJson: JSON.stringify(valuationSource),
          zkScheme: "groth16-poseidon",
          zkPoseidonHash,
          zkPoseidonSecret,
          innerRingText,
          sigilUrl,
          hashB58,
          frequencyHz: freq0,
        };

        if (!cancelled && next.createdFor.stateKey === state0) {
          setBuilt(next);
          onReady?.({
            hash: next.payloadHashHex,
            url: next.shareUrl,
            metadataJson: next.embeddedMetaJson,
            zkPoseidonSecret: next.zkPoseidonSecret,
          });
        }
      } catch (e) {
        onError?.(e);
        if (strict && THROW_ON_KKS_INVARIANT) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
    })().catch((e) => {
      onError?.(e);
      if (strict && THROW_ON_KKS_INVARIANT) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    canon.pulse,
    canon.beat,
    canon.stepIndex,
    canon.chakraDayKey,
    canon.stepsPerBeat,
    frequencyHzCurrent,
    stateKey,
    chakraDay,
    chakraGate,
    creatorPublicKey,
    hashMode,
    hasher,
    intentionSigil,
    kaiData,
    kaiDataRef,
    kaiSignature,
    klock,
    onError,
    onReady,
    origin,
    qrHref,
    strict,
    userPhiKey,
    quality,
  ]);

  /* Prefer the built snapshot for display (DOM/summary), otherwise use pulse-derived kks. */
  const displayStepIndex = useMemo(() => {
    const b = built;
    if (b && b.createdFor.stateKey === stateKey) return b.createdFor.stepIndex;
    return kks.stepIndex;
  }, [built, stateKey, kks.stepIndex]);

  const displayFrequencyHz = useMemo(() => {
    const b = built;
    return b && b.createdFor.stateKey === stateKey ? b.frequencyHz : frequencyHzCurrent;
  }, [built, stateKey, frequencyHzCurrent]);

  /* LIVE value each pulse */
  useEffect(() => {
    try {
      if (!valuationMetaRef.current || !Number.isFinite(canon.pulse)) {
        setLiveValuePhi(null);
        return;
      }
      const { unsigned } = computeIntrinsicUnsigned(valuationMetaRef.current, canon.pulse);
      setLiveValuePhi(unsigned.valuePhi);
    } catch (e) {
      onError?.(e);
      setLiveValuePhi(null);
    }
  }, [canon.pulse, onError]);

  /* summary + snapshots
     - summaryDisplay (visible): reflects displayStepIndex
     - summaryForAttrs (data-*): uses built step when available to avoid race
  */
  const eternalSeal =
    getStrField(klock, "eternalSeal") ??
    getStrField(klock, "seal") ??
    getStrField(kaiData, "kairos_seal");

  const summaryDisplay = useMemo(
    () => makeSummary(eternalSeal, beatDisplay, displayStepIndex, pulseDisplay),
    [eternalSeal, beatDisplay, displayStepIndex, pulseDisplay]
  );

  const summaryForAttrs = useMemo(() => {
    const stepForAttrs =
      built && built.createdFor.stateKey === stateKey ? built.createdFor.stepIndex : displayStepIndex;
    return makeSummary(eternalSeal, beatDisplay, stepForAttrs, pulseDisplay);
  }, [built, stateKey, eternalSeal, beatDisplay, displayStepIndex, pulseDisplay]);

  const summaryB64 = useMemo(() => toSummaryB64(summaryForAttrs), [summaryForAttrs]);

  const {
    klockIsoSnapshot,
    apiSnapshot,
    klockDataAttrs,
    eternalMonth,
    harmonicDay,
    kaiPulseEternal,
    solarChakraStepString,
    chakraArc,
  } = useMemo(() => getSnapshots(klock, kaiData), [klock, kaiData]);

  /* Optional full-SVG hash check */
  const svgRef = useRef<SVGSVGElement>(null!);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el || !hashOverride) return;

    let cancelled = false;

    void (async () => {
      try {
        const clone = el.cloneNode(true) as SVGSVGElement;
        clone.removeAttribute("data-svg-hash");
        clone.removeAttribute("data-svg-valid");
        const xml = new XMLSerializer().serializeToString(clone);
        const calc = bytesToHex(await sha256(xml));
        if (cancelled) return;

        el.dataset.svgHash = calc;
        el.dataset.svgValid = String(calc === hashOverride.toLowerCase());

        if (calc !== hashOverride.toLowerCase() && strict && THROW_ON_KKS_INVARIANT) {
          throw new Error(`[KaiSigil] SVG HASH MISMATCH (${calc})`);
        }
      } catch (e) {
        onError?.(e);
        if (strict && THROW_ON_KKS_INVARIANT) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
    })().catch((e) => {
      onError?.(e);
      if (strict && THROW_ON_KKS_INVARIANT) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hashOverride, strict, stateKey, onError]);

  /* Post-render invariants — ensure DOM and built snapshot agree. */
  useLayoutEffect(() => {
    if (!strict) return;
    const el = svgRef.current;
    if (!el) return;

    const b = built;
    if (!b || b.createdFor.stateKey !== stateKey) return;

    const stepAttrStr = el.getAttribute("data-step-index");
    const freqAttrStr = el.getAttribute("data-frequency-hz");
    const sumB64Attr = el.getAttribute("data-summary-b64") ?? "";

    const stepAttr = stepAttrStr != null && stepAttrStr !== "" ? Number(stepAttrStr) : Number.NaN;
    const freqAttr = freqAttrStr != null && freqAttrStr !== "" ? Number(freqAttrStr) : Number.NaN;
    const shareAttr = el.getAttribute("data-share-url") || undefined;
    const sigAttr = el.getAttribute("data-payload-hash") || undefined;

    // Decode the summary (UTF-8 safe) and compare against the attribute-target summary.
    let decoded = "";
    try {
      decoded = fromSummaryB64(sumB64Attr);
    } catch {
      decoded = "";
    }

    const expectedSummary = summaryForAttrs;

    // Be tolerant of any legacy cached bad encodes (bullet variants)
    const normalize = (s: string) => s.replace(/â¢|·|\u2022/g, "•");

    const problems: string[] = [];

    if (normalize(decoded) !== normalize(expectedSummary)) {
      problems.push(`summary mismatch (“${decoded}” != “${expectedSummary}”)`);
    }

    if (!Number.isFinite(stepAttr)) {
      problems.push("missing/invalid data-step-index");
    } else if (stepAttr !== b.createdFor.stepIndex) {
      problems.push(`data-step-index(${stepAttr}) != built(${b.createdFor.stepIndex})`);
    }

    if (!Number.isFinite(freqAttr)) {
      problems.push("missing/invalid data-frequency-hz");
    } else {
      const freqFromStep = deriveFrequencyHzSafe(chakraDayKey, stepAttr);
      if (Math.abs(freqAttr - b.frequencyHz) > 1e-6 || Math.abs(freqFromStep - freqAttr) > 1e-6) {
        problems.push(`frequency/step mismatch (${freqAttr} vs step ${stepAttr})`);
      }
    }

    const expectedShare =
      typeof canonicalShareUrl === "string" && canonicalShareUrl.trim().length > 0
        ? canonicalShareUrl.trim()
        : b.shareUrl;
    const expectedHash =
      typeof canonicalPayloadHash === "string" && canonicalPayloadHash.trim().length > 0
        ? canonicalPayloadHash.trim()
        : b.payloadHashHex;

    if (shareAttr !== expectedShare) problems.push("data-share-url != expected shareUrl");
    if (sigAttr && sigAttr !== expectedHash) problems.push("data-payload-hash != expected payload hash");

    if (problems.length) {
      const err = new Error(`[KaiSigil] Invariant violation → ${problems.join("; ")}`);
      onError?.(err);
      if (THROW_ON_KKS_INVARIANT) throw err;
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }, [
    strict,
    built,
    stateKey,
    chakraDayKey,
    summaryForAttrs,
    canonicalShareUrl,
    canonicalPayloadHash,
    onError,
  ]);

  const { toDataURL, exportBlob, verifySvgHash } = makeExporters(svgRef, size);

  const extraEmbed = useMemo(
    () => (isPlainObj(embed) ? (JSON.parse(safeStringify(embed)) as Record<string, unknown>) : null),
    [embed]
  );

  const stateKeyOk = Boolean(built?.createdFor.stateKey === stateKey);

  const payloadHashHex = stateKeyOk ? built?.payloadHashHex : undefined;
  const zkScheme = stateKeyOk ? built?.zkScheme : undefined;
  const zkPoseidonHash = stateKeyOk ? built?.zkPoseidonHash : undefined;
  const shareUrl = stateKeyOk ? built?.shareUrl : undefined;

  const canonicalShareUrlClean =
    typeof canonicalShareUrl === "string" && canonicalShareUrl.trim().length > 0
      ? canonicalShareUrl.trim()
      : undefined;

  const canonicalPayloadHashClean =
    typeof canonicalPayloadHash === "string" && canonicalPayloadHash.trim().length > 0
      ? canonicalPayloadHash.trim()
      : undefined;

  const shareUrlForRender = canonicalShareUrlClean ?? shareUrl;
  const payloadHashForRender = canonicalPayloadHashClean ?? payloadHashHex;
const frequencyHz = displayFrequencyHz;
  const binaryForRender = useMemo(() => {
    if (!kaiSignature) return "";

    const bin = hexToBinaryBits(kaiSignature);
    const circumference = 2 * Math.PI * ((size ?? 240) * 0.46);
    const approxCharWidth = Math.max(3.5, (size ?? 240) * 0.028 * 0.55);
    const maxChars = Math.max(24, Math.floor(circumference / approxCharWidth));

    return bin.length > maxChars ? bin.slice(0, maxChars) : bin;
  }, [kaiSignature, size]);

  const phaseColor = phaseColorFrom(hue, canon.visualClamped, payloadHashForRender);

  const sigPathId = kaiSignature ? `${uid}-sig-path` : undefined;
  const descId = `${uid}-desc`;

  const absoluteShareUrl = shareUrlForRender;

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    absoluteShareUrl ? (
      <a
        href={absoluteShareUrl}
        target="_self"
        aria-label={`Open canonical sigil ${payloadHashForRender ?? ""}`}
      >
        {children}
      </a>
    ) : (
      <g tabIndex={0} role="button" aria-label="Sigil not yet canonicalized">
        {children}
      </g>
    );

  const outerRingText = makeOuterRingText(
    payloadHashForRender,
    stateKeyOk,
    chakraDayKey,
    frequencyHz,
    pulseDisplay,
    beatDisplay,
    displayStepIndex,
    zkPoseidonHash
  );

  const embeddedMetaJson = useMemo(() => {
    const raw = stateKeyOk ? built?.embeddedMetaJson : undefined;
    if (!raw || !shareUrlForRender) return raw;

    const isObj = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v);

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isObj(parsed)) return raw;

      const next = { ...parsed } as Record<string, unknown>;

      const header = next["header"];
      if (isObj(header)) {
        next["header"] = { ...header, shareUrl: shareUrlForRender };
      }

      next["shareUrl"] = shareUrlForRender;

      const proof = next["proof"];
      if (isObj(proof)) {
        next["proof"] = { ...proof, shareUrl: shareUrlForRender };
      }

      return JSON.stringify(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[KaiSigil] Failed to patch embedded metadata shareUrl", err);
      return raw;
    }
  }, [built, stateKeyOk, shareUrlForRender]);

  const { ledgerJson, dhtJson } = useMemo(
    () => precomputeLedgerDht(stateKeyOk ? built?.embeddedMetaJson : undefined),
    [built, stateKeyOk]
  );

  const zkDisplay = useMemo<ZkDisplayState>(() => {
    const baseScheme = zkScheme ?? "groth16-poseidon";
    const basePoseidon = zkPoseidonHash ?? "";
    const base: ZkDisplayState = {
      verified: false,
      scheme: baseScheme,
      poseidonHash: basePoseidon,
      proofPresent: false,
    };
    if (!stateKeyOk || !embeddedMetaJson) return base;
    try {
      const parsed = JSON.parse(embeddedMetaJson) as Record<string, unknown>;
      const proofHints = isRecord(parsed.proofHints) ? parsed.proofHints : null;
      const scheme =
        (proofHints && typeof proofHints.scheme === "string" && proofHints.scheme) || baseScheme;
      const poseidonHash =
        typeof parsed.zkPoseidonHash === "string" ? parsed.zkPoseidonHash : basePoseidon;

      let zkPublicInputs: string[] = [];
      if (Array.isArray(parsed.zkPublicInputs)) {
        zkPublicInputs = parsed.zkPublicInputs.map((entry) => String(entry));
      } else if (typeof parsed.zkPublicInputs === "string") {
        try {
          const parsedInputs = JSON.parse(parsed.zkPublicInputs) as unknown;
          if (Array.isArray(parsedInputs)) {
            zkPublicInputs = parsedInputs.map((entry) => String(entry));
          } else {
            zkPublicInputs = [parsed.zkPublicInputs];
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.debug("[KaiSigil] Failed to parse zkPublicInputs string", err);
          zkPublicInputs = [parsed.zkPublicInputs];
        }
      }

      const proofPresent = isZkProofLike(parsed.zkProof);
      const hasPoseidon = !!poseidonHash && poseidonHash !== "0x";
      const inputsMatch = zkPublicInputs.length > 0 && zkPublicInputs[0] === poseidonHash;
      const schemeOk = /groth16/i.test(scheme);

      return {
        verified: proofPresent && hasPoseidon && inputsMatch && schemeOk,
        scheme,
        poseidonHash,
        proofPresent,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[KaiSigil] Failed to parse ZK metadata", err);
      return base;
    }
  }, [embeddedMetaJson, stateKeyOk, zkPoseidonHash, zkScheme]);

  /* Imperative API */
  useImperativeHandle(
    ref,
    () => ({
      toDataURL,
      exportBlob,
      verifySvgHash,
      verifyConsistency: () => {
        const b = built;
        if (!b) throw new Error("No built snapshot yet");
        if (b.createdFor.stateKey !== stateKey) {
          throw new Error("Built snapshot does not match current stateKey");
        }
      },
      uid,
      stepIndex: canon.stepIndex, // ✅ pulse-derived
      payloadHashHex: payloadHashForRender,
      sigilUrl: shareUrlForRender,
      userPhiKey,
      kaiSignature,
    }),
    [
      toDataURL,
      exportBlob,
      verifySvgHash,
      built,
      stateKey,
      uid,
      canon.stepIndex,
      userPhiKey,
      kaiSignature,
      payloadHashForRender,
      shareUrlForRender,
    ]
  );

  return (
    <svg
      ref={svgRef}
      id={htmlId ?? uid}
      role="img"
      aria-describedby={descId}
      lang="en"
      aria-label={`Kairos sigil — pulse ${canon.pulse}`}
      viewBox={`0 0 ${SPACE} ${SPACE}`}
      width={size}
      height={size}
      shapeRendering="geometricPrecision"
      style={
        {
          background: "transparent",
          "--dur": `${durMs}ms`,
          "--off": `${offMs}ms`,
          "--pulse": `${PULSE_MS}ms`,
          cursor: shareUrlForRender ? "pointer" : "default",
        } as React.CSSProperties
      }
      data-pulse={String(pulseDisplay)}
      data-beat={String(beatDisplay)}
      data-step-index={String(displayStepIndex)}
      data-step-pct={String(canon.visualClamped)} // percentIntoStep (0..1)
      data-step-pct-to-next={String(canon.stepPctToNext)} // (1 - percentIntoStep)
      data-frequency-hz={String(frequencyHz)}
      data-chakra-day={chakraDayKey}
      data-weekday={weekdayResolved ?? undefined}
      data-chakra-gate={chakraGate}
      data-quality={quality}
      data-golden-id={goldenId ?? undefined}
      data-kai-signature={kaiSignature ?? undefined}
      data-phi-key={userPhiKey ?? undefined}
      data-payload-hash={payloadHashForRender ?? undefined}
      data-zk-scheme={zkScheme ?? undefined}
      data-zk-poseidon-hash={zkPoseidonHash ?? undefined}
      data-share-url={shareUrlForRender || undefined}
      data-eternal-seal={eternalSeal ?? undefined}
      data-eternal-month={eternalMonth ?? undefined}
      data-harmonic-day={harmonicDay ?? undefined}
      data-kai-pulse-eternal={typeof kaiPulseEternal === "number" ? String(kaiPulseEternal) : undefined}
      data-solar-chakra-step={solarChakraStepString ?? undefined}
      data-arc={chakraArc ?? undefined}
      data-summary-b64={summaryB64}
      {...klockDataAttrs}
      data-value-phi-live={liveValuePhi != null ? String(liveValuePhi) : undefined}
    >
      <title>{`Kairos HarmoniK Sigil • Pulse ${canon.pulse}`}</title>
      <desc id={descId}>↳ {summaryDisplay}</desc>

      <MetadataBlocks
        uid={uid}
        stateKeyOk={stateKeyOk}
        embeddedMetaJson={embeddedMetaJson}
        klockIsoSnapshot={klockIsoSnapshot}
        apiSnapshot={apiSnapshot}
        extraEmbed={extraEmbed}
        mintSealJson={mintSeal ? JSON.stringify(mintSeal) : null}
        valuationSourceJson={stateKeyOk ? built?.valuationSourceJson : undefined}
        displayStepIndex={displayStepIndex}
        stepsPerBeat={canon.stepsPerBeat}
        eternalSeal={eternalSeal ?? undefined}
        ledgerJson={ledgerJson}
        dhtJson={dhtJson}
      />

      <Defs
        uid={uid}
        hue={hue}
        visualClamped={canon.visualClamped}
        doAnim={doAnim}
        quality={quality}
        dpr={dpr}
        seed={seed}
        payloadHashHex={payloadHashForRender}
        auraPath={auraPath}
      />

      {kaiSignature && (
        <defs>
          <path
            id={sigPathId}
            d={`M ${CENTER} ${CENTER - SPACE * 0.46}
                a ${SPACE * 0.46} ${SPACE * 0.46} 0 1 1 0 ${SPACE * 0.92}
                a ${SPACE * 0.46} ${SPACE * 0.46} 0 1 1 0 -${SPACE * 0.92}`}
            fill="none"
          />
        </defs>
      )}

      <Wrapper>
        <g id={`${uid}-tilt`} style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}>
          {doAnim && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              values={`-2 ${CENTER} ${CENTER};2 ${CENTER} ${CENTER};-2 ${CENTER} ${CENTER}`}
              dur={`var(--dur)`}
              begin={`var(--off)`}
              repeatCount="indefinite"
            />
          )}

          <Art
            uid={uid}
            size={size}
            baseColor={baseColor}
            corePath={corePath}
            auraId={`${uid}-aura`}
            sigPathId={sigPathId}
            doAnim={doAnim}
            quality={quality}
            dpr={dpr}
            pad={pad}
            safeTextWidth={safeTextWidth}
            outlineWidth={prefersContrast ? outlineWidth * 1.2 : outlineWidth}
            strokeCore={strokeCore}
            dotR={dotR}
            debugOutline={debugOutline}
            prefersContrast={prefersContrast}
            haloId={`${uid}-halo`}
            netId={`${uid}-net`}
            warpId={`${uid}-warp`}
            glowId={`${uid}-glow`}
            maskId={`${uid}-mask`}
            rotation={rotation}
            chakraSides={CHAKRAS[chakraDayKey].sides}
            binaryForRender={binaryForRender}
            summary={summaryDisplay}
            pulse={pulseDisplay}
          />
        </g>
      </Wrapper>

      {showZKBadge && (
        <ZKGlyph
          uid={uid}
          size={size}
          phaseColor={phaseColor}
          outerRingText={outerRingText}
          innerRingText={stateKeyOk ? built?.innerRingText ?? "initializing…" : "initializing…"}
          verified={zkDisplay.verified}
          zkScheme={zkDisplay.scheme}
          zkPoseidonHash={zkDisplay.poseidonHash}
          proofPresent={zkDisplay.proofPresent}
          animate={animate}
          prefersReduce={prefersReduce}
        />
      )}
    </svg>
  );
});

KaiSigil.displayName = "KaiSigil";
export default KaiSigil;

// Re-export types so callers can `import { KaiSigilHandle, KaiSigilProps } from "./KaiSigil"`
export type { KaiSigilHandle, KaiSigilProps, Built, SnapshotKey, WeekdayName } from "./KaiSigil/types";
