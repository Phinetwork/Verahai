"use client";

/**
 * PulseHoneycombModal.tsx — v41.3.1
 * - Clean live chart (no 128/512/2k/max controls)
 * - Φ ⇄ USD value toggle
 * - Rich hover/lock tooltip rendered via portal (never clipped)
 * - Proof strip (PhiKey + KaiSig + key hash) in header-right
 * - Slim bottom bar actions
 *
 * FIX (41.3.1):
 * - Removed setState-in-effect cascade by deriving unitMode from selection
 *   with a user override (unitOverride). No more:
 *     useEffect(() => setUnitMode(...), [selectedIsDerived])
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./SigilHoneycomb.css";
import "./PulseHoneycombModal.css";

import { memoryRegistry } from "./registryStore";
import { computeIntrinsicUnsigned, type SigilMetadataLite } from "../../utils/valuation";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import { bootstrapSeries } from "../valuation/series";
import KaiSigil from "../KaiSigil";
import type { ChakraDay } from "../KaiSigil/types";
import { N_DAY_MICRO, latticeFromMicroPulses, momentFromPulse, normalizePercentIntoStep } from "../../utils/kai_pulse";
import { getKaiPulseEternalInt } from "../../SovereignSolar";
import {
  canonicalizeUrl,
  explorerOpenUrl,
  contentKindForUrl,
  scoreUrlForView,
  parseHashFromUrl,
} from "./url";

const PHM_MODAL_VERSION = "41.3.1";

type EdgeMode = "none" | "parent" | "parent+children" | "all";

type HoneyNode = {
  hash: string;
  bestUrl: string;
  sources: string[];

  pulse?: number;
  beat?: number;
  stepIndex?: number;
  chakraDay?: string;

  userPhiKey?: string;
  kaiSignature?: string;

  parentHash?: string;
  originHash?: string;

  transferDirection?: "send" | "receive";
  transferAmountPhi?: string;
  phiDelta?: string;

  degree: number;
};

type Coord = { q: number; r: number };
type Pt = { x: number; y: number };

type LayoutItem = {
  node: HoneyNode;
  x: number;
  y: number;
  cx: number;
  cy: number;
};

type EdgeLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "parent" | "child" | "origin";
};

export type PulseHoneycombModalProps = {
  open: boolean;
  pulse: number | null;
  originUrl?: string;
  originHash?: string;
  anchor?: { x: number; y: number };
  registryRev?: number; // refresh signal only
  onClose: () => void;
};

type PulseHoneycombInnerProps = {
  pulse: number | null;
  originUrl?: string;
  originHash?: string;
  registryRev?: number;
  onClose: () => void;
};

const HAS_WINDOW = typeof window !== "undefined";

const SIGIL_SELECT_CHANNEL_NAME = "sigil:explorer:select:bc:v1";
const SIGIL_SELECT_LS_KEY = "sigil:explorer:selectedHash:v1";

const ONE_PULSE_MICRO = 1_000_000n;

/* ─────────────────────────────────────────────────────────────
   Idle scheduling (no any)
───────────────────────────────────────────────────────────── */
type IdleCompat = {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function getIdleCompat(): IdleCompat {
  return globalThis as unknown as IdleCompat;
}

function scheduleIdle(cb: () => void): { cancel: () => void } {
  const g = getIdleCompat();

  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(() => cb(), { timeout: 200 });
    return {
      cancel: () => {
        if (typeof g.cancelIdleCallback === "function") g.cancelIdleCallback(id);
      },
    };
  }

  const id = window.setTimeout(cb, 32);
  return { cancel: () => clearTimeout(id) };
}

/* ─────────────────────────────────────────────────────────────
   Small utilities
───────────────────────────────────────────────────────────── */
function ignore(): void {
  // best-effort
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function readLowerStr(v: unknown): string | undefined {
  const s = readStr(v);
  return s ? s.toLowerCase() : undefined;
}

function readFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    ignore();
  }
}

function broadcastSelectedHash(hash: string): void {
  if (!HAS_WINDOW) return;

  safeLocalStorageSet(SIGIL_SELECT_LS_KEY, hash);

  try {
    const ch = "BroadcastChannel" in window ? new BroadcastChannel(SIGIL_SELECT_CHANNEL_NAME) : null;
    ch?.postMessage({ type: "sigil:select", hash });
    ch?.close();
  } catch {
    ignore();
  }
}

function shortHash(h: string, n = 10): string {
  return h.length <= n ? h : h.slice(0, n);
}

