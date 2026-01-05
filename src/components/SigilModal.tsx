/* ────────────────────────────────────────────────────────────────
   SigilModal.tsx · Atlantean Lumitech “Kairos Sigil Viewer”
   v23.5 — v22.9 UI + FULL PULSE-ONLY DETERMINISM (BIGINT LAW)
   • Fix: ALWAYS opens in LIVE
   • Fix: LIVE uses calibrated μpulses-since-genesis (never boots at 0)
   • Fix: countdown & scheduler use same calibrated source (ticks + advances)
   • Fix: KaiSigil KKS invariant crash (Sigil stepIndex always matches KaiSigil’s own step math)
   • Fix: bigint never rendered directly (no ReactNode bigint)
   • Fix: large-pulse safe pulse wrapping preserves BOTH:
       (a) μ-lattice invariance period, AND
       (b) base-grid mod (beat+step) invariance used by KaiSigil
────────────────────────────────────────────────────────────────── */

"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ChangeEvent,
  type FC,
} from "react";
import { createPortal } from "react-dom";
import JSZip from "jszip";

/* Moment row (v22.9 UI) */
import SigilMomentRow from "./SigilMomentRow";

import KaiSigil, { type KaiSigilProps, type KaiSigilHandle } from "./KaiSigil";
import { stepIndexFromPulseExact, percentIntoStepFromPulseExact } from "./KaiSigil/step";

import SealMomentModal from "./SealMomentModal";
import {
  extractPayloadFromUrl,
  makeSigilUrl,
  makeSigilUrlLoose,
  type SigilSharePayload,
} from "../utils/sigilUrl";
import "./SigilModal.css";
import { downloadBlob } from "../lib/download";
import { embedProofMetadata } from "../utils/svgProof";
import { extractEmbeddedMetaFromSvg } from "../utils/sigilMetadata";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../utils/zkProof";
import { computeZkPoseidonHash } from "../utils/kai";
import {
  buildBundleUnsigned,
  buildVerifierUrl,
  hashBundle,
  hashProofCapsuleV1,
  hashSvgText,
  normalizeChakraDay,
  PROOF_CANON,
  PROOF_HASH_ALG,
  type ProofCapsuleV1,
} from "./KaiVoh/verifierProof";
import type { AuthorSig } from "../utils/authorSig";
import { ensurePasskey, signBundleHash } from "../utils/webauthnKAS";
import type { SigilProofHints } from "../types/sigil";

/* ✅ SINGLE SOURCE OF TRUTH: src/utils/kai_pulse.ts */
import {
  PULSE_MS,
  STEPS_BEAT,
  BEATS_DAY,
  PULSES_BEAT,
  N_DAY_MICRO,
  BASE_DAY_MICRO,
  DAY_TO_CHAKRA,
  latticeFromMicroPulses,
  normalizePercentIntoStep,
  getKaiTimeSource,
  epochMsFromPulse,
  microPulsesSinceGenesis,
  utcFromBreathSlot,
  buildKaiKlockResponse,
  momentFromPulse,
  type Weekday,
  type ChakraDay,
} from "../utils/kai_pulse";
import { generateKaiTurah } from "../utils/kai_turah";
import {
  getKaiPulseToday,
  getSolarAlignedCounters,
  SOLAR_DAY_NAMES,
} from "../SovereignSolar";

/* ────────────────────────────────────────────────────────────────
   Strict browser timer handle types
────────────────────────────────────────────────────────────────── */
type TimeoutHandle = number; // window.setTimeout(...) -> number (browser)
type IntervalHandle = number; // window.setInterval(...) -> number (browser)

interface Props {
  initialPulse?: number; // legacy/optional (modal still OPENS in LIVE)
  onClose: () => void;
}

/**
 * KaiKlock “response” (local-only).
 * Keep it as an unknown record so we never rely on implicit typing.
 */
type KaiKlock = Readonly<Record<string, unknown>>;

/* ────────────────────────────────────────────────────────────────
   Deterministic helpers (BigInt law)
────────────────────────────────────────────────────────────────── */
const ONE_PULSE_MICRO = 1_000_000n;
const MAX_SAFE_BI = BigInt(Number.MAX_SAFE_INTEGER);
const pad2 = (n: number) => String(n).padStart(2, "0");

/* Safe BigInt → Number clamp (numbers are pixels / UI only) */
const biToSafeNumber = (x: bigint): number => {
  if (x > MAX_SAFE_BI) return Number.MAX_SAFE_INTEGER;
  if (x < -MAX_SAFE_BI) return -Number.MAX_SAFE_INTEGER;
  return Number(x);
};

const absBI = (x: bigint): bigint => (x < 0n ? -x : x);

/** Euclidean modulo for BigInt (always 0..m-1 when m>0). */
const modE = (a: bigint, m: bigint) => {
  if (m === 0n) return 0n;
  const r = a % m;
  return r >= 0n ? r : r + m;
};

/** Euclidean floor division for BigInt (d>0). */
const floorDivE = (a: bigint, d: bigint) => {
  const q = a / d;
  const r = a % d;
  return r === 0n || a >= 0n ? q : q - 1n;
};

const clampPulseNonNeg = (p: bigint) => (p < 0n ? 0n : p);

/** BigInt gcd (non-negative). */
const gcdBI = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
};

/**
 * ✅ SAFE WRAP PERIOD FOR KAI SIGIL (pulse domain)
 *
 * KaiSigil derives stepIndex from integer pulse using:
 *   pulsesIntoBeat = pulse mod PULSES_BEAT
 *   stepIndex      = floor(pulsesIntoBeat / PULSES_STEP)
 *
 * If we wrap pulse for safety, we MUST preserve:
 *   (pulse mod PULSES_BEAT) AND (pulse mod (PULSES_BEAT * BEATS_DAY))
 *
 * At the same time, we want to preserve the μ-lattice invariance period:
 *   (pulse * 1_000_000) mod N_DAY_MICRO repeats every:
 *     basePeriodPulse = N_DAY_MICRO / gcd(N_DAY_MICRO, 1_000_000)
 *
 * So we choose a wrap period that is:
 *   WRAP = basePeriodPulse * BASE_DAY_PULSES
 * where BASE_DAY_PULSES = PULSES_BEAT * BEATS_DAY (17424),
 * ensuring mod BASE_DAY_PULSES and mod PULSES_BEAT are invariant under wrapping.
 */
const BASE_DAY_PULSES_BI = BigInt(PULSES_BEAT * BEATS_DAY);
const SIGIL_WRAP_PULSE: bigint = (() => {
  const g = gcdBI(N_DAY_MICRO, ONE_PULSE_MICRO);
  const basePeriodPulse = g === 0n ? 0n : N_DAY_MICRO / g; // pulses
  return basePeriodPulse === 0n ? 0n : basePeriodPulse * BASE_DAY_PULSES_BI;
})();

const fmtSealKairos = (beat: number, stepIdx: number) => `${beat}:${pad2(stepIdx)}`;

const fmtPulseDisplay = (pulseExact: bigint) => {
  try {
    return pulseExact.toLocaleString();
  } catch {
    return pulseExact.toString();
  }
};

type SolarSealContext = {
  weekday: string;
  dayOfMonth: number;
  monthIndex: number;
};

const getSolarSealContext = (pulseValue: bigint): SolarSealContext | null => {
  try {
    const msAtPulse = epochMsFromPulse(pulseValue);
    const when = new Date(biToSafeNumber(msAtPulse));
    const counters = getSolarAlignedCounters(when);
    const fallbackWeekday =
      SOLAR_DAY_NAMES[((counters.solarAlignedWeekDayIndex ?? 0) + 6) % 6];
    const weekday = counters.dayName ?? fallbackWeekday;
    const dayOfMonth =
      counters.solarAlignedDayInMonth1 ?? (counters.solarAlignedDayInMonth + 1);
    const monthIndex = counters.solarAlignedMonth;
    return { weekday, dayOfMonth, monthIndex };
  } catch {
    return null;
  }
};

const canonicalizeSealText = (
  seal: string | undefined | null,
  canonicalPulse: bigint,
  beat: number,
  stepIdx: number,
  solarBeat: number,
  solarStepIdx: number,
  yearLabel?: string
): string => {
  if (!seal) return "";
  let s = seal;
  const solarCtx = getSolarSealContext(canonicalPulse);

  s = s.replace(/Kairos:\s*\d{1,2}:\d{1,2}/i, `Kairos:${fmtSealKairos(beat, stepIdx)}`);
  s = s.replace(/Eternal\s*Pulse:\s*[\d,]+/i, `Eternal Pulse:${fmtPulseDisplay(canonicalPulse)}`);
  s = s.replace(/Step:\s*\d{1,2}\s*\/\s*44/i, `Step:${stepIdx}/44`);
  s = s.replace(/Beat:\s*\d{1,2}\s*\/\s*36(?:\([^)]+\))?/i, `Beat:${beat}/36`);

  if (solarCtx) {
    s = s.replace(
      /Solar Kairos \(UTC-aligned\):\s*\d{1,2}:\d{1,2}\s+\w+\s+D\d+\/M\d+/i,
      `Solar Kairos: ${fmtSealKairos(solarBeat, solarStepIdx)} ${solarCtx.weekday} D${solarCtx.dayOfMonth}/M${solarCtx.monthIndex}`
    );
  }

  if (yearLabel) {
    s = s.replace(/Y\d+/i, yearLabel);
  }

  return s;
};

/* Deterministic ISO for a pulse (formatting only) */
const isoFromPulse = (pulse: bigint): string => {
  try {
    const ms = epochMsFromPulse(pulse); // BigInt epoch ms
    return new Date(biToSafeNumber(ms)).toISOString();
  } catch {
    return "";
  }
};

/* deterministic datetime-local parsing */
function parseDateTimeLocal(value: string): Date | null {
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const sec = Number(m[6] ?? "0");
  const ms = String(m[7] ?? "0").padEnd(3, "0");
  const milli = Number(ms);

  const d = new Date(year, month, day, hour, minute, sec, milli); // LOCAL time
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Breath within minute (φ-exact):
 * Uses kai_pulse.ts utcFromBreathSlot() so no float accumulation.
 */
function applyBreathSlot(baseLocal: Date, breathIndex: number): Date {
  const idx = Number.isFinite(breathIndex)
    ? Math.max(1, Math.min(11, Math.floor(breathIndex)))
    : 1;

  try {
    const z = utcFromBreathSlot(baseLocal.toISOString(), idx);
    const d = z ? new Date(z) : baseLocal;
    return Number.isNaN(d.getTime()) ? baseLocal : d;
  } catch {
    return baseLocal;
  }
}

/* epoch ms now (visual + scheduling only) */
const epochNow = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
};
const deriveKksForPulseNumber = (pulseNum: number) => {
  const p = Number.isFinite(pulseNum) ? Math.trunc(pulseNum) : 0;
  const pμ = BigInt(p) * ONE_PULSE_MICRO; // EXACT
  const { beat, stepIndex, percentIntoStep } = latticeFromMicroPulses(pμ);
  return { beat, stepIndex, stepPct: normalizePercentIntoStep(percentIntoStep) };
};

/* ────────────────────────────────────────────────────────────────
   Safe accessors for KaiKlock record
────────────────────────────────────────────────────────────────── */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const readString = (o: Record<string, unknown>, key: string): string | undefined => {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
};

const readNumber = (o: Record<string, unknown>, key: string): number | undefined => {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

const readRecord = (
  o: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined => {
  const v = o[key];
  return isRecord(v) ? v : undefined;
};

const readWeekday = (o: Record<string, unknown>, key: string): Weekday | undefined => {
  const v = o[key];
  if (typeof v !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(DAY_TO_CHAKRA, v) ? (v as Weekday) : undefined;
};

const fmtMaybeNumber = (v: unknown): string => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  return "";
};

/* ────────────────────────────────────────────────────────────────
   Countdown (6 decimals) — LIVE ONLY
   Uses calibrated μpulses-since-genesis for pulse index + epoch boundary ms
────────────────────────────────────────────────────────────────── */
function useKaiPulseCountdown(active: boolean, nowMicroGenesis: () => bigint) {
  const computeSecsLeft = useCallback((): number => {
    try {
      const pμNow = nowMicroGenesis();
      const curPulse = floorDivE(pμNow, ONE_PULSE_MICRO);
      const nextPulse = curPulse + 1n;

      const nextBoundaryMs = epochMsFromPulse(nextPulse);
      const nowMs = BigInt(Math.floor(epochNow()));
      const diffMs = nextBoundaryMs - nowMs;

      const msLeft = biToSafeNumber(diffMs < 0n ? 0n : diffMs);
      const clamped = Math.max(0, Math.min(PULSE_MS, msLeft));
      return clamped / 1000;
    } catch {
      return PULSE_MS / 1000;
    }
  }, [nowMicroGenesis]);

  const [secsLeft, setSecsLeft] = useState<number>(() =>
    active ? computeSecsLeft() : PULSE_MS / 1000
  );

  const rafRef = useRef<number | null>(null);
  const intRef = useRef<IntervalHandle | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (intRef.current !== null) {
      window.clearInterval(intRef.current);
      intRef.current = null;
    }
    if (!active) return;

    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.style.setProperty("--kai-pulse", `${PULSE_MS}ms`);
    }

    const tick = () => {
      setSecsLeft(computeSecsLeft());
      rafRef.current = requestAnimationFrame(tick);
    };

    // ✅ Immediate snap (mid-pulse correct)
    setSecsLeft(computeSecsLeft());
    rafRef.current = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (intRef.current === null) {
          intRef.current = window.setInterval(() => {
            setSecsLeft(computeSecsLeft());
          }, 33);
        }
      } else {
        if (intRef.current !== null) {
          window.clearInterval(intRef.current);
          intRef.current = null;
        }
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setSecsLeft(computeSecsLeft());
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (intRef.current !== null) window.clearInterval(intRef.current);
      rafRef.current = null;
      intRef.current = null;
    };
  }, [active, computeSecsLeft]);

  return active ? secsLeft : null;
}

/* ────────────────────────────────────────────────────────────────
   Hash helpers (deterministic)
────────────────────────────────────────────────────────────────── */
const getSubtle = (): SubtleCrypto | undefined => {
  try {
    return globalThis.crypto?.subtle;
  } catch {
    return undefined;
  }
};

const sha256Hex = async (text: string): Promise<string> => {
  const encoded = new TextEncoder().encode(text);
  const subtle = getSubtle();
  if (subtle) {
    try {
      const buf = await subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      /* fall through */
    }
  }
  // deterministic fallback (FNV-1a-ish)
  let h1 = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) {
    h1 ^= encoded[i] ?? 0;
    h1 = Math.imul(h1, 16777619);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0");
};

/* ────────────────────────────────────────────────────────────────
   Ark colors (matches canonical + legacy labels)
────────────────────────────────────────────────────────────────── */
const ARK_COLORS: Record<string, string> = {
  "Ignition Ark": "#ff0024",
  "Integration Ark": "#ff6f00",
  "Harmonization Ark": "#ffd600",
  "Reflection Ark": "#00c853",
  "Purification Ark": "#00b0ff",
  "Dream Ark": "#c186ff",

  "Ignite Ark": "#ff0024",
  "Integrate Ark": "#ff6f00",
  "Harmonize Ark": "#ffd600",
  "Reflekt Ark": "#00c853",
  "Purifikation Ark": "#00b0ff",
};