function formatUsd(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatPhiNumber(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
}

function normalizeChakraDay(value?: string): ChakraDay {
  const v = (value ?? "").toLowerCase();
  if (v.includes("root")) return "Root";
  if (v.includes("sacral")) return "Sacral";
  if (v.includes("solar")) return "Solar Plexus";
  if (v.includes("heart")) return "Heart";
  if (v.includes("throat")) return "Throat";
  if (v.includes("third") || v.includes("brow")) return "Third Eye";
  if (v.includes("crown")) return "Crown";
  return "Root";
}

async function copyText(text: string): Promise<void> {
  if (!HAS_WINDOW) return;
  if (!text) return;
  if (!navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    ignore();
  }
}

/* ─────────────────────────────────────────────────────────────
   KKS wrapping
───────────────────────────────────────────────────────────── */
const modE = (a: bigint, m: bigint) => {
  if (m === 0n) return 0n;
  const r = a % m;
  return r >= 0n ? r : r + m;
};

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

const SIGIL_WRAP_PULSE: bigint = (() => {
  const g = gcdBI(N_DAY_MICRO, ONE_PULSE_MICRO);
  return g === 0n ? 0n : N_DAY_MICRO / g;
})();

const SIGIL_RENDER_CACHE = new Set<string>();
const PHI = (1 + Math.sqrt(5)) / 2;

const wrapPulseForSigil = (pulse: number): number => {
  if (!Number.isFinite(pulse)) return 0;
  const pulseBI = BigInt(Math.trunc(pulse));
  if (SIGIL_WRAP_PULSE <= 0n) return 0;
  const wrapped = modE(pulseBI, SIGIL_WRAP_PULSE);
  return Number(wrapped);
};

const deriveKksFromPulse = (pulse: number) => {
  const p = Number.isFinite(pulse) ? Math.trunc(pulse) : 0;
  const pμ = BigInt(p) * ONE_PULSE_MICRO;
  const { beat, stepIndex, percentIntoStep } = latticeFromMicroPulses(pμ);
  const stepPct = normalizePercentIntoStep(percentIntoStep);
  return { beat, stepIndex, stepPct };
};

const hashToUnit = (hash: string): number => {
  let acc = 0;
  for (let i = 0; i < hash.length; i += 1) {
    acc = (acc * 31 + hash.charCodeAt(i)) % 1000000;
  }
  return acc / 1000000;
};

function useDeferredSigilRender(key: string): boolean {
  const [, forceRender] = useState(0);
  const cached = SIGIL_RENDER_CACHE.has(key);

  useEffect(() => {
    if (cached) return;

    let cancelled = false;
    const task = scheduleIdle(() => {
      if (cancelled) return;
      SIGIL_RENDER_CACHE.add(key);
      forceRender((v) => v + 1);
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [cached, key]);

  return cached;
}

/* ─────────────────────────────────────────────────────────────
   URL/hash helpers
───────────────────────────────────────────────────────────── */
function extractHashFromUrlLoose(url: string): string | null {
  const h = parseHashFromUrl(url);
  if (typeof h === "string" && h.length) return h.toLowerCase();
  const m = url.match(/\/s\/([0-9a-f]{32,128})(?:\?|$)/i);
  if (m?.[1]) return m[1].toLowerCase();
  return null;
}

function extractParentHash(payload: Record<string, unknown>): string | undefined {
  const direct = readLowerStr(payload.parentHash);
  if (direct) return direct;

  const parentUrl = readStr(payload.parentUrl);
  if (parentUrl) {
    const ph = extractHashFromUrlLoose(parentUrl);
    if (ph) return ph;
  }
  return undefined;
}

function extractOriginHash(payload: Record<string, unknown>): string | undefined {
  const originUrl = readStr(payload.originUrl);
  if (originUrl) {
    const oh = extractHashFromUrlLoose(originUrl);
    if (oh) return oh;
  }
  return undefined;
}

function toTransferDirection(v: unknown): "send" | "receive" | undefined {
  const s = readStr(v);
  if (s === "send" || s === "receive") return s;
  return undefined;
}

function nodeCompletenessScore(n: Partial<HoneyNode>): number {
  let s = 0;
  const bump = (v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.length === 0) return;
    s += 1;
  };
  bump(n.pulse);
  bump(n.beat);
  bump(n.stepIndex);
  bump(n.chakraDay);
  bump(n.userPhiKey);
  bump(n.kaiSignature);
  bump(n.parentHash);
  bump(n.originHash);
  bump(n.transferDirection);
  bump(n.transferAmountPhi);
  bump(n.phiDelta);
  return s;
}

function pickBestUrlForNode(urls: string[]): string {
  let best = urls[0] ?? "";
  let bestScore = -Infinity;

  for (const raw of urls) {
    const canon = canonicalizeUrl(raw);
    const kind = contentKindForUrl(canon);
    const s = scoreUrlForView(canon, kind);
    if (s > bestScore) {
      bestScore = s;
      best = raw;
    }
  }

  return explorerOpenUrl(best);
}

/* ─────────────────────────────────────────────────────────────
   Build nodes for pulse
───────────────────────────────────────────────────────────── */
function buildNodesForPulse(pulse: number): HoneyNode[] {
  const byHash = new Map<string, HoneyNode>();

  for (const [rawUrl, payloadLoose] of memoryRegistry) {
    if (!isRecord(payloadLoose)) continue;
    const p = readFiniteNumber(payloadLoose.pulse);
    if (p !== pulse) continue;

    const url = canonicalizeUrl(rawUrl);
    const hash = extractHashFromUrlLoose(url);
    if (!hash) continue;

    const partial: Partial<HoneyNode> = {
      hash,
      bestUrl: explorerOpenUrl(url),
      sources: [url],

      pulse: p,
      beat: readFiniteNumber(payloadLoose.beat),
      stepIndex: readFiniteNumber(payloadLoose.stepIndex),
      chakraDay: readStr(payloadLoose.chakraDay),

      userPhiKey: readStr(payloadLoose.userPhiKey),
      kaiSignature: readLowerStr(payloadLoose.kaiSignature),

      parentHash: extractParentHash(payloadLoose),
      originHash: extractOriginHash(payloadLoose),

      transferDirection: toTransferDirection(payloadLoose.transferDirection),
      transferAmountPhi: readStr(payloadLoose.transferAmountPhi),
      phiDelta: readStr(payloadLoose.phiDelta),
    };

    const existing = byHash.get(hash);
    if (!existing) {
      byHash.set(hash, {
        hash,
        bestUrl: partial.bestUrl ?? explorerOpenUrl(url),
        sources: [url],
        pulse: partial.pulse,
        beat: partial.beat,
        stepIndex: partial.stepIndex,
        chakraDay: partial.chakraDay,
        userPhiKey: partial.userPhiKey,
        kaiSignature: partial.kaiSignature,
        parentHash: partial.parentHash,
        originHash: partial.originHash,
        transferDirection: partial.transferDirection,
        transferAmountPhi: partial.transferAmountPhi,
        phiDelta: partial.phiDelta,
        degree: 0,
      });
      continue;
    }

    const mergedSources = new Set<string>(existing.sources);
    mergedSources.add(url);

    const aScore = nodeCompletenessScore(existing);
    const bScore = nodeCompletenessScore(partial);
    const preferIncoming = bScore > aScore;

    byHash.set(hash, {
      ...existing,
      sources: Array.from(mergedSources),
      pulse: existing.pulse ?? partial.pulse,
      beat: preferIncoming && partial.beat !== undefined ? partial.beat : existing.beat ?? partial.beat,
      stepIndex: preferIncoming && partial.stepIndex !== undefined ? partial.stepIndex : existing.stepIndex ?? partial.stepIndex,
      chakraDay: preferIncoming && partial.chakraDay ? partial.chakraDay : existing.chakraDay ?? partial.chakraDay,
      userPhiKey: preferIncoming && partial.userPhiKey ? partial.userPhiKey : existing.userPhiKey ?? partial.userPhiKey,
      kaiSignature: preferIncoming && partial.kaiSignature ? partial.kaiSignature : existing.kaiSignature ?? partial.kaiSignature,
      parentHash: preferIncoming && partial.parentHash ? partial.parentHash : existing.parentHash ?? partial.parentHash,
      originHash: preferIncoming && partial.originHash ? partial.originHash : existing.originHash ?? partial.originHash,
      transferDirection:
        preferIncoming && partial.transferDirection ? partial.transferDirection : existing.transferDirection ?? partial.transferDirection,
      transferAmountPhi:
        preferIncoming && partial.transferAmountPhi ? partial.transferAmountPhi : existing.transferAmountPhi ?? partial.transferAmountPhi,
      phiDelta: preferIncoming && partial.phiDelta ? partial.phiDelta : existing.phiDelta ?? partial.phiDelta,
      bestUrl: existing.bestUrl,
      degree: 0,
    });
  }

  const childrenCount = new Map<string, number>();
  for (const n of byHash.values()) {
    if (!n.parentHash) continue;
    childrenCount.set(n.parentHash, (childrenCount.get(n.parentHash) ?? 0) + 1);
  }

  for (const n of byHash.values()) {
    let deg = 0;
    if (n.parentHash) deg += 1;
    if (n.originHash) deg += 1;
    deg += childrenCount.get(n.hash) ?? 0;
    n.degree = deg;
    n.bestUrl = pickBestUrlForNode(n.sources);
  }

  return Array.from(byHash.values()).sort((a, b) => {
    if (b.degree !== a.degree) return b.degree - a.degree;
    const ab = typeof a.beat === "number" ? a.beat : -1;
    const bb = typeof b.beat === "number" ? b.beat : -1;
    if (bb !== ab) return bb - ab;
    const as = typeof a.stepIndex === "number" ? a.stepIndex : -1;
    const bs = typeof b.stepIndex === "number" ? b.stepIndex : -1;
    if (bs !== as) return bs - as;
    return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
  });
}

/* ─────────────────────────────────────────────────────────────
   Hex layout
───────────────────────────────────────────────────────────── */
const HEX_DIRS: Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function hexSpiralCoords(n: number): Coord[] {
  if (n <= 0) return [];
  const coords: Coord[] = [{ q: 0, r: 0 }];
  let radius = 1;

  while (coords.length < n) {
    let q = HEX_DIRS[4].q * radius;
    let r = HEX_DIRS[4].r * radius;

    for (let d = 0; d < 6 && coords.length < n; d++) {
      const dq = HEX_DIRS[d].q;
      const dr = HEX_DIRS[d].r;
      for (let step = 0; step < radius && coords.length < n; step++) {
        coords.push({ q, r });
        q += dq;
        r += dr;
      }
    }

    radius += 1;
  }

  return coords;
}

function axialToPixelPointy(c: Coord, radiusPx: number): Pt {
  const x = radiusPx * Math.sqrt(3) * (c.q + c.r / 2);
  const y = radiusPx * (3 / 2) * c.r;
  return { x, y };
}

/* ─────────────────────────────────────────────────────────────
   Valuation helpers
───────────────────────────────────────────────────────────── */
function buildValuationMeta(payload: Record<string, unknown>): SigilMetadataLite {
  return {
    pulse: readFiniteNumber(payload.pulse),
    beat: readFiniteNumber(payload.beat),
    stepIndex: readFiniteNumber(payload.stepIndex),
    chakraDay: readStr(payload.chakraDay),
    userPhiKey: readStr(payload.userPhiKey),
    kaiSignature: readLowerStr(payload.kaiSignature),
    transfers: Array.isArray(payload.transfers) ? (payload.transfers as SigilMetadataLite["transfers"]) : undefined,
    segments: Array.isArray(payload.segments) ? (payload.segments as SigilMetadataLite["segments"]) : undefined,
    ip: isRecord(payload.ip) ? (payload.ip as SigilMetadataLite["ip"]) : undefined,
  };
}

function computeLivePhi(payload: Record<string, unknown>, nowPulse: number | null): number | null {
  if (nowPulse == null || !Number.isFinite(nowPulse)) return null;
  try {
    const meta = buildValuationMeta(payload);
    const { unsigned } = computeIntrinsicUnsigned(meta, nowPulse);
    return Number.isFinite(unsigned.valuePhi) ? unsigned.valuePhi : null;
  } catch {
    return null;
  }
}

function computeUsdPerPhi(payload: Record<string, unknown>, nowPulse: number | null): number | null {
  if (nowPulse == null || !Number.isFinite(nowPulse)) return null;
  try {
    const meta = buildValuationMeta(payload);
    const quote = quotePhiForUsd(
      { meta, nowPulse, usd: 100, currentStreakDays: 0, lifetimeUsdSoFar: 0 },
      DEFAULT_ISSUANCE_POLICY,
    );
    return Number.isFinite(quote.usdPerPhi) ? quote.usdPerPhi : null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Media query hook
───────────────────────────────────────────────────────────── */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (!HAS_WINDOW) return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!HAS_WINDOW) return;

    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);

    if ("addEventListener" in mql) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }

    const legacy = mql as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };

    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, [query]);

  return matches;
}