const getArkColor = (label?: string): string => {
  if (!label) return "#ffd600";
  const key = label.trim();
  const normalized = key.replace(/\s*ark$/i, " Ark");
  return ARK_COLORS[key] ?? ARK_COLORS[normalized] ?? "#ffd600";
};

/* ────────────────────────────────────────────────────────────────
   Sticky MINT dock styles (keep inline)
────────────────────────────────────────────────────────────────── */
const MintDockStyles = () => (
  <style>{`
    .sigil-modal { position: relative; isolation: isolate; }

    .sigil-modal .close-btn {
      z-index: 99999 !important;
      pointer-events: auto;
      touch-action: manipulation;
    }
    .sigil-modal .close-btn svg { pointer-events: none; }

    .modal-bottom-spacer { height: clamp(96px, 14vh, 140px); }

    .mint-dock{
      position: sticky;
      bottom: max(10px, env(safe-area-inset-bottom));
      z-index: 6;

      display: grid;
      place-items: center;
      width: fit-content;
      max-width: 100%;
      margin: 0 auto;
      padding: 0;
      background: transparent;
      border: 0;
      box-shadow: none;

      contain: layout paint style;
      -webkit-transform: translateZ(0);
              transform: translateZ(0);
    }

    .mint-dock > *{
      width: auto;
      max-width: 100%;
      flex: 0 0 auto;
    }

    .mint-dock button,
    .mint-dock a{
      display: inline-flex;
    }
  `}</style>
);

/* ────────────────────────────────────────────────────────────────
   Icons
────────────────────────────────────────────────────────────────── */
const CloseIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="close-icon">
    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
    <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="2" />
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      opacity=".25"
    />
  </svg>
);

const MintIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M12 6v6l3.5 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.2 15.8l2.1-2.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/* ────────────────────────────────────────────────────────────────
   Clipboard helper
────────────────────────────────────────────────────────────────── */
async function copyText(txt: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(txt);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const fireAndForget = (p: Promise<unknown>): void => {
  p.catch(() => {
    /* swallow */
  });
};

/* Breath labels (display-only) */
const KAI_PULSE_SEC_DISPLAY = PULSE_MS / 1000;
const BREATH_LABELS: readonly string[] = Array.from({ length: 11 }, (_, i) => {
  const t = (i * KAI_PULSE_SEC_DISPLAY).toFixed(3);
  return `Breath ${i + 1} — ${t}s`;
});

/* ────────────────────────────────────────────────────────────────
   KKS helpers (MUST MATCH KaiSigil/step.ts)
────────────────────────────────────────────────────────────────── */
const beatIndexFromPulseExact = (pulseNum: number): number => {
  const p = Number.isFinite(pulseNum) ? Math.trunc(pulseNum) : 0;
  const base = PULSES_BEAT * BEATS_DAY; // 17424
  const into = ((p % base) + base) % base;
  return Math.max(0, Math.min(BEATS_DAY - 1, Math.floor(into / PULSES_BEAT)));
};

const kksFromPulseNumberExact = (pulseNum: number) => {
  const beat = beatIndexFromPulseExact(pulseNum);
  const stepIndex = stepIndexFromPulseExact(pulseNum);
  const stepPct = percentIntoStepFromPulseExact(pulseNum);
  return { beat, stepIndex, stepPct };
};

const safePulseNumberForSigil = (pulseExact: bigint): number => {
  const p = clampPulseNonNeg(pulseExact);
  if (p <= MAX_SAFE_BI) return Number(p);
  if (SIGIL_WRAP_PULSE <= 0n) return 0;
  const wrapped = modE(p, SIGIL_WRAP_PULSE);
  return biToSafeNumber(wrapped);
};

const fmtSeal = (raw: string) =>
  raw
    .trim()
    .replace(/^(\d+):(\d+)/, (_m, b, s) => `${+b}:${String(s).padStart(2, "0")}`)
    .replace(/D\s*(\d+)/, (_m, d) => `D${+d}`);

/* ────────────────────────────────────────────────────────────────
   Main component
────────────────────────────────────────────────────────────────── */
const SigilModal: FC<Props> = ({ onClose }: Props) => {
  const timeSource = useMemo(() => getKaiTimeSource(), []);

  /**
   * ✅ CALIBRATED μPULSES SINCE GENESIS
   * Some environments return timeSource.nowMicroPulses() as an elapsed counter (starts at ~0).
   * We calibrate it once against microPulsesSinceGenesis(Date) and then always return genesis-based μpulses.
   */
  const microOffsetRef = useRef<bigint>(0n);
  const microOffsetReadyRef = useRef(false);
  const lastCalibrateMsRef = useRef<number>(0);

  const safeDateMicro = useCallback((): bigint => {
    try {
      return microPulsesSinceGenesis(new Date());
    } catch {
      return 0n;
    }
  }, []);

  const safeRawTimeSourceMicro = useCallback((): bigint | null => {
    let raw: unknown = null;
    try {
      raw = timeSource.nowMicroPulses() as unknown;
    } catch {
      raw = null;
    }

    if (typeof raw === "bigint") return raw;

    // tolerate bad runtime implementations
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return BigInt(Math.trunc(raw));
    }
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      try {
        return BigInt(raw);
      } catch {
        return null;
      }
    }
    return null;
  }, [timeSource]);

  const nowMicroGenesis = useCallback((): bigint => {
    const raw = safeRawTimeSourceMicro();
    if (raw === null) return safeDateMicro();

    const nowMs = epochNow();
    const shouldCalibrate =
      !microOffsetReadyRef.current || nowMs - lastCalibrateMsRef.current > 2000;

    if (shouldCalibrate) {
      const dateMicro = safeDateMicro();
      const diff = dateMicro - raw;

      // If the raw source is already genesis-based, diff should be small (within a couple pulses)
      const tol = 2n * ONE_PULSE_MICRO;
      microOffsetRef.current = absBI(diff) <= tol ? 0n : diff;

      microOffsetReadyRef.current = true;
      lastCalibrateMsRef.current = nowMs;
    }

    return raw + microOffsetRef.current;
  }, [safeDateMicro, safeRawTimeSourceMicro]);

  const getNowPulseBI = useCallback((): bigint => {
    try {
      const pμNow = nowMicroGenesis();
      return clampPulseNonNeg(floorDivE(pμNow, ONE_PULSE_MICRO));
    } catch {
      return 0n;
    }
  }, [nowMicroGenesis]);

  // ✅ seed LIVE pulse once so pulse + field match on first paint
  const initialLivePulseRef = useRef<bigint | null>(null);
  if (initialLivePulseRef.current === null) {
    initialLivePulseRef.current = getNowPulseBI();
  }
  const initialLivePulse: bigint = initialLivePulseRef.current ?? 0n;

  // ✅ ALWAYS OPEN IN LIVE
  const [mode, setMode] = useState<"live" | "static-date" | "static-pulse">("live");

  // v22.9 static-mode controls (datetime-local)
  const [dateISO, setDateISO] = useState("");
  const [breathIdx, setBreathIdx] = useState(1);

  // Canonical pulse (BIGINT) — starts LIVE
  const [pulse, setPulse] = useState<bigint>(() => initialLivePulse);

  // Pulse entry field (string, infinite) — starts LIVE
  const [pulseField, setPulseField] = useState<string>(() => initialLivePulse.toString());

  const pulseEditingRef = useRef(false);

  // Derived “server-like” response (local-only)
  const [kairos, setKairos] = useState<KaiKlock | null>(null);

  // Mint icon fallback
  const [mintSvgOk, setMintSvgOk] = useState(true);

  // SealMomentModal
  const [sealOpen, setSealOpen] = useState(false);
  const [sealUrl, setSealUrl] = useState("");
  const [sealHash, setSealHash] = useState("");
  const sealModeRef = useRef<"live" | "static-date" | "static-pulse" | null>(null);

  // canonical child hash from KaiSigil.onReady()
  const [lastHash, setLastHash] = useState("");
  const [zkPoseidonSecret, setZkPoseidonSecret] = useState<string | null>(null);

  // RICH DATA toggle
  const [showRich, setShowRich] = useState(false);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const sigilRef = useRef<KaiSigilHandle | null>(null);

  // LIVE scheduler handle (pulse boundary aligned)
  const timeoutRef = useRef<TimeoutHandle | null>(null);
  const targetBoundaryRef = useRef<number>(0);

  const pulseDisp = useMemo(() => fmtPulseDisplay(pulse), [pulse]);

  // Visual-only: align CSS animation with current pulse progress (mid-pulse correct)
  const syncPulseCss = useCallback(() => {
    try {
      const pμNow = nowMicroGenesis();
      const μInto = modE(pμNow, ONE_PULSE_MICRO);
      const μIntoNum = Number(μInto); // <= 1_000_000 safe

      const msInto = Math.max(
        0,
        Math.min(PULSE_MS, Math.round((μIntoNum * PULSE_MS) / 1_000_000))
      );

      const root = document.documentElement;
      root.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
      root.style.setProperty("--pulse-offset", `-${msInto}ms`);

      const btn = closeBtnRef.current;
      if (btn) {
        btn.style.setProperty("--pulse-dur", `${PULSE_MS}ms`);
        btn.style.setProperty("--pulse-offset", `-${msInto}ms`);
      }
    } catch {
      /* ignore */
    }
  }, [nowMicroGenesis]);

  const applyPulse = useCallback(
    (p: bigint, updateField = true) => {
      const pFixed = clampPulseNonNeg(p);
      setPulse(pFixed);

      if (updateField && !pulseEditingRef.current) {
        setPulseField(pFixed.toString());
      }

      if (typeof document !== "undefined") syncPulseCss();
    },
    [syncPulseCss]
  );

  // ── HARD-LOCK shielding ─────────────────────────────────
  useEffect(() => {
    const shield = (e: Event) => {
      const ov = overlayRef.current;
      if (!ov) return;

      const t = e.target;
      if (!(t instanceof Node)) return;
      if (!ov.contains(t)) return;
      if (closeBtnRef.current?.contains(t)) return;

      e.stopPropagation();
    };

    const events: Array<keyof DocumentEventMap> = ["click", "mousedown", "touchstart"];
    const opts: AddEventListenerOptions = { passive: true };

    events.forEach((ev) => document.addEventListener(ev, shield, opts));

    const escTrap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlayRef.current) e.stopPropagation();
    };
    window.addEventListener("keydown", escTrap, true);

    return () => {
      events.forEach((ev) => document.removeEventListener(ev, shield, opts));
      window.removeEventListener("keydown", escTrap, true);
    };
  }, []);

  /* LIVE: start at true current pulse (never 0) */
  useEffect(() => {
    if (mode !== "live") return;
    applyPulse(getNowPulseBI(), true);
  }, [mode, applyPulse, getNowPulseBI]);

  /* LIVE scheduler: tick exactly on pulse boundaries */
  const clearAlignedTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleAlignedTick = useCallback(() => {
    clearAlignedTimer();

    const armNext = () => {
      const pμNow = nowMicroGenesis();
      const curPulseBI = floorDivE(pμNow, ONE_PULSE_MICRO);
      const nextPulseBI = curPulseBI + 1n;

      const boundaryMsBI = epochMsFromPulse(nextPulseBI);
      const boundaryMs = biToSafeNumber(boundaryMsBI);
      targetBoundaryRef.current = boundaryMs;

      const delay = Math.max(0, boundaryMs - epochNow());
      timeoutRef.current = window.setTimeout(fire, delay);
    };

    const fire = () => {
      const nowMs = epochNow();
      const target = targetBoundaryRef.current;

      if (nowMs < target) {
        timeoutRef.current = window.setTimeout(fire, Math.max(0, target - nowMs));
        return;
      }

      // ✅ snap to true current pulse (genesis-based)
      applyPulse(getNowPulseBI(), true);

      // arm the next boundary
      armNext();
    };

    // immediate snap + arm
    applyPulse(getNowPulseBI(), true);
    armNext();
  }, [applyPulse, clearAlignedTimer, getNowPulseBI, nowMicroGenesis]);

  useEffect(() => {
    if (mode !== "live") return;

    scheduleAlignedTick();

    const onVis = () => {
      if (document.visibilityState === "visible" && mode === "live") {
        scheduleAlignedTick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearAlignedTimer();
    };
  }, [mode, scheduleAlignedTick, clearAlignedTimer]);

  /* LIVE countdown (6 decimals) */
  const secsLeft = useKaiPulseCountdown(mode === "live", nowMicroGenesis);

  /* PULSE CALCULATOR (infinite) */
  const resetToLive = useCallback(() => {
    setMode("live");
    setDateISO("");
    setBreathIdx(1);
    applyPulse(getNowPulseBI(), true);

    // ✅ arm scheduler immediately (do not wait for effect)
    scheduleAlignedTick();
  }, [applyPulse, getNowPulseBI, scheduleAlignedTick]);

  const onPulseFieldChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value ?? "";
    const clean = raw.replace(/[^\d]/g, "");
    setPulseField(clean);

    if (!clean) return;

    try {
      const p = clampPulseNonNeg(BigInt(clean));
      setMode("static-pulse");
      setDateISO("");
      setBreathIdx(1);
      applyPulse(p, false);
      clearAlignedTimer();
    } catch {
      /* ignore */
    }
  };

  /* STATIC (date): datetime-local picker */
  const applyStaticDate = useCallback(
    (val: string, bIdx: number) => {
      const base = parseDateTimeLocal(val);
      if (!base) return;

      const dt = applyBreathSlot(base, bIdx);

      const pμ = microPulsesSinceGenesis(dt);
      const pBI = clampPulseNonNeg(floorDivE(pμ, ONE_PULSE_MICRO));

      setMode("static-date");
      clearAlignedTimer();
      applyPulse(pBI, true);
    },
    [applyPulse, clearAlignedTimer]
  );

  const onDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDateISO(val);

    if (!val) {
      setBreathIdx(1);
      resetToLive();
      return;
    }

    applyStaticDate(val, breathIdx);
  };

  const onBreathChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    setBreathIdx(idx);
    if (!dateISO) return;
    applyStaticDate(dateISO, idx);
  };

  const resetToNow = () => {
    const card = overlayRef.current?.querySelector<HTMLElement>(".sigil-modal");
    if (card) {
      card.classList.remove("flash-now");
      void card.offsetWidth;
      card.classList.add("flash-now");
    }
    resetToLive();
  };

  /**
   * ✅ KaiSigil safe pulse (Number) AND KKS-safe step:
   * - pulseForSigil is always <= Number.MAX_SAFE_INTEGER
   * - beat/step/stepPct are derived from pulseForSigil using KaiSigil/step.ts math
   */
  const pulseForSigil: number = useMemo(() => safePulseNumberForSigil(pulse), [pulse]);