/* ─────────────────────────────────────────────────────────────
   Anchored popover positioning (no React state)
───────────────────────────────────────────────────────────── */
function useAnchoredPopoverPosition(args: {
  enabled: boolean;
  shellRef: React.RefObject<HTMLDivElement | null>;
  anchor?: { x: number; y: number };
}) {
  const { enabled, shellRef, anchor } = args;

  useLayoutEffect(() => {
    if (!HAS_WINDOW) return;
    if (!enabled) return;

    const shell = shellRef.current;
    if (!shell) return;
    if (!anchor) return;

    const margin = 12;
    const gap = 10;

    const place = () => {
      const el = shellRef.current;
      if (!el) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();

      const belowY = anchor.y + gap;
      const aboveY = anchor.y - rect.height - gap;

      const spaceBelow = vh - (belowY + rect.height) - margin;
      const spaceAbove = aboveY - margin;

      const useAbove = spaceBelow < 0 && spaceAbove > spaceBelow;

      const desiredX = anchor.x - rect.width * 0.5;
      const desiredY = useAbove ? aboveY : belowY;

      const x = clamp(desiredX, margin, Math.max(margin, vw - rect.width - margin));
      const y = clamp(desiredY, margin, Math.max(margin, vh - rect.height - margin));

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.transformOrigin = `${Math.max(0, anchor.x - x)}px ${Math.max(0, anchor.y - y)}px`;
      el.setAttribute("data-popover-flip", useAbove ? "above" : "below");
    };

    let raf = window.requestAnimationFrame(place);

    const onRecalc = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(place);
    };

    window.addEventListener("resize", onRecalc, { passive: true });
    window.addEventListener("scroll", onRecalc, { passive: true, capture: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => onRecalc());
      ro.observe(shell);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onRecalc as EventListener);
      window.removeEventListener("scroll", onRecalc as EventListener, true);
      ro?.disconnect();
    };
  }, [enabled, shellRef, anchor?.x, anchor?.y]);
}

/* ─────────────────────────────────────────────────────────────
   Chakra classes
───────────────────────────────────────────────────────────── */
function chakraClass(chakraDay?: string): string {
  const c = (chakraDay ?? "").toLowerCase();
  if (c.includes("root")) return "chakra-root";
  if (c.includes("sacral")) return "chakra-sacral";
  if (c.includes("solar")) return "chakra-solar";
  if (c.includes("heart")) return "chakra-heart";
  if (c.includes("throat")) return "chakra-throat";
  if (c.includes("third") || c.includes("brow")) return "chakra-third";
  if (c.includes("crown")) return "chakra-crown";
  return "chakra-unknown";
}

/* ─────────────────────────────────────────────────────────────
   Interactive Chart + rich tooltip (portal, never clipped)
───────────────────────────────────────────────────────────── */
type UnitMode = "phi" | "usd";

type RichPoint = {
  i: number;
  phi: number;
  usdPerPhi?: number;
  pulse?: number;
};

type TipPayload = {
  i: number;
  pulse?: number;

  valueMode: number;
  valuePhi: number;
  valueUsd: number;

  usdPerPhiPoint?: number;

  hi: number;
  lo: number;

  dFromStart: number;
  dPctFromStart: number;

  points: number;
};

function coerceRichPoints(lineData: ReadonlyArray<unknown>): RichPoint[] {
  const out: RichPoint[] = [];
  for (let idx = 0; idx < lineData.length; idx += 1) {
    const it = lineData[idx];
    if (!isRecord(it)) continue;

    const i = readFiniteNumber(it.i) ?? idx;

    const phi =
      readFiniteNumber(it.value) ??
      readFiniteNumber(it.phi) ??
      readFiniteNumber(it.v) ??
      readFiniteNumber(it.y);

    if (phi == null) continue;

    const usdPerPhi =
      readFiniteNumber(it.usdPerPhi) ??
      readFiniteNumber(it.usd_per_phi) ??
      readFiniteNumber(it.rate) ??
      readFiniteNumber(it.usdRate);

    const pulse = readFiniteNumber(it.pulse) ?? readFiniteNumber(it.x);

    out.push({ i, phi, usdPerPhi: usdPerPhi ?? undefined, pulse: pulse ?? undefined });
  }
  return out;
}

function valueInMode(p: RichPoint, mode: UnitMode, usdPerPhiFallback: number | null): number {
  if (mode === "phi") return p.phi;
  const r = p.usdPerPhi ?? usdPerPhiFallback;
  if (r == null || !Number.isFinite(r)) return NaN;
  return p.phi * r;
}

function buildSvgPathFromValues(values: number[], w: number, h: number, pad: number) {
  const xAtZero = (_k: number) => {
    void _k;
    return 0;
  };
  const yAtZero = (_v: number) => {
    void _v;
    return 0;
  };

  if (values.length < 2) {
    return {
      d: "",
      minV: 0,
      maxV: 0,
      xAt: xAtZero,
      yAt: yAtZero,
    };
  }

  let minV = Infinity;
  let maxV = -Infinity;

  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return {
      d: "",
      minV: 0,
      maxV: 0,
      xAt: xAtZero,
      yAt: yAtZero,
    };
  }

  const span = Math.max(1e-9, maxV - minV);

  const n = values.length;
  const x0 = pad;
  const x1 = w - pad;
  const y0 = pad;
  const y1 = h - pad;

  const xAt = (k: number) => x0 + (k / Math.max(1, n - 1)) * (x1 - x0);
  const yAt = (v: number) => y1 - ((v - minV) / span) * (y1 - y0);

  let d = "";
  for (let k = 0; k < n; k += 1) {
    const v = values[k]!;
    const x = xAt(k);
    const y = yAt(v);
    d += k === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }

  return { d, minV, maxV, xAt, yAt };
}

function formatValue(mode: UnitMode, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (mode === "phi") return `${formatPhiNumber(v)} Φ`;
  return `$${formatUsd(v)}`;
}

function makeTipPayload(args: {
  mode: UnitMode;
  points: RichPoint[];
  values: number[];
  idx: number;
  usdPerPhiFallback: number | null;
  hi: number;
  lo: number;
}): TipPayload | null {
  const { points, values, idx, usdPerPhiFallback, hi, lo } = args;
  if (idx < 0 || idx >= values.length) return null;

  const pointAt = points[idx];
  const valAt = values[idx];

  const firstVal = values[0];
  const vPhi = pointAt?.phi ?? NaN;
  const rate = pointAt?.usdPerPhi ?? usdPerPhiFallback;
  const vUsd = rate != null && Number.isFinite(rate) ? vPhi * rate : NaN;

  const fv = firstVal;
  const dv = Number.isFinite(fv) ? (valAt - fv) : NaN;
  const dp = Number.isFinite(fv) && fv !== 0 ? (dv / Math.abs(fv)) * 100 : NaN;

  return {
    i: pointAt?.i ?? idx,
    pulse: pointAt?.pulse,
    valueMode: valAt,
    valuePhi: vPhi,
    valueUsd: vUsd,
    usdPerPhiPoint: rate ?? undefined,
    hi,
    lo,
    dFromStart: dv,
    dPctFromStart: dp,
    points: values.length,
  };
}

/**
 * Tooltip portal: fixed-position overlay so it NEVER gets clipped by .phmChart overflow.
 */
function ChartTipPortal(props: {
  open: boolean;
  locked: boolean;
  x: number;
  y: number;
  mode: UnitMode;
  tip: TipPayload;
}) {
  const { open, locked, x, y, mode, tip } = props;
  const portalEl = HAS_WINDOW ? document.body : null;
  if (!open || portalEl == null) return null;

  return createPortal(
    <div className={`phmTipPortal ${locked ? "isLocked" : ""}`} style={{ left: `${x}px`, top: `${y}px` }} aria-hidden="true">
      <div className="phmTipInner">
        <div className="phmTipTop">
          <div className="phmTipTitle">{mode === "phi" ? "Asset Value (Φ)" : "Asset Value (USD)"}</div>
          <div className="phmTipIndex">
            {tip.pulse != null ? `Pulse ${Math.trunc(tip.pulse).toLocaleString()}` : `Index ${tip.i}`}
          </div>
        </div>

        <div className="phmTipMain">
          <div className="phmTipBig">{formatValue(mode, tip.valueMode)}</div>
          <div className="phmTipSubRow">
            <span className="phmTipSub">{Number.isFinite(tip.valuePhi) ? `${formatPhiNumber(tip.valuePhi)} Φ` : "—"}</span>
            <span className="phmTipDot">•</span>
            <span className="phmTipSub">{Number.isFinite(tip.valueUsd) ? `$${formatUsd(tip.valueUsd)}` : "—"}</span>
          </div>
        </div>

        <div className="phmTipGrid">
          <div className="phmTipK">Δ</div>
          <div className="phmTipV">
            {Number.isFinite(tip.dFromStart) ? formatValue(mode, tip.dFromStart) : "—"}
            {Number.isFinite(tip.dPctFromStart) ? (
              <span className="phmTipMini">
                {" "}
                ({tip.dPctFromStart >= 0 ? "+" : ""}
                {tip.dPctFromStart.toFixed(2)}%)
              </span>
            ) : null}
          </div>

          <div className="phmTipK">High</div>
          <div className="phmTipV">{formatValue(mode, tip.hi)}</div>

          <div className="phmTipK">Low</div>
          <div className="phmTipV">{formatValue(mode, tip.lo)}</div>

          <div className="phmTipK">USD/Φ</div>
          <div className="phmTipV">
            {tip.usdPerPhiPoint != null && Number.isFinite(tip.usdPerPhiPoint) ? `$${formatUsd(tip.usdPerPhiPoint)}` : "—"}
          </div>

          <div className="phmTipK">Points</div>
          <div className="phmTipV">{tip.points}</div>
        </div>

        <div className="phmTipHint">{locked ? "tap again to unlock" : "tap to lock"}</div>
      </div>
    </div>,
    portalEl,
  );
}