const kksSigil = useMemo(() => deriveKksForPulseNumber(pulseForSigil), [pulseForSigil]);


  // ChakraDay for visuals (from KaiKlock record if present, otherwise stable fallback)
  const chakraDay: ChakraDay = useMemo(() => {
    if (!kairos) return "Root";
    const hd = readWeekday(kairos, "harmonicDay");
    return hd ? DAY_TO_CHAKRA[hd] : "Root";
  }, [kairos]);

  /* Day percent (0..100) derived from pulse only (BigInt exact -> scaled) */
  const dayPct = useMemo(() => {
    try {
      const pμ_total = pulse * ONE_PULSE_MICRO;
      const pulsesInDay = modE(pμ_total, N_DAY_MICRO);
      const scaled = (pulsesInDay * 100_000_000n) / N_DAY_MICRO;
      return Number(scaled) / 1_000_000;
    } catch {
      return 0;
    }
  }, [pulse]);

  /**
   * ✅ Solar day percent (0..100), sunrise-aligned using SovereignSolar
   */
  const solarDayPct = useMemo(() => {
    try {
      const ms = epochMsFromPulse(pulse);
      const when = new Date(biToSafeNumber(ms));
      const { dayPercent } = getKaiPulseToday(when);
      return Math.max(0, Math.min(100, dayPercent));
    } catch {
      return dayPct;
    }
  }, [pulse, dayPct]);

  const solarBeatStep = useMemo(() => {
    try {
      const ms = epochMsFromPulse(pulse);
      const when = new Date(biToSafeNumber(ms));
      const { beatIndex, stepIndex } = getKaiPulseToday(when);
      return { beat: beatIndex, stepIndex };
    } catch {
      return { beat: kksSigil.beat, stepIndex: kksSigil.stepIndex };
    }
  }, [pulse, kksSigil.beat, kksSigil.stepIndex]);

  /* Derive KaiKlock “response” for current pulse */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const ms = epochMsFromPulse(pulse);
        const raw = await buildKaiKlockResponse(ms);
        const next: KaiKlock | null = isRecord(raw) ? (raw as KaiKlock) : null;
        if (!cancelled) setKairos(next);
      } catch {
        if (!cancelled) setKairos(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pulse]);

  /* UI strings (MUST match KaiSigil seed inputs to avoid “I didn’t get it”) */
  const localBeatStep = `${kksSigil.beat}:${pad2(kksSigil.stepIndex)}`;
  const beatStepDisp = localBeatStep;

  const chakraStepString = kairos ? readString(kairos, "chakraStepString") : undefined;

  const dayOfMonth = kairos ? readNumber(kairos, "dayOfMonth") : undefined;
  const eternalMonthIndex = kairos ? readNumber(kairos, "eternalMonthIndex") : undefined;

  const eternalYearText = useMemo(() => {
    if (!kairos) return "";
    const raw = readString(kairos, "eternalYearName") ?? "";
    const match = raw.match(/Y(\d+)/i);
    if (!match) return raw;
    const yearNum = Number(match[1]);
    if (!Number.isFinite(yearNum)) return raw;
    return `Y${Math.max(0, yearNum - 1)}`;
  }, [kairos]);

  const kairosDayMonth =
    typeof dayOfMonth === "number" &&
    typeof eternalMonthIndex === "number" &&
    eternalYearText
      ? `${localBeatStep} — D${dayOfMonth}/M${eternalMonthIndex + 1}/${eternalYearText}`
      : beatStepDisp;

  const kairosDisp = fmtSeal(kairosDayMonth);

  const eternalArkLabel = kairos
    ? readString(kairos, "eternalChakraArc") ?? "Harmonization Ark"
    : "Harmonization Ark";
  const eternalArkColor = getArkColor(eternalArkLabel);

  const copy = (txt: string) => fireAndForget(copyText(txt));
  const copyJSON = (obj: unknown) => copy(JSON.stringify(obj, null, 2));

  const getSVGElement = (): SVGSVGElement | null =>
    document.querySelector<SVGSVGElement>("#sigil-export svg");

  type SigilSharePayloadExtended = SigilSharePayload & {
    canonicalHash: string;
    exportedAt: string;
    expiresAtPulse: number;
    expiresAtPulseExact: string; // bigint exact
    pulseExact: string; // bigint exact
    pulseSigil: number; // the pulse number actually used in the SVG (wrapped-safe)
  };

  type ProofBundle = {
    hashAlg: "sha256";
    canon: "JCS";
    proofCapsule: ProofCapsuleV1;
    capsuleHash: string;
    svgHash: string;
    bundleHash: string;
    shareUrl: string;
    verifierUrl: string;
    authorSig: AuthorSig | null;
    zkPoseidonHash?: string;
    zkProof?: unknown;
    proofHints?: unknown;
    zkPublicInputs?: unknown;
  };

  const makeSharePayload = (
    canonicalHash: string,
    pulseSnapshot: bigint,
    chakraSnapshot: ChakraDay
  ): SigilSharePayloadExtended => {
    const stepsPerBeat = STEPS_BEAT;

    const pulseSigil = safePulseNumberForSigil(pulseSnapshot);
    const { beat, stepIndex } = kksFromPulseNumberExact(pulseSigil);

    // IMPORTANT: payload.pulse MUST match the SVG’s data-pulse (so verifiers stay coherent)
    return {
      pulse: pulseSigil,
      beat,
      stepIndex,
      chakraDay: chakraSnapshot,
      stepsPerBeat,
      canonicalHash,
      exportedAt: isoFromPulse(pulseSnapshot),
      expiresAtPulse: Number(pulseSnapshot + 11n),
      expiresAtPulseExact: (pulseSnapshot + 11n).toString(),
      pulseExact: pulseSnapshot.toString(),
      pulseSigil,
    };
  };

  const readPublicInput0 = (inputs: unknown): string | null => {
    if (!inputs) return null;
    if (Array.isArray(inputs)) {
      const first = inputs[0];
      return first == null ? null : String(first);
    }
    if (typeof inputs === "string") {
      try {
        const parsed = JSON.parse(inputs) as unknown;
        if (Array.isArray(parsed)) {
          const first = parsed[0];
          return first == null ? null : String(first);
        }
      } catch {
        return inputs;
      }
      return inputs;
    }
    return null;
  };

  const [sealPayload, setSealPayload] = useState<SigilSharePayload | null>(null);

  const mintMoment = async () => {
    const liveNow = mode === "live" ? getNowPulseBI() : pulse;
    const mintPulse = mode === "live" ? (liveNow >= pulse ? liveNow : pulse) : pulse;
    sealModeRef.current = mode;

    if (mode === "live") {
      setMode("static-pulse");
      applyPulse(mintPulse, true);
    }

    const moment = momentFromPulse(mintPulse);
    const chakraSnapshot = normalizeChakraDay(moment.chakraDay) ?? chakraDay;

    const svg = getSVGElement();
    const svgPulseAttr = svg?.getAttribute("data-pulse");
    const svgPulseBI =
      svgPulseAttr && /^\d+$/.test(svgPulseAttr) ? BigInt(svgPulseAttr) : null;

    // IMPORTANT: SVG stores the SAFE sigil pulse (wrapped), not bigint pulseExact.
    const mintPulseSigilNum = safePulseNumberForSigil(mintPulse);
    const svgMatchesMint =
      svgPulseBI !== null && svgPulseBI === BigInt(mintPulseSigilNum);

    // If the SVG pulse matches, lastHash is trustworthy for this mint moment.
    let hash = (svgMatchesMint ? lastHash : "").toLowerCase();

    if (!hash) {
      const mintKks = kksFromPulseNumberExact(mintPulseSigilNum);
      const svgStr = svg ? new XMLSerializer().serializeToString(svg) : "";
      const basis =
        (svgStr || "no-svg") +
        `|pulseExact=${mintPulse.toString()}` +
        `|pulseSigil=${mintPulseSigilNum}` +
        `|beat=${mintKks.beat}|step=${mintKks.stepIndex}|chakra=${chakraSnapshot}`;
      hash = (await sha256Hex(basis)).toLowerCase();
    }

    const payload = makeSharePayload(hash, mintPulse, chakraSnapshot);
    const url = makeSigilUrlLoose(hash, payload);

    setSealHash(hash);
    setSealPayload(payload);
    setSealUrl(url);
    setSealOpen(true);
  };

  const exportProofBundle = async (): Promise<string | null> => {
    try {
      const svgEl = getSVGElement();
      if (!svgEl) return "Export failed: sigil SVG is not available.";

      const payloadFromUrl = sealUrl ? extractPayloadFromUrl(sealUrl) : null;

      const svgPulseAttr = svgEl.getAttribute("data-pulse");
      const svgPulseParsed = svgPulseAttr ? Number.parseInt(svgPulseAttr, 10) : NaN;

      const svgBeatAttr = svgEl.getAttribute("data-beat");
      const svgBeatParsed = svgBeatAttr ? Number.parseInt(svgBeatAttr, 10) : NaN;

      const svgStepAttr = svgEl.getAttribute("data-step-index");
      const svgStepParsed = svgStepAttr ? Number.parseInt(svgStepAttr, 10) : NaN;

      const svgChakraAttr = svgEl.getAttribute("data-chakra-day");
      const svgChakraNormalized = normalizeChakraDay(svgChakraAttr ?? undefined);

      const svgStepsPerBeatAttr = svgEl.getAttribute("data-steps-per-beat");
      const svgStepsPerBeatParsed = svgStepsPerBeatAttr
        ? Number.parseInt(svgStepsPerBeatAttr, 10)
        : NaN;

      const kaiSignatureAttr = svgEl.getAttribute("data-kai-signature") ?? "";
      const phiKeyAttr = svgEl.getAttribute("data-phi-key") ?? "";
      const payloadHashAttr = svgEl.getAttribute("data-payload-hash") ?? "";

      const payloadPulse = Number(sealPayload?.pulse ?? payloadFromUrl?.pulse);
      const payloadBeat = Number(sealPayload?.beat ?? payloadFromUrl?.beat);
      const payloadStep = Number(sealPayload?.stepIndex ?? payloadFromUrl?.stepIndex);
      const payloadStepsPerBeat = Number(
        sealPayload?.stepsPerBeat ?? payloadFromUrl?.stepsPerBeat
      );
      const payloadChakra = normalizeChakraDay(
        typeof sealPayload?.chakraDay === "string"
          ? sealPayload.chakraDay
          : typeof payloadFromUrl?.chakraDay === "string"
          ? payloadFromUrl.chakraDay
          : undefined
      );

      const pulseNum = Number.isFinite(payloadPulse) ? payloadPulse : svgPulseParsed;
      const beatNum = Number.isFinite(payloadBeat) ? payloadBeat : svgBeatParsed;
      const stepNum = Number.isFinite(payloadStep) ? payloadStep : svgStepParsed;
      const stepsPerBeat = Number.isFinite(payloadStepsPerBeat)
        ? payloadStepsPerBeat
        : Number.isFinite(svgStepsPerBeatParsed)
        ? svgStepsPerBeatParsed
        : STEPS_BEAT;

      const chakraNormalized = payloadChakra ?? svgChakraNormalized;

      const kaiSignature =
        typeof payloadFromUrl?.kaiSignature === "string"
          ? payloadFromUrl.kaiSignature
          : kaiSignatureAttr;

      const phiKey =
        typeof payloadFromUrl?.userPhiKey === "string"
          ? payloadFromUrl.userPhiKey
          : phiKeyAttr;

      const payloadHashHex = sealHash || payloadHashAttr;

      if (!kaiSignature) return "Export failed: kaiSignature missing from SVG.";
      if (!phiKey) return "Export failed: Φ-Key missing from SVG.";
      if (!payloadHashHex) return "Export failed: payload hash missing from SVG.";
      if (!chakraNormalized) return "Export failed: chakra day missing from SVG.";

      if (!Number.isFinite(pulseNum)) return "Export failed: pulse missing from SVG.";
      if (!Number.isFinite(beatNum)) return "Export failed: beat missing from SVG.";
      if (!Number.isFinite(stepNum)) return "Export failed: step index missing from SVG.";

      const sharePayload: SigilSharePayload = {
        pulse: pulseNum,
        beat: beatNum,
        stepIndex: stepNum,
        chakraDay: chakraNormalized,
        stepsPerBeat,
        kaiSignature,
        userPhiKey: phiKey,
      };

      const shareUrl = makeSigilUrl(payloadHashHex, sharePayload);
      const verifierUrl = buildVerifierUrl(pulseNum, kaiSignature);
      const kaiSignatureShort = kaiSignature.slice(0, 10);

      const proofCapsule: ProofCapsuleV1 = {
        v: "KPV-1",
        pulse: pulseNum,
        chakraDay: chakraNormalized,
        kaiSignature,
        phiKey,
        verifierSlug: `${pulseNum}-${kaiSignatureShort}`,
      };

      const capsuleHash = await hashProofCapsuleV1(proofCapsule);

      const svgClone = svgEl.cloneNode(true) as SVGElement;
      svgClone.setAttribute("data-pulse", String(pulseNum));
      svgClone.setAttribute("data-beat", String(beatNum));
      svgClone.setAttribute("data-step-index", String(stepNum));
      svgClone.setAttribute("data-chakra-day", chakraNormalized);
      svgClone.setAttribute("data-steps-per-beat", String(stepsPerBeat));
      svgClone.setAttribute("data-kai-signature", kaiSignature);
      svgClone.setAttribute("data-phi-key", phiKey);
      svgClone.setAttribute("data-payload-hash", payloadHashHex);

      const svgString = new XMLSerializer().serializeToString(svgClone);
      const embeddedMeta = extractEmbeddedMetaFromSvg(svgString);

      let zkPoseidonHash =
        typeof embeddedMeta.zkPoseidonHash === "string" &&
        embeddedMeta.zkPoseidonHash.trim().length > 0
          ? embeddedMeta.zkPoseidonHash.trim()
          : undefined;

      let zkProof = embeddedMeta.zkProof;
      let proofHints = embeddedMeta.proofHints;
      let zkPublicInputs: unknown = embeddedMeta.zkPublicInputs;

      if (!zkPoseidonHash && payloadHashHex) {
        const computed = await computeZkPoseidonHash(payloadHashHex);
        zkPoseidonHash = computed.hash;
      }

      if (zkPoseidonHash) {
        const proofObj =
          zkProof && typeof zkProof === "object"
            ? (zkProof as Record<string, unknown>)
            : null;

        const hasProof =
          typeof zkProof === "string"
            ? zkProof.trim().length > 0
            : Array.isArray(zkProof)
            ? zkProof.length > 0
            : proofObj
            ? Object.keys(proofObj).length > 0
            : false;

        let secretForProof =
          typeof zkPoseidonSecret === "string" && zkPoseidonSecret.trim().length > 0
            ? zkPoseidonSecret.trim()
            : undefined;

        if (!secretForProof && payloadHashHex) {
          const computed = await computeZkPoseidonHash(payloadHashHex);
          if (computed.hash === zkPoseidonHash) {
            secretForProof = computed.secret;
          }
        }

        if (!hasProof && !secretForProof) {
          throw new Error("ZK secret missing for proof generation");
        }

        if (!hasProof && secretForProof) {
          const generated = await generateZkProofFromPoseidonHash({
            poseidonHash: zkPoseidonHash,
            secret: secretForProof,
            proofHints:
              typeof proofHints === "object" && proofHints !== null
                ? (proofHints as SigilProofHints)
                : undefined,
          });
          if (!generated) throw new Error("ZK proof generation failed");
          zkProof = generated.proof;
          proofHints = generated.proofHints;
          zkPublicInputs = generated.zkPublicInputs;
        }

        if (typeof proofHints !== "object" || proofHints === null) {
          proofHints = buildProofHints(zkPoseidonHash);
        } else {
          proofHints = buildProofHints(zkPoseidonHash, proofHints as SigilProofHints);
        }
      }

      if (zkPoseidonHash && zkPublicInputs) {
        const publicInput0 = readPublicInput0(zkPublicInputs);
        if (publicInput0 && publicInput0 !== zkPoseidonHash) {
          throw new Error("Embedded ZK mismatch");
        }
      }
      if (zkPoseidonHash && (!zkProof || typeof zkProof !== "object")) {
        throw new Error("ZK proof missing");
      }

      if (zkPublicInputs) {
        svgClone.setAttribute("data-zk-public-inputs", JSON.stringify(zkPublicInputs));
      }
      if (zkPoseidonHash) {
        svgClone.setAttribute("data-zk-scheme", "groth16-poseidon");
        svgClone.setAttribute("data-zk-poseidon-hash", zkPoseidonHash);
        if (zkProof) svgClone.setAttribute("data-zk-proof", "present");
      }

      const svgString2 = new XMLSerializer().serializeToString(svgClone);

      const svgHash = await hashSvgText(svgString2);

      const proofBundleBase = {
        hashAlg: PROOF_HASH_ALG,
        canon: PROOF_CANON,
        proofCapsule,
        capsuleHash,
        svgHash,
        shareUrl,
        verifierUrl,
        authorSig: null as AuthorSig | null,
        zkPoseidonHash,
        zkProof,
        proofHints,
        zkPublicInputs,
      };

      const bundleUnsigned = buildBundleUnsigned(proofBundleBase);
      const computedBundleHash = await hashBundle(bundleUnsigned);

      let authorSig: AuthorSig | null = null;
      try {
        await ensurePasskey(phiKey);
        authorSig = await signBundleHash(phiKey, computedBundleHash);
      } catch (err) {
        console.warn("Author signature failed; continuing without authorSig.", err);
        authorSig = null;
      }

      const proofBundle: ProofBundle = {
        ...proofBundleBase,
        bundleHash: computedBundleHash,
        authorSig,
      };

      const sealedSvg = embedProofMetadata(svgString2, proofBundle);

      const baseName = `kai_pulse_seal-${pulseNum}_${kaiSignatureShort}`;
      const zip = new JSZip();
      zip.file(`${baseName}.svg`, sealedSvg);
      zip.file(`${baseName}_proof_bundle.json`, JSON.stringify(proofBundle, null, 2));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${baseName}_proof_bundle.zip`);

      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Export failed: ${msg}`;
    }
  };

  const handleClose = () => onClose();
  const handleSealClose = () => {
    setSealOpen(false);
    const prevMode = sealModeRef.current;
    sealModeRef.current = null;
    if (prevMode === "live") {
      resetToLive();
    }
  };

  // Meta display helpers
  const harmonicDayText = useMemo(() => {
    if (!kairos) return "";
    const hd = readWeekday(kairos, "harmonicDay");
    return hd ? hd : fmtMaybeNumber(kairos["harmonicDay"]);
  }, [kairos]);

  const eternalMonthText = useMemo(
    () => (kairos ? readString(kairos, "eternalMonth") ?? "" : ""),
    [kairos]
  );

  const kaiTurahText = useMemo(() => {
    try {
      const moment = momentFromPulse(pulse);
      return generateKaiTurah(moment).line;
    } catch {
      return "";
    }
  }, [pulse]);

  const sealText = useMemo(() => {
    if (!kairos) return "";
    const raw = readString(kairos, "eternalSeal") ?? readString(kairos, "seal") ?? "";
    return canonicalizeSealText(
      raw,
      pulse,
      kksSigil.beat,
      kksSigil.stepIndex,
      solarBeatStep.beat,
      solarBeatStep.stepIndex,
      eternalYearText || undefined
    );
  }, [kairos, kksSigil.beat, kksSigil.stepIndex, pulse, solarBeatStep, eternalYearText]);

  // Memory display helpers
  const kaiPulseEternalNum = kairos ? readNumber(kairos, "kaiPulseEternal") : undefined;
  const kaiPulseTodayNum = kairos ? readNumber(kairos, "kaiPulseToday") : undefined;

  const chakraStep = kairos ? readRecord(kairos, "chakraStep") : undefined;
  const chakraBeat = kairos ? readRecord(kairos, "chakraBeat") : undefined;

  const chakraStepStepIndex = chakraStep ? readNumber(chakraStep, "stepIndex") : undefined;
  const chakraStepPct = chakraStep ? readNumber(chakraStep, "percentIntoStep") : undefined;

  const chakraBeatBeatIndex = chakraBeat ? readNumber(chakraBeat, "beatIndex") : undefined;
  const chakraBeatPulsesInto = chakraBeat ? readNumber(chakraBeat, "pulsesIntoBeat") : undefined;

  const weekIndexNum = kairos ? readNumber(kairos, "weekIndex") : undefined;
  const weekNameText = kairos ? readString(kairos, "weekName") ?? "" : "";

  const harmonicWeekPct = (() => {
    const hw = kairos ? readRecord(kairos, "harmonicWeekProgress") : undefined;
    return hw ? readNumber(hw, "percent") : undefined;
  })();

  const eternalMonthPct = (() => {
    const em = kairos ? readRecord(kairos, "eternalMonthProgress") : undefined;
    return em ? readNumber(em, "percent") : undefined;
  })();

  const harmonicYearPct = (() => {
    const hy = kairos ? readRecord(kairos, "harmonicYearProgress") : undefined;
    return hy ? readNumber(hy, "percent") : undefined;
  })();

  const phiSpiralLevelNum = kairos ? readNumber(kairos, "phiSpiralLevel") : undefined;

  const kaiMomentSummaryText = kairos ? readString(kairos, "kaiMomentSummary") ?? "" : "";
  const compressedSummaryText = kairos ? readString(kairos, "compressed_summary") ?? "" : "";

  return createPortal(
    <>
      <MintDockStyles />

      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        className="sigil-modal-overlay"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onTouchStart={(e) => {
          if (e.target === e.currentTarget) e.stopPropagation();
        }}
        onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
      >
        <div
          className="sigil-modal"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            ref={closeBtnRef}
            aria-label="Close"
            className="close-btn"
            onClick={handleClose}
          >
            <CloseIcon />
          </button>

          {/* v22.9 Moment row */}
          <SigilMomentRow
            dateISO={dateISO}
            onDateChange={onDateChange}
            secondsLeft={mode === "live" ? secsLeft ?? undefined : undefined}
            solarPercent={solarDayPct}
            eternalPercent={dayPct}
            solarColor={"#ffd600"}
            eternalColor={eternalArkColor}
            eternalArkLabel={eternalArkLabel}
          />

          {/* Static controls: breath selector if date is active, NOW always available when not live */}
          {mode !== "live" && (
            <>
              {dateISO && (
                <label style={{ marginLeft: "12px" }} className="sigil-label">
                  <span className="sigil-label__text">Breath within minute</span>&nbsp;
                  <select value={breathIdx} onChange={onBreathChange}>
                    {BREATH_LABELS.map((lbl, i) => (
                      <option key={lbl} value={i + 1}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="now-btn" onClick={resetToNow}>
                Now
              </button>
            </>
          )}

          {/* Countdown (live only) */}
          {mode === "live" && secsLeft !== null && (
            <p className="countdown">
              next pulse in <strong>{secsLeft.toFixed(3)}</strong>s
            </p>
          )}

          {/* ✅ Pulse calculator (infinite bigint) */}
          <div className="sigil-pulse-row">
            <label className="sigil-label sigil-pulse-label">
              <span className="sigil-label__text">☤KAI:</span>
              <input
                className="sigil-input sigil-pulse-input"
                type="text"
                inputMode="numeric"
                value={pulseField}
                onFocus={() => {
                  pulseEditingRef.current = true;
                }}
                onBlur={() => {
                  pulseEditingRef.current = false;
                  setPulseField(pulse.toString());
                }}
                onChange={onPulseFieldChange}
                aria-label="Pulse"
                placeholder="Enter pulse"
              />
            </label>

            <span
              className={`sigil-live-chip ${mode === "live" ? "is-live" : "is-static"}`}
              aria-live="polite"
            >
              {mode === "live" ? "LIVE" : "STATIC"}
            </span>
          </div>

          <div
            id="sigil-export"
            style={{ position: "relative", width: 240, margin: "16px auto" }}
          >
<KaiSigil
  ref={sigilRef}
  pulse={pulseForSigil}
  chakraDay={chakraDay as KaiSigilProps["chakraDay"]}
  size={240}
  hashMode="deterministic"
  origin=""
  onReady={(payload: { hash?: string; zkPoseidonSecret?: string }) => {
    const h = payload.hash ? String(payload.hash).toLowerCase() : "";
    if (h) setLastHash(h);
    if (payload.zkPoseidonSecret) setZkPoseidonSecret(payload.zkPoseidonSecret);
  }}
/>

            <span className="pulse-tag">{pulseDisp}</span>
          </div>

          <div className="sigil-meta-block">
            <p>
              <strong>☤KAI:</strong>&nbsp;
              {pulseDisp}
              <button className="copy-btn" onClick={() => copy(pulse.toString())}>
                💠
              </button>
            </p>

            <p>
              <strong>Kairos/Date:</strong>&nbsp;
              {kairosDisp} {pulseDisp}
              <button className="copy-btn" onClick={() => copy(kairosDisp)}>
                💠
              </button>
            </p>

            {kairos && (
              <>
                <p>
                  <strong>Seal:</strong>&nbsp;
                  {sealText}
                  <button className="copy-btn" onClick={() => copy(sealText)}>
                    💠
                  </button>
                </p>

                <p>
                  <strong>Day:</strong> {harmonicDayText}
                </p>
                <p>
                  <strong>Month:</strong> {eternalMonthText}
                </p>
                <p>
                  <strong>Arc:</strong> {eternalArkLabel}
                </p>

                <p>
                  <strong>Kai-Turah:</strong>&nbsp;
                  {kaiTurahText}
                  <button className="copy-btn" onClick={() => copy(kaiTurahText)}>
                    💠
                  </button>
                </p>
              </>
            )}
          </div>

          {kairos && (
            <details
              className="rich-data"
              open={showRich}
              onToggle={(e) => setShowRich(e.currentTarget.open)}
            >
              <summary>Memory</summary>

              <div className="rich-grid">
                <div>
                  <code>pulseExact</code>
                  <span>{pulse.toString()}</span>
                </div>

                <div>
                  <code>pulseSigil</code>
                  <span>{String(pulseForSigil)}</span>
                </div>

                <div>
                  <code>kaiPulseEternal</code>
                  <span>{(kaiPulseEternalNum ?? 0).toLocaleString()}</span>
                </div>
                <div>
                  <code>kaiPulseToday</code>
                  <span>{kaiPulseTodayNum ?? 0}</span>
                </div>

                <div>
                  <code>chakraStepString</code>
                  <span>{chakraStepString ?? ""}</span>
                </div>
                <div>
                  <code>chakraStep.stepIndex</code>
                  <span>{chakraStepStepIndex ?? 0}</span>
                </div>
                <div>
                  <code>chakraStep.percentIntoStep</code>
                  <span>{((chakraStepPct ?? 0) * 100).toFixed(2)}%</span>
                </div>

                <div>
                  <code>chakraBeat.beatIndex</code>
                  <span>{chakraBeatBeatIndex ?? 0}</span>
                </div>
                <div>
                  <code>chakraBeat.pulsesIntoBeat</code>
                  <span>{chakraBeatPulsesInto ?? 0}</span>
                </div>

                <div>
                  <code>weekIndex</code>
                  <span>{weekIndexNum ?? 0}</span>
                </div>
                <div>
                  <code>weekName</code>
                  <span>{weekNameText}</span>
                </div>

                <div>
                  <code>dayOfMonth</code>
                  <span>{dayOfMonth ?? 0}</span>
                </div>
                <div>
                  <code>eternalMonthIndex</code>
                  <span>{typeof eternalMonthIndex === "number" ? eternalMonthIndex + 1 : 0}</span>
                </div>

                <div>
                  <code>harmonicWeekProgress.percent</code>
                  <span>{((harmonicWeekPct ?? 0) * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <code>eternalMonthProgress.percent</code>
                  <span>{((eternalMonthPct ?? 0) * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <code>harmonicYearProgress.percent</code>
                  <span>{((harmonicYearPct ?? 0) * 100).toFixed(2)}%</span>
                </div>

                <div>
                  <code>phiSpiralLevel</code>
                  <span>{phiSpiralLevelNum ?? 0}</span>
                </div>

                <div className="span-2">
                  <code>kaiMomentSummary</code>
                  <span>{kaiMomentSummaryText}</span>
                </div>
                <div className="span-2">
                  <code>compressed_summary</code>
                  <span>{compressedSummaryText}</span>
                </div>
                <div className="span-2">
                  <code>eternalSeal</code>
                  <span className="truncate">{sealText}</span>
                </div>

                <div className="span-2">
                  <code>wrapPeriodPulse</code>
                  <span>{SIGIL_WRAP_PULSE.toString()}</span>
                </div>

                <div className="span-2">
                  <code>baseDayMicro</code>
                  <span>{BASE_DAY_MICRO.toString()}</span>
                </div>
              </div>

              <div className="rich-actions">
                <button onClick={() => copyJSON(kairos)}>Remember JSON</button>
              </div>
            </details>
          )}

          <div className="modal-bottom-spacer" aria-hidden="true" />

          {/* ONE ACTION ONLY: MINT MOMENT */}
          <div className="mint-dock">
            <button
              className="mint-btn"
              type="button"
              aria-label="Mint this moment"
              title="Mint this moment"
              onClick={mintMoment}
            >
              <span className="mint-btn__icon" aria-hidden="true">
                {mintSvgOk ? (
                  <img
                    src="/assets/seal.svg"
                    alt=""
                    loading="eager"
                    decoding="async"
                    onError={() => setMintSvgOk(false)}
                  />
                ) : (
                  <MintIcon />
                )}
              </span>

              <span className="mint-btn__text">
                <span className="mint-btn__title">MINT ΦKey</span>
                <span className="mint-btn__sub">☤KAI {pulseDisp}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={handleSealClose}
        onDownloadZip={exportProofBundle}
      />
    </>,
    document.body
  );
};

export default SigilModal;