function InteractiveValueChart(props: {
  lineData: ReadonlyArray<unknown>;
  mode: UnitMode;
  usdPerPhiFallback: number | null;
  livePhi: number | null;
  liveUsd: number | null;
  usdPerPhiNow: number | null;
}) {
  const { lineData, mode, usdPerPhiFallback, livePhi, liveUsd, usdPerPhiNow } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);

  const points = useMemo(() => coerceRichPoints(lineData), [lineData]);

  const values = useMemo(() => points.map((p) => valueInMode(p, mode, usdPerPhiFallback)), [points, mode, usdPerPhiFallback]);

  const W = 420;
  const H = 86;
  const PAD = 10;

  const path = useMemo(() => buildSvgPathFromValues(values, W, H, PAD), [values]);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [locked, setLocked] = useState<boolean>(false);

  // tooltip portal position in viewport coords
  const [tipXY, setTipXY] = useState<{ x: number; y: number } | null>(null);

  const n = values.length;
  const idxSafe = hoverIdx != null ? clamp(hoverIdx, 0, Math.max(0, n - 1)) : null;
  const hasTip = idxSafe != null && idxSafe >= 0 && idxSafe < n;

  const firstVal = n > 0 ? values[0]! : null;
  const lastVal = n > 0 ? values[n - 1]! : null;

  const deltaPct = useMemo(() => {
    if (!Number.isFinite(firstVal ?? NaN) || !Number.isFinite(lastVal ?? NaN)) return null;
    const base = Math.abs(firstVal as number);
    if (base <= 0) return null;
    return (((lastVal as number) - (firstVal as number)) / base) * 100;
  }, [firstVal, lastVal]);

  const tipPayload = useMemo(() => {
    if (!hasTip || idxSafe == null) return null;
    return makeTipPayload({
      mode,
      points,
      values,
      idx: idxSafe,
      usdPerPhiFallback,
      hi: path.maxV,
      lo: path.minV,
    });
  }, [hasTip, idxSafe, mode, points, values, usdPerPhiFallback, path.maxV, path.minV]);

  const setFromClientX = (clientX: number) => {
    const el = hostRef.current;
    if (!el) return;
    if (!n) return;

    const rect = el.getBoundingClientRect();
    const xLocal = clamp(clientX - rect.left, 0, rect.width);
    const t = rect.width > 0 ? xLocal / rect.width : 0;
    const idx = Math.round(t * Math.max(0, n - 1));
    setHoverIdx(idx);

    // anchor tooltip above point, but compute in viewport coords
    const vx = path.xAt(idx);
    const vy = path.yAt(values[idx] ?? 0);

    const px = rect.width > 0 ? (vx / W) * rect.width : 0;
    const py = rect.height > 0 ? (vy / H) * rect.height : 0;

    // viewport position
    const tipX = rect.left + px;
    const tipY = rect.top + py;

    setTipXY({ x: tipX, y: tipY });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!n) return;
    if (locked) return;
    setFromClientX(e.clientX);
  };

  const onPointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!n) return;
    if (locked) return;
    setFromClientX(e.clientX);
  };

  const onPointerLeave = () => {
    if (locked) return;
    setHoverIdx(null);
    setTipXY(null);
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!n) return;
    if (locked) {
      setLocked(false);
      setHoverIdx(null);
      setTipXY(null);
      return;
    }
    setLocked(true);
    setFromClientX(e.clientX);
  };

  const livePrimary = mode === "phi" ? (livePhi ?? null) : (liveUsd ?? null);
  const liveLabel = formatValue(mode, Number.isFinite(livePrimary ?? NaN) ? (livePrimary as number) : NaN);

  const usdPerPhiLabel = usdPerPhiNow != null ? `$${formatUsd(usdPerPhiNow)} / Φ` : "—";

  return (
    <>
      <div
        ref={hostRef}
        className={`phmChart phmChart--lite phmChart--interactive ${locked ? "isLocked" : ""}`}
        role="group"
        aria-label="Live value chart"
        onPointerMove={onPointerMove}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
      >
        <div className="phmChartTopRow" aria-hidden="true">
          <span className="phmChartBadge">
            <span className="phmLiveDot" />
            LIVE
          </span>
          <span className="phmTicker">{liveLabel}</span>
          <span className="phmChartHint">{locked ? "tap again to unlock" : "tap to lock"}</span>
        </div>

        <svg className="phmChartSvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="phmLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(191,252,255,0.85)" />
              <stop offset="60%" stopColor="rgba(183,163,255,0.75)" />
              <stop offset="100%" stopColor="rgba(191,252,255,0.55)" />
            </linearGradient>
            <linearGradient id="phmFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(191,252,255,0.18)" />
              <stop offset="70%" stopColor="rgba(191,252,255,0.04)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </linearGradient>
            <filter id="phmGlow" x="-30%" y="-50%" width="160%" height="200%">
              <feGaussianBlur stdDeviation="2.3" result="b" />
              <feColorMatrix
                in="b"
                type="matrix"
                values="
                  1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 .55 0"
              />
            </filter>
          </defs>

          {path.d ? (
            <>
              <path d={`${path.d} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`} fill="url(#phmFill)" opacity="0.9" />
              <path d={path.d} stroke="url(#phmLine)" strokeWidth="3" fill="none" filter="url(#phmGlow)" opacity="0.8" />
              <path d={path.d} stroke="url(#phmLine)" strokeWidth="1.6" fill="none" opacity="0.95" />
              {n > 0 ? (
                <circle className="phmChartDot" cx={path.xAt(n - 1)} cy={path.yAt(values[n - 1] ?? 0)} r="3.2" />
              ) : null}
            </>
          ) : (
            <text x="50%" y="52%" textAnchor="middle" fill="rgba(255,255,255,0.62)" fontSize="12">
              No data
            </text>
          )}
        </svg>

        <div className="phmChartBottomRow" aria-hidden="true">
          <span className="phmChartSub">{usdPerPhiLabel}</span>
          <span className="phmChartChg">
            {deltaPct != null && Number.isFinite(deltaPct) ? `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%` : ""}
          </span>
        </div>
      </div>

      {/* Tooltip is portal-rendered so it can NEVER be under/clipped by chart */}
      <ChartTipPortal
        open={!!(tipPayload && tipXY)}
        locked={locked}
        x={tipXY?.x ?? 0}
        y={tipXY?.y ?? 0}
        mode={mode}
        tip={tipPayload as TipPayload}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hex button (selectable)
───────────────────────────────────────────────────────────── */
const SigilHex = React.memo(function SigilHex(props: {
  node: HoneyNode;
  x: number;
  y: number;
  selected: boolean;
  isOrigin: boolean;
  onClick: () => void;
}) {
  const { node, x, y, selected, isOrigin, onClick } = props;

  const pulseValue = typeof node.pulse === "number" && Number.isFinite(node.pulse) ? node.pulse : 0;
  const sigilPulse = wrapPulseForSigil(pulseValue);
  const kks = deriveKksFromPulse(sigilPulse);
  const chakraDay = normalizeChakraDay(node.chakraDay);
  const sigilKey = `${sigilPulse}:${chakraDay}`;
  const renderSigil = useDeferredSigilRender(sigilKey);
  const depth = (hashToUnit(node.hash) - 0.5) * 220 * PHI;

  const ariaParts: string[] = [];
  if (typeof node.pulse === "number") ariaParts.push(`pulse ${node.pulse}`);
  if (Number.isFinite(kks.beat) && Number.isFinite(kks.stepIndex)) ariaParts.push(`beat ${kks.beat} step ${kks.stepIndex}`);
  if (node.chakraDay) ariaParts.push(node.chakraDay);
  ariaParts.push(shortHash(node.hash, 12));
  const aria = ariaParts.join(" — ");

  return (
    <button
      type="button"
      className={[
        "sigilHex",
        chakraClass(node.chakraDay),
        node.transferDirection ? `xfer-${node.transferDirection}` : "",
        isOrigin ? "isOrigin" : "",
        selected ? "isSelected" : "",
      ].join(" ")}
      style={{ transform: `translate3d(${x}px, ${y}px, ${depth.toFixed(2)}px)` }}
      onClick={onClick}
      aria-label={aria}
      title={aria}
    >
      <div className="sigilHexInner">
        <div className="sigilHexGlyphFrame" aria-hidden="true">
          {renderSigil ? (
            <KaiSigil
              pulse={sigilPulse}
              beat={kks.beat}
              stepIndex={kks.stepIndex}
              stepPct={kks.stepPct}
              chakraDay={chakraDay}
              size={48}
              hashMode="deterministic"
              animate={false}
            />
          ) : (
            <div className="sigilHexGlyphPlaceholder" />
          )}
        </div>

        <div className="sigilHexTop">
          <span className="sigilHexPulse">{typeof node.pulse === "number" ? node.pulse : "—"}</span>
          <span className="sigilHexHash">{shortHash(node.hash)}</span>
        </div>

        <div className="sigilHexMid">
          <span className="sigilHexBeat">
            {kks.beat}:{kks.stepIndex}
          </span>
          <span className="sigilHexDelta">{readStr(node.phiDelta) ?? "—"}</span>
        </div>

        <div className="sigilHexBot">
          <span className="sigilHexChakra">{node.chakraDay || "—"}</span>
        </div>
      </div>
    </button>
  );
});

/* ─────────────────────────────────────────────────────────────
   Modal wrapper
───────────────────────────────────────────────────────────── */
export default function PulseHoneycombModal(props: PulseHoneycombModalProps) {
  const { open, pulse, originUrl, originHash, anchor, registryRev, onClose } = props;

  const shellRef = useRef<HTMLDivElement | null>(null);

  const isCompactSheet = useMediaQuery("(max-width: 720px), (max-height: 720px)");
  const anchored = !!anchor && !isCompactSheet;

  useAnchoredPopoverPosition({
    enabled: open && anchored,
    shellRef,
    anchor,
  });

  // ESC close + focus close
  useEffect(() => {
    if (!HAS_WINDOW) return;
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    window.setTimeout(() => {
      const btn = shellRef.current?.querySelector<HTMLButtonElement>(".phmBtnClose");
      btn?.focus();
    }, 0);

    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // body scroll lock
  useEffect(() => {
    if (!HAS_WINDOW) return;
    if (!open) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open]);

  const portalEl = HAS_WINDOW ? document.body : null;
  if (!open || portalEl == null) return null;

  const key = `${pulse ?? "none"}:${originHash ?? ""}:${originUrl ?? ""}`;

  const backdropClass = [
    "phmBackdrop",
    anchored ? "phmBackdrop--anchored" : "",
    isCompactSheet ? "phmBackdrop--sheet" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const shellClass = [
    "phmShell",
    anchored ? "phmShell--anchored" : "",
    isCompactSheet ? "phmShell--sheet" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return createPortal(
    <div className={backdropClass} role="presentation">
      {!anchored ? (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "auto" }} onMouseDown={() => onClose()} aria-hidden="true" />
      ) : null}

      <div
        ref={shellRef}
        className={shellClass}
        role="dialog"
        aria-modal={!anchored}
        aria-label="Pulse Atlas"
        data-anchored={anchored ? "1" : "0"}
        data-phm-version={PHM_MODAL_VERSION}
      >
        <PulseHoneycombInner
          key={key}
          pulse={pulse}
          originUrl={originUrl}
          originHash={originHash}
          registryRev={registryRev}
          onClose={onClose}
        />
      </div>
    </div>,
    portalEl,
  );
}

/* ─────────────────────────────────────────────────────────────
   Inner view
   - Adds proof strip (PhiKey / KaiSig / Hash) in header-right
   - Tooltip fixed via portal (not clipped)
───────────────────────────────────────────────────────────── */
function PulseHoneycombInner({ pulse, originUrl, originHash, registryRev, onClose }: PulseHoneycombInnerProps) {
  const [edgeMode] = useState<EdgeMode>("parent+children");
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);

  // FIX: unitMode is derived (derived nodes default to USD) + optional user override
  const [unitOverride, setUnitOverride] = useState<UnitMode | null>(null);

  const [nowPulse, setNowPulse] = useState(() => getKaiPulseEternalInt(new Date()));

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [vpSize, setVpSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [userInteracted, setUserInteracted] = useState<boolean>(false);
  const [userPan, setUserPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const dragRef = useRef<{ active: boolean; x0: number; y0: number; panX0: number; panY0: number }>({
    active: false,
    x0: 0,
    y0: 0,
    panX0: 0,
    panY0: 0,
  });

  useEffect(() => {
    if (!HAS_WINDOW) return;
    const tick = () => setNowPulse(getKaiPulseEternalInt(new Date()));
    const id = window.setInterval(tick, 6000);
    return () => window.clearInterval(id);
  }, []);

  // ResizeObserver
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setVpSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activePulse = typeof pulse === "number" ? pulse : null;
  void registryRev;

  const nodesRaw = useMemo(() => {
    if (activePulse == null) return [];
    return buildNodesForPulse(activePulse);
  }, [activePulse, registryRev]);

  const originCandidate = useMemo(() => {
    return (originHash ?? (originUrl ? extractHashFromUrlLoose(originUrl) : null)) ?? null;
  }, [originHash, originUrl]);

  const byHash = useMemo(() => {
    const m = new Map<string, HoneyNode>();
    for (const n of nodesRaw) m.set(n.hash, n);
    return m;
  }, [nodesRaw]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of nodesRaw) {
      if (!n.parentHash) continue;
      const arr = m.get(n.parentHash) ?? [];
      arr.push(n.hash);
      m.set(n.parentHash, arr);
    }
    return m;
  }, [nodesRaw]);

  const computedInitialHash = useMemo(() => {
    if (nodesRaw.length === 0) return null;
    if (originCandidate && byHash.has(originCandidate)) return originCandidate;

    let best: HoneyNode | null = null;
    for (const n of nodesRaw) {
      if (!best) best = n;
      else if (n.degree > best.degree) best = n;
    }
    return best?.hash ?? nodesRaw[0]!.hash;
  }, [nodesRaw, originCandidate, byHash]);

  const selectedHash = useMemo(() => {
    const ov = selectedOverride ? selectedOverride.toLowerCase() : null;
    if (ov && byHash.has(ov)) return ov;
    return computedInitialHash;
  }, [selectedOverride, byHash, computedInitialHash]);

  const selected = useMemo(() => (selectedHash ? byHash.get(selectedHash) ?? null : null), [selectedHash, byHash]);
  const selectedIsDerived = !!selected?.originHash;

  // FIX: Derived default + optional user override (no effect / no cascade)
  const unitMode: UnitMode = unitOverride ?? (selectedIsDerived ? "usd" : "phi");

  const activeMoment = useMemo(() => (activePulse != null ? momentFromPulse(activePulse) : null), [activePulse]);
  const activePulseLabel = activePulse != null ? activePulse.toLocaleString() : "—";
  const activeChakraDay = activeMoment?.chakraDay ?? "Root";
  const beatLabel = activeMoment?.beat ?? "—";
  const stepLabel = activeMoment?.stepIndex ?? "—";

  // Prefer identity from selected node; fallback to any payload in this pulse that has it.
  const headerIdentity = useMemo(() => {
    const selPhi = selected?.userPhiKey ? selected.userPhiKey : undefined;
    const selSig = selected?.kaiSignature ? selected.kaiSignature : undefined;
    if (selPhi || selSig) {
      return { userPhiKey: selPhi, kaiSignature: selSig, hash: selected?.hash ?? null };
    }

    if (activePulse == null) return { userPhiKey: undefined, kaiSignature: undefined, hash: null };

    let best: { userPhiKey?: string; kaiSignature?: string } | null = null;
    let bestScore = -1;

    for (const [, payloadLoose] of memoryRegistry) {
      if (!isRecord(payloadLoose)) continue;
      const p = readFiniteNumber(payloadLoose.pulse);
      if (p !== activePulse) continue;

      const pk = readStr(payloadLoose.userPhiKey);
      const ks = readLowerStr(payloadLoose.kaiSignature);
      const s = (pk ? 1 : 0) + (ks ? 1 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = { userPhiKey: pk, kaiSignature: ks };
      }
      if (bestScore >= 2) break;
    }

    return { userPhiKey: best?.userPhiKey, kaiSignature: best?.kaiSignature, hash: selected?.hash ?? null };
  }, [selected?.userPhiKey, selected?.kaiSignature, selected?.hash, activePulse]);

  const pulseValue = useMemo(() => {
    if (activePulse == null) return { phi: null, usd: null, usdPerPhi: null };

    let phiTotal = 0;
    let usdPerPhi: number | null = null;

    for (const [, payloadLoose] of memoryRegistry) {
      if (!isRecord(payloadLoose)) continue;
      const p = readFiniteNumber(payloadLoose.pulse);
      if (p !== activePulse) continue;

      const payloadPulse = readFiniteNumber(payloadLoose.pulse) ?? activePulse;
      const isDerived = extractOriginHash(payloadLoose) != null;
      const phiValue = computeLivePhi(payloadLoose, isDerived ? payloadPulse : nowPulse);
      if (phiValue != null) phiTotal += phiValue;

      if (usdPerPhi == null) {
        const found = computeUsdPerPhi(payloadLoose, nowPulse);
        if (found != null) usdPerPhi = found;
      }
    }

    const phi = Number.isFinite(phiTotal) ? phiTotal : null;
    const usd = phi != null && usdPerPhi != null ? phi * usdPerPhi : null;
    return { phi, usd, usdPerPhi };
  }, [activePulse, nowPulse, registryRev]);

  type ChartBundle = ReturnType<typeof bootstrapSeries>;

  const chartBundle = useMemo<ChartBundle | null>(() => {
    if (activePulse == null || nowPulse == null) return null;
    let payload: Record<string, unknown> | null = null;

    for (const [, payloadLoose] of memoryRegistry) {
      if (!isRecord(payloadLoose)) continue;
      const p = readFiniteNumber(payloadLoose.pulse);
      if (p !== activePulse) continue;
      payload = payloadLoose;
      break;
    }
    if (!payload) return null;

    const meta = buildValuationMeta(payload);
    const { unsigned } = computeIntrinsicUnsigned(meta, nowPulse);

    const seal = {
      version: 1,
      unit: "Φ",
      algorithm: "phi/kosmos-vφ-5",
      policyChecksum: unsigned.policyChecksum,
      valuePhi: unsigned.valuePhi,
      premium: unsigned.premium,
      inputs: unsigned.inputs,
      computedAtPulse: unsigned.computedAtPulse,
      headRef: unsigned.headRef,
      stamp: "0",
    } as const;

    return bootstrapSeries(seal, meta, nowPulse, 64);
  }, [activePulse, nowPulse, registryRev]);

  const layout = useMemo(() => {
    const N = nodesRaw.length;
    const coords = hexSpiralCoords(N);

    const radiusPx = Math.round(30 * PHI);
    const pts: Pt[] = coords.map((c) => axialToPixelPointy(c, radiusPx));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const hexW = Math.sqrt(3) * radiusPx;
    const hexH = 2 * radiusPx;
    const pad = 120;

    const offX = (Number.isFinite(minX) ? -minX : 0) + pad;
    const offY = (Number.isFinite(minY) ? -minY : 0) + pad;

    const items: LayoutItem[] = nodesRaw.map((node, i) => {
      const p = pts[i] ?? { x: 0, y: 0 };
      const x = p.x + offX - hexW / 2;
      const y = p.y + offY - hexH / 2;
      const cx = p.x + offX;
      const cy = p.y + offY;
      return { node, x, y, cx, cy };
    });

    const width = (Number.isFinite(maxX - minX) ? maxX - minX : 0) + pad * 2 + hexW;
    const height = (Number.isFinite(maxY - minY) ? maxY - minY : 0) + pad * 2 + hexH;

    const itemByHash = new Map<string, LayoutItem>();
    for (const it of items) itemByHash.set(it.node.hash, it);

    const centerOf = (hash: string | null): Pt | null => {
      if (!hash) return null;
      const it = itemByHash.get(hash);
      return it ? { x: it.cx, y: it.cy } : null;
    };

    return { width, height, items, itemByHash, centerOf };
  }, [nodesRaw]);

  const autoPan = useMemo(() => {
    if (!selectedHash) return { x: 0, y: 0 };
    if (!vpSize.w || !vpSize.h) return { x: 0, y: 0 };
    const c = layout.centerOf(selectedHash);
    if (!c) return { x: 0, y: 0 };
    return { x: vpSize.w / 2 - c.x * zoom, y: vpSize.h / 2 - c.y * zoom };
  }, [selectedHash, vpSize.w, vpSize.h, layout, zoom]);

  const pan = userInteracted ? userPan : autoPan;

  const edgeLines = useMemo<EdgeLine[]>(() => {
    if (!selectedHash) return [];
    if (edgeMode === "none") return [];

    const selItem = layout.itemByHash.get(selectedHash);
    const sel = byHash.get(selectedHash);
    if (!selItem || !sel) return [];

    const lines: EdgeLine[] = [];
    const addLine = (toHash: string | undefined, kind: EdgeLine["kind"]) => {
      if (!toHash) return;
      const tgt = layout.itemByHash.get(toHash);
      if (!tgt) return;
      lines.push({ x1: selItem.cx, y1: selItem.cy, x2: tgt.cx, y2: tgt.cy, kind });
    };

    if (edgeMode === "parent" || edgeMode === "parent+children" || edgeMode === "all") addLine(sel.parentHash, "parent");
    if (edgeMode === "parent+children" || edgeMode === "all") {
      const kids = childrenByParent.get(sel.hash) ?? [];
      for (const k of kids) addLine(k, "child");
    }
    if (edgeMode === "all") addLine(sel.originHash, "origin");

    return lines;
  }, [selectedHash, edgeMode, layout, byHash, childrenByParent]);

  const selectHash = (hash: string) => {
    const h = hash.toLowerCase();
    setSelectedOverride(h);

    // FIX: reset override so the new selection uses its default (derived→USD, root→Φ)
    setUnitOverride(null);

    broadcastSelectedHash(h);
    setUserInteracted(false);
    setUserPan({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;

    const nextZoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.35, 3.0);

    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const curPan = pan;
    const worldX = (mx - curPan.x) / zoom;
    const worldY = (my - curPan.y) / zoom;

    const nextPanX = mx - worldX * nextZoom;
    const nextPanY = my - worldY * nextZoom;

    setZoom(nextZoom);
    setUserInteracted(true);
    setUserPan({ x: nextPanX, y: nextPanY });

    void worldY;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof HTMLElement && e.target.closest(".sigilHex")) return;

    setUserInteracted(true);
    dragRef.current = { active: true, x0: e.clientX, y0: e.clientY, panX0: pan.x, panY0: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x0;
    const dy = e.clientY - dragRef.current.y0;
    setUserPan({ x: dragRef.current.panX0 + dx, y: dragRef.current.panY0 + dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      ignore();
    }
  };

  const openSelected = () => {
    if (!selected) return;
    window.open(selected.bestUrl, "_blank", "noopener,noreferrer");
  };

  const rememberSelected = async () => {
    if (!selected) return;
    await copyText(selected.bestUrl);
  };

  const toggleUnit = () => {
    setUnitOverride((cur) => {
      const base: UnitMode = cur ?? (selectedIsDerived ? "usd" : "phi");
      return base === "phi" ? "usd" : "phi";
    });
  };

  const mainValue =
    unitMode === "phi"
      ? pulseValue.phi != null
        ? `${formatPhiNumber(pulseValue.phi)} Φ`
        : "—"
      : pulseValue.usd != null
        ? `$${formatUsd(pulseValue.usd)}`
        : "—";

  const subValue =
    unitMode === "phi"
      ? pulseValue.usd != null
        ? `$${formatUsd(pulseValue.usd)}`
        : "—"
      : pulseValue.phi != null
        ? `${formatPhiNumber(pulseValue.phi)} Φ`
        : "—";

  const rateLabel = pulseValue.usdPerPhi != null ? `$${formatUsd(pulseValue.usdPerPhi)} / Φ` : "—";

  const proofPhiKey = headerIdentity.userPhiKey;
  const proofKaiSig = headerIdentity.kaiSignature;
  const proofHash = selected?.hash ?? null;

  return (
    <div className="phmRoot" aria-label="Pulse Atlas" data-phm-version={PHM_MODAL_VERSION}>
      <header className="phmHeader">
        <div className="phmHeaderLeft">
          <div className="phmSigilCard" aria-label="Pulse sigil glyph">
            <div className="phmSigilFrame">
              {activePulse != null ? (
                <KaiSigil pulse={activePulse} chakraDay={activeChakraDay} size={56} animate />
              ) : (
                <div className="phmSigilPlaceholder" />
              )}
            </div>
            <div className="phmSigilMeta">
              <div className="phmSigilPulse">☤KAI {activePulseLabel}</div>
              <div className="phmSigilSub">
                <span>Beat {beatLabel}</span>
                <span className="phmDot">•</span>
                <span>Step {stepLabel}</span>
                <span className="phmDot">•</span>
                <span>{activeChakraDay}</span>
              </div>
            </div>
          </div>

          {/* Value card: click to toggle Φ <-> USD */}
          <button type="button" className="phmValueCard phmValueCard--switch" onClick={toggleUnit} aria-label="Toggle value unit">
            <div className="phmValueLabel">Asset Value</div>
            <div className="phmValuePrimary">{mainValue}</div>
            <div className="phmValueSecondary">{subValue}</div>
            <div className="phmValueMeta">{rateLabel}</div>
          </button>

          <div className="phmHeaderStack">
            <div className="phmChartWrap" aria-label="Asset value chart">
              {chartBundle ? (
                <InteractiveValueChart
                  lineData={chartBundle.lineData as unknown as ReadonlyArray<unknown>}
                  mode={unitMode}
                  usdPerPhiFallback={pulseValue.usdPerPhi}
                  livePhi={pulseValue.phi}
                  liveUsd={pulseValue.usd}
                  usdPerPhiNow={pulseValue.usdPerPhi}
                />
              ) : (
                <div className="phmChart phmChart--lite phmChartEmpty">No pulse data</div>
              )}
            </div>
          </div>
        </div>

        {/* Header Right: Proof strip + Close */}
        <div className="phmHeaderRight">
          <div className="phmProofStrip" aria-label="Proof details">
            {proofHash ? (
              <button type="button" className="phmProofItem" onClick={() => copyText(proofHash)} title={proofHash}>
                <span className="phmProofK">Key</span>
                <span className="phmProofV mono">{shortHash(proofHash, 16)}</span>
              </button>
            ) : null}

            {proofPhiKey ? (
              <button type="button" className="phmProofItem" onClick={() => copyText(proofPhiKey)} title={proofPhiKey}>
                <span className="phmProofK">ΦKey</span>
                <span className="phmProofV mono">{shortHash(proofPhiKey, 18)}</span>
              </button>
            ) : null}

            {proofKaiSig ? (
              <button type="button" className="phmProofItem" onClick={() => copyText(proofKaiSig)} title={proofKaiSig}>
                <span className="phmProofK">KaiSig</span>
                <span className="phmProofV mono">{shortHash(proofKaiSig, 18)}</span>
              </button>
            ) : null}
          </div>

          <button type="button" className="phmBtn phmBtnClose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      <div className="phmBody">
        <div className="phmCombPanel">
          <div
            className="phmViewport combViewport"
            ref={viewportRef}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="combInner"
              style={{
                width: `${layout.width}px`,
                height: `${layout.height}px`,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <svg className="combEdges" width={layout.width} height={layout.height} aria-hidden="true">
                {edgeLines.map((ln, i) => (
                  <line
                    key={`${ln.kind}-${i}`}
                    x1={ln.x1}
                    y1={ln.y1}
                    x2={ln.x2}
                    y2={ln.y2}
                    className={`edgeLine edge-${ln.kind}`}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {layout.items.map((it) => (
                <SigilHex
                  key={it.node.hash}
                  node={it.node}
                  x={it.x}
                  y={it.y}
                  isOrigin={originCandidate != null && it.node.hash === originCandidate}
                  selected={it.node.hash === selectedHash}
                  onClick={() => selectHash(it.node.hash)}
                />
              ))}
            </div>

            <div className="combHint phmHint">Pulse lattice • drag to pan • scroll to zoom</div>
          </div>
        </div>
      </div>

      {/* Slim bottom bar */}
      <footer className="phmBottomBar" aria-label="Actions">
        <div className="phmSelChip" title={selected?.hash ?? ""}>
          <span className="phmSelLabel">SEL</span>
          <span className="phmSelHash">{selected ? shortHash(selected.hash, 18) : "—"}</span>
        </div>

        <div className="phmBottomActions">
          <button type="button" className="phmMiniBtn" onClick={openSelected} disabled={!selected}>
            Proof of Breath™
          </button>
          <button type="button" className="phmMiniBtn phmMiniBtn--glow" onClick={rememberSelected} disabled={!selected}>
            Remember
          </button>
        </div>
      </footer>
    </div>
  );
}
