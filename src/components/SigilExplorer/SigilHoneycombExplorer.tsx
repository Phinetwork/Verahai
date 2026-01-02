"use client";

import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./SigilHoneycomb.css";

/* ─────────────────────────────────────────────────────────────
   Shared Sovereign Modules (same ones SigilExplorer uses)
───────────────────────────────────────────────────────────── */
import {
  memoryRegistry,
  addUrl,
  ensureRegistryHydrated,
  persistRegistryToStorage,
  REGISTRY_LS_KEY,
  MODAL_FALLBACK_LS_KEY,
  isOnline,
} from "./registryStore";

import {
  canonicalizeUrl,
  browserViewUrl,
  explorerOpenUrl,
  contentKindForUrl,
  scoreUrlForView,
  parseHashFromUrl,
} from "./url";

import { flushInhaleQueue, loadInhaleQueueFromStorage, saveInhaleQueueToStorage, seedInhaleFromRegistry } from "./inhaleQueue";

import { pullAndImportRemoteUrls } from "./remotePull";

import {
  apiFetchWithFailover,
  API_SEAL_PATH,
  type ApiSealResponse,
  loadApiBackupDeadUntil,
  loadApiBaseHint,
} from "./apiClient";

import { loadUrlHealthFromStorage } from "./urlHealth";
import { N_DAY_MICRO, latticeFromMicroPulses, normalizePercentIntoStep } from "../../utils/kai_pulse";

/* ─────────────────────────────────────────────────────────────
   Types (strict)
───────────────────────────────────────────────────────────── */

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

  receiverKaiPulse?: number;

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

type SyncReason = "open" | "pulse" | "visible" | "focus" | "online" | "import";

export type SigilHoneycombExplorerProps = {
  className?: string;
  sort?: "pulseDesc" | "pulseAsc" | "degreeDesc";
  maxNodes?: number;
  edgeMode?: EdgeMode;
  syncMode?: "standalone" | "embedded";
  onOpenPulseView?: (payload: { pulse: number; originHash?: string; anchor?: { x: number; y: number } }) => void;
};

/* ─────────────────────────────────────────────────────────────
   Constants / utils
───────────────────────────────────────────────────────────── */

const HAS_WINDOW = typeof window !== "undefined";

const SIGIL_EXPLORER_OPEN_EVENT = "sigil:explorer:open";
const SIGIL_EXPLORER_CHANNEL_NAME = "sigil:explorer:bc:v1";

const SIGIL_SELECT_CHANNEL_NAME = "sigil:explorer:select:bc:v1";
const SIGIL_SELECT_LS_KEY = "sigil:explorer:selectedHash:v1";
const ONE_PULSE_MICRO = 1_000_000n;

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

const hashToRgb = (hash: string): string => {
  const unit = hashToUnit(hash);
  const unit2 = hashToUnit(hash.split("").reverse().join(""));
  const unit3 = hashToUnit(`${hash}phi`);
  const r = Math.floor(80 + unit * 175);
  const g = Math.floor(80 + unit2 * 175);
  const b = Math.floor(80 + unit3 * 175);
  return `${r} ${g} ${b}`;
};


const HEX_DIRS: Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ignore(): void {
  // Intentionally ignored (best-effort behavior).
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

function readNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function safeJsonParse(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    ignore();
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    ignore();
  }
}

function toTransferDirection(v: unknown): "send" | "receive" | undefined {
  const s = readStr(v);
  if (s === "send" || s === "receive") return s;
  return undefined;
}

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

function chakraShapeClass(chakraDay?: string): string | null {
  const c = (chakraDay ?? "").toLowerCase();
  if (c.includes("root")) return "shape-root";
  if (c.includes("sacral")) return "shape-sacral";
  if (c.includes("solar")) return "shape-solar";
  if (c.includes("heart")) return "shape-heart";
  if (c.includes("throat")) return "shape-throat";
  if (c.includes("third") || c.includes("brow")) return "shape-third";
  if (c.includes("crown")) return "shape-crown";
  return null;
}

function shortHash(h: string, n = 10): string {
  return h.length <= n ? h : h.slice(0, n);
}

function formatPhi(v?: string): string {
  if (!v) return "—";
  return v.startsWith("-") ? v : `+${v}`;
}

/* ─────────────────────────────────────────────────────────────
   Hash / edge helpers (parity with explorer payload fields)
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
  bump(n.receiverKaiPulse);

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

function buildNodesFromRegistry(maxNodes: number, sort: "pulseDesc" | "pulseAsc" | "degreeDesc"): HoneyNode[] {
  const byHash = new Map<string, HoneyNode>();

  for (const [rawUrl, payloadLoose] of memoryRegistry) {
    const url = canonicalizeUrl(rawUrl);
    const hash = extractHashFromUrlLoose(url);
    if (!hash) continue;

    const payload = isRecord(payloadLoose) ? payloadLoose : ({} as Record<string, unknown>);

    const partial: Partial<HoneyNode> = {
      hash,
      bestUrl: explorerOpenUrl(url),

      pulse: readNum(payload.pulse),
      beat: readNum(payload.beat),
      stepIndex: readNum(payload.stepIndex),
      chakraDay: readStr(payload.chakraDay),

      userPhiKey: readStr(payload.userPhiKey),
      kaiSignature: readLowerStr(payload.kaiSignature),

      parentHash: extractParentHash(payload),
      originHash: extractOriginHash(payload),

      transferDirection: toTransferDirection(payload.transferDirection),
      transferAmountPhi: readStr(payload.transferAmountPhi),
      phiDelta: readStr(payload.phiDelta),

      receiverKaiPulse: readNum(payload.receiverKaiPulse),
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
        receiverKaiPulse: partial.receiverKaiPulse,
        degree: 0,
      });
      continue;
    }

    const mergedSources = new Set<string>(existing.sources);
    mergedSources.add(url);

    const aScore = nodeCompletenessScore(existing);
    const bScore = nodeCompletenessScore(partial);
    const preferIncoming = bScore > aScore;

    const merged: HoneyNode = {
      ...existing,
      sources: Array.from(mergedSources),
      bestUrl: existing.bestUrl,

      pulse: preferIncoming && partial.pulse !== undefined ? partial.pulse : existing.pulse ?? partial.pulse,
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

      receiverKaiPulse:
        preferIncoming && partial.receiverKaiPulse !== undefined
          ? partial.receiverKaiPulse
          : existing.receiverKaiPulse ?? partial.receiverKaiPulse,
      degree: 0,
    };

    byHash.set(hash, merged);
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

  const withPulse = (n: HoneyNode) => (typeof n.pulse === "number" ? n.pulse : -1);

  const sorted = Array.from(byHash.values()).sort((a, b) => {
    if (sort === "degreeDesc") {
      if (b.degree !== a.degree) return b.degree - a.degree;
      return withPulse(b) - withPulse(a);
    }
    if (sort === "pulseAsc") return withPulse(a) - withPulse(b);
    return withPulse(b) - withPulse(a);
  });

  return sorted.slice(0, maxNodes);
}

/* ─────────────────────────────────────────────────────────────
   Honeycomb geometry (stable spiral)
───────────────────────────────────────────────────────────── */

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
   Remote sync helpers (LahMahTor parity)
───────────────────────────────────────────────────────────── */

function readRemotePulse(body: ApiSealResponse): number | undefined {
  const rec = body as unknown as Record<string, unknown>;
  const p = rec.pulse ?? rec.latestPulse ?? rec.latest_pulse;
  return readNum(p);
}

type PullResult = { pulled: boolean; imported: number; remoteSeal?: string | null };
function isPullResult(v: unknown): v is PullResult {
  if (!isRecord(v)) return false;
  return typeof v.pulled === "boolean" && typeof v.imported === "number";
}

/* ─────────────────────────────────────────────────────────────
   UI: Hex cell
───────────────────────────────────────────────────────────── */

const SigilHex = React.memo(function SigilHex(props: {
  node: HoneyNode;
  x: number;
  y: number;
  selected: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { node, x, y, selected, onClick } = props;

  const pulseValue =
    typeof node.pulse === "number" && Number.isFinite(node.pulse) ? node.pulse : 0;
  const sigilPulse = wrapPulseForSigil(pulseValue);
  const kks = deriveKksFromPulse(sigilPulse);
  const depth = (hashToUnit(node.hash) - 0.5) * 220 * PHI;
  const shapeIndex = Math.floor(hashToUnit(node.hash) * 6);
  const shapeClass = chakraShapeClass(node.chakraDay) ?? `shape-${shapeIndex}`;
  const fallbackTint = node.chakraDay ? undefined : hashToRgb(node.hash);

  const ariaParts: string[] = [];
  if (typeof node.pulse === "number") ariaParts.push(`pulse ${node.pulse}`);
  if (Number.isFinite(kks.beat) && Number.isFinite(kks.stepIndex)) {
    ariaParts.push(`beat ${kks.beat} step ${kks.stepIndex}`);
  }
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
        selected ? "isSelected" : "",
      ].join(" ")}
      style={{ transform: `translate3d(${x}px, ${y}px, ${depth.toFixed(2)}px)` }}
      onClick={onClick}
      aria-label={aria}
      title={aria}
    >
      <div className="sigilHexInner">
        <div className="sigilHexGlyphFrame" aria-hidden="true">
          <div
            className={`sigilHexGlyphSimple ${shapeClass}`}
            style={fallbackTint ? ({ ["--hex-tint" as string]: fallbackTint } as React.CSSProperties) : undefined}
          />
        </div>
        <div className="sigilHexTop">
          <span className="sigilHexPulse">{typeof node.pulse === "number" ? node.pulse : "—"}</span>
          <span className="sigilHexHash">{shortHash(node.hash)}</span>
        </div>
        <div className="sigilHexMid">
          <span className="sigilHexBeat">
            {kks.beat}:{kks.stepIndex}
          </span>
          <span className="sigilHexDelta">{formatPhi(node.phiDelta)}</span>
        </div>
        <div className="sigilHexBot">
          <span className="sigilHexChakra">{node.chakraDay || "—"}</span>
        </div>
      </div>
    </button>
  );
});

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */

export default function SigilHoneycombExplorer({
  className,
  sort = "pulseDesc",
  maxNodes = 1400,
  edgeMode: edgeModeProp = "all",
  syncMode = "standalone",
  onOpenPulseView,
}: SigilHoneycombExplorerProps) {
  const allowNetworkSync = syncMode === "standalone";
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(edgeModeProp);
  const [query, setQuery] = useState<string>("");

  const [registryRev, setRegistryRev] = useState<number>(() => (ensureRegistryHydrated() ? 1 : 0));
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [vpSize, setVpSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number>(0.6);
  const [rotation, setRotation] = useState<{ x: number; y: number; z: number }>({ x: -18, y: 0, z: 0 });

  const [userInteracted, setUserInteracted] = useState<boolean>(false);
  const [userPan, setUserPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const dragRef = useRef<{
    active: boolean;
    mode: "pan" | "rotate";
    x0: number;
    y0: number;
    panX0: number;
    panY0: number;
    rotX0: number;
    rotY0: number;
    rotZ0: number;
  }>({
    active: false,
    mode: "pan",
    x0: 0,
    y0: 0,
    panX0: 0,
    panY0: 0,
    rotX0: 0,
    rotY0: 0,
    rotZ0: 0,
  });

  const remoteSealRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);

  const selectChannelRef = useRef<BroadcastChannel | null>(null);

  const bumpRegistry = useCallback(() => {
    startTransition(() => setRegistryRev((v) => v + 1));
  }, []);

  /* ─────────────────────────────────────────────────────────────
     Subscriptions / hydration (same signals as SigilExplorer)
  ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!HAS_WINDOW) return;

    if (allowNetworkSync) {
      loadApiBackupDeadUntil();
      loadApiBaseHint();
      loadInhaleQueueFromStorage();
    }
    loadUrlHealthFromStorage();

    const hydrated = ensureRegistryHydrated();
    if (hydrated) bumpRegistry();

    window.dispatchEvent(new Event(SIGIL_EXPLORER_OPEN_EVENT));

    selectChannelRef.current = "BroadcastChannel" in window ? new BroadcastChannel(SIGIL_SELECT_CHANNEL_NAME) : null;

    const onSelectMsg = (ev: MessageEvent) => {
      const data = ev.data as unknown;
      if (!isRecord(data)) return;
      const t = readStr(data.type);
      if (t !== "sigil:select") return;
      const h = readLowerStr(data.hash);
      if (!h) return;
      setSelectedOverride(h);
    };
    selectChannelRef.current?.addEventListener("message", onSelectMsg);

    const onStorage = (ev: StorageEvent) => {
      if (!ev.key || !ev.newValue) return;

      if (ev.key === SIGIL_SELECT_LS_KEY) {
        const h = readLowerStr(ev.newValue);
        if (h) setSelectedOverride(h);
        return;
      }

      const isRegistryKey = ev.key === REGISTRY_LS_KEY;
      const isModalKey = ev.key === MODAL_FALLBACK_LS_KEY;
      if (!isRegistryKey && !isModalKey) return;

      try {
        const parsed = safeJsonParse(ev.newValue);
        if (!Array.isArray(parsed)) return;

        let changed = false;
        for (const u of parsed) {
          if (typeof u !== "string") continue;
          if (
            addUrl(u, {
              includeAncestry: true,
              broadcast: false,
              persist: false,
              source: "local",
              enqueueToApi: allowNetworkSync,
            })
          ) {
            changed = true;
          }
        }

        if (changed) {
          persistRegistryToStorage();
          bumpRegistry();
        }
      } catch {
        ignore();
      }
    };
    window.addEventListener("storage", onStorage);

    const explorerChannel = "BroadcastChannel" in window ? new BroadcastChannel(SIGIL_EXPLORER_CHANNEL_NAME) : null;

    const onExplorerMsg = (ev: MessageEvent) => {
      const data = ev.data as unknown;
      if (!isRecord(data)) return;
      const t = readStr(data.type);
      if (t !== "sigil:add") return;
      const u = readStr(data.url);
      if (!u) return;

      const changed = addUrl(u, {
        includeAncestry: true,
        broadcast: false,
        persist: true,
        source: "local",
        enqueueToApi: allowNetworkSync,
      });
      if (changed) bumpRegistry();
    };
    explorerChannel?.addEventListener("message", onExplorerMsg);

    const onUrlRegistered = (e: Event) => {
      const ce = e as CustomEvent<{ url?: unknown }>;
      const u = typeof ce.detail?.url === "string" ? ce.detail.url : "";
      if (!u) return;
      const changed = addUrl(u, {
        includeAncestry: true,
        broadcast: true,
        persist: true,
        source: "local",
        enqueueToApi: allowNetworkSync,
      });
      if (changed) bumpRegistry();
    };

    const onMinted = (e: Event) => {
      const ce = e as CustomEvent<{ url?: unknown }>;
      const u = typeof ce.detail?.url === "string" ? ce.detail.url : "";
      if (!u) return;
      const changed = addUrl(u, {
        includeAncestry: true,
        broadcast: true,
        persist: true,
        source: "local",
        enqueueToApi: allowNetworkSync,
      });
      if (changed) bumpRegistry();
    };

    window.addEventListener("sigil:url-registered", onUrlRegistered as EventListener);
    window.addEventListener("sigil:minted", onMinted as EventListener);

    const onPageHide = () => {
      if (!allowNetworkSync) return;
      saveInhaleQueueToStorage();
      void flushInhaleQueue();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sigil:url-registered", onUrlRegistered as EventListener);
      window.removeEventListener("sigil:minted", onMinted as EventListener);
      window.removeEventListener("pagehide", onPageHide);

      explorerChannel?.removeEventListener("message", onExplorerMsg);
      explorerChannel?.close();

      selectChannelRef.current?.removeEventListener("message", onSelectMsg);
      selectChannelRef.current?.close();
      selectChannelRef.current = null;
    };
  }, [allowNetworkSync, bumpRegistry]);

  /* ResizeObserver */
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

  /* ─────────────────────────────────────────────────────────────
     LahMahTor breath sync (standalone mode only)
  ────────────────────────────────────────────────────────────── */

  const inhaleOnce = useCallback(async (reason: SyncReason) => {
    if (!isOnline()) return;
    if (syncMode !== "standalone") return;

    seedInhaleFromRegistry();

    if (reason === "pulse") {
      await flushInhaleQueue();
      return;
    }

    await flushInhaleQueue();
  }, [syncMode]);

  const exhaleOnce = useCallback(
    async (reason: SyncReason, signal: AbortSignal) => {
      if (!isOnline()) return;
      if (syncMode !== "standalone") return;
      if (syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      try {
        const res = await apiFetchWithFailover(
          (base) => new URL(API_SEAL_PATH, base).toString(),
          { method: "GET", cache: "no-store", signal, headers: undefined },
        );

        if (!res || !res.ok) return;

        let nextSeal = "";
        let remotePulse: number | undefined;

        try {
          const body = (await res.json()) as ApiSealResponse;
          const rec = body as unknown as Record<string, unknown>;
          nextSeal = typeof rec.seal === "string" ? rec.seal : "";
          remotePulse = readRemotePulse(body);
        } catch {
          ignore();
          return;
        }

        const prevSeal = remoteSealRef.current;
        const localLatestPulse = remotePulse != null ? getLatestPulseFromRegistryLocal() : undefined;
        const hasNewerPulse = remotePulse != null && (localLatestPulse == null || remotePulse > localLatestPulse);

        if (prevSeal && nextSeal && prevSeal === nextSeal && !hasNewerPulse && reason === "pulse") {
          remoteSealRef.current = nextSeal;
          return;
        }

        const pullRes: unknown = await pullAndImportRemoteUrls(signal);

        if (isPullResult(pullRes)) {
          if (pullRes.pulled) remoteSealRef.current = pullRes.remoteSeal ?? nextSeal ?? prevSeal ?? null;
          if (pullRes.imported > 0) bumpRegistry();
        } else {
          remoteSealRef.current = nextSeal || prevSeal;
        }

        seedInhaleFromRegistry();
        await flushInhaleQueue();
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [bumpRegistry, syncMode],
  );

  useEffect(() => {
    if (!HAS_WINDOW) return;
    if (syncMode !== "standalone") return;

    const ac = new AbortController();

    void inhaleOnce("open");
    void exhaleOnce("open", ac.signal);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void inhaleOnce("visible");
        void exhaleOnce("visible", ac.signal);
      }
    };

    const onFocus = () => {
      void inhaleOnce("focus");
      void exhaleOnce("focus", ac.signal);
    };

    const onOnline = () => {
      void inhaleOnce("online");
      void exhaleOnce("online", ac.signal);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      ac.abort();
    };
  }, [exhaleOnce, inhaleOnce, syncMode]);

  /* ─────────────────────────────────────────────────────────────
     Nodes (graph truth) built from memoryRegistry (same as tree)
  ────────────────────────────────────────────────────────────── */

  const nodesSorted = useMemo(() => {
    void registryRev;
    return buildNodesFromRegistry(maxNodes, sort);
  }, [registryRev, maxNodes, sort]);

  const byHash = useMemo(() => {
    const m = new Map<string, HoneyNode>();
    for (const n of nodesSorted) m.set(n.hash, n);
    return m;
  }, [nodesSorted]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of nodesSorted) {
      if (!n.parentHash) continue;
      const arr = m.get(n.parentHash) ?? [];
      arr.push(n.hash);
      m.set(n.parentHash, arr);
    }
    return m;
  }, [nodesSorted]);

  const computedInitialHash = useMemo((): string | null => {
    if (nodesSorted.length === 0) return null;

    if (HAS_WINDOW) {
      const saved = safeLocalStorageGet(SIGIL_SELECT_LS_KEY);
      const savedHash = saved ? saved.toLowerCase() : "";
      if (savedHash && byHash.has(savedHash)) return savedHash;
    }

    let best: HoneyNode | null = null;
    for (const n of nodesSorted) {
      if (!best) best = n;
      else if (n.degree > best.degree) best = n;
    }
    return best?.hash ?? nodesSorted[0].hash;
  }, [nodesSorted, byHash]);

  const selectedHash = useMemo((): string | null => {
    const ov = selectedOverride ? selectedOverride.toLowerCase() : null;
    if (ov && byHash.has(ov)) return ov;
    return computedInitialHash;
  }, [selectedOverride, byHash, computedInitialHash]);

  const selected = useMemo(() => (selectedHash ? byHash.get(selectedHash) ?? null : null), [selectedHash, byHash]);
  const selectedPulse =
    selected && typeof selected.pulse === "number" && Number.isFinite(selected.pulse)
      ? wrapPulseForSigil(selected.pulse)
      : null;
  const selectedKks = selectedPulse != null ? deriveKksFromPulse(selectedPulse) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodesSorted;

    return nodesSorted.filter((n) => {
      if (n.hash.includes(q)) return true;
      if (typeof n.pulse === "number" && String(n.pulse).includes(q)) return true;
      if (n.userPhiKey && n.userPhiKey.toLowerCase().includes(q)) return true;
      if (n.kaiSignature && n.kaiSignature.toLowerCase().includes(q)) return true;
      if (n.chakraDay && n.chakraDay.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [nodesSorted, query]);

  const layout = useMemo(() => {
    const N = filtered.length;
    const coords = hexSpiralCoords(N);

    const PHI = 1.61803398875;
    const radiusPx = Math.round(28 * PHI);
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
    const pad = 96;

    const offX = (Number.isFinite(minX) ? -minX : 0) + pad;
    const offY = (Number.isFinite(minY) ? -minY : 0) + pad;

    const items: LayoutItem[] = filtered.map((node, i) => {
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
  }, [filtered]);

  const autoPan = useMemo((): { x: number; y: number } => {
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

  /* ─────────────────────────────────────────────────────────────
     Interactions
  ────────────────────────────────────────────────────────────── */

  const resetToAutoCenter = () => {
    setUserInteracted(false);
    setUserPan({ x: 0, y: 0 });
  };

  const broadcastSelection = (hash: string) => {
    if (!HAS_WINDOW) return;
    safeLocalStorageSet(SIGIL_SELECT_LS_KEY, hash);
    try {
      selectChannelRef.current?.postMessage({ type: "sigil:select", hash });
    } catch {
      ignore();
    }
  };

  const selectHash = (hash: string, event?: React.MouseEvent<HTMLButtonElement>) => {
    const h = hash.toLowerCase();
    setSelectedOverride(h);
    broadcastSelection(h);
    resetToAutoCenter();
    if (onOpenPulseView) {
      const node = byHash.get(h);
      const pulse = node?.pulse;
      if (typeof pulse === "number" && Number.isFinite(pulse)) {
        const rect = event?.currentTarget.getBoundingClientRect();
        onOpenPulseView({
          pulse,
          originHash: node?.originHash,
          anchor: rect ? { x: rect.left + rect.width / 2, y: rect.bottom } : undefined,
        });
      }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;

    const delta = e.deltaY;
    const nextZoom = clamp(zoom * (delta > 0 ? 0.9 : 1.12), 0.12, 4.25);

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
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target instanceof HTMLElement && e.target.closest(".sigilHex")) return;

    setUserInteracted(true);
    const rotateMode = e.button === 2 || e.shiftKey;
    dragRef.current = {
      active: true,
      mode: rotateMode ? "rotate" : "pan",
      x0: e.clientX,
      y0: e.clientY,
      panX0: pan.x,
      panY0: pan.y,
      rotX0: rotation.x,
      rotY0: rotation.y,
      rotZ0: rotation.z,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x0;
    const dy = e.clientY - dragRef.current.y0;
    if (dragRef.current.mode === "rotate") {
      const nextX = clamp(dragRef.current.rotX0 + dy * 0.35, -85, 85);
      const nextY = dragRef.current.rotY0 + dx * 0.35;
      const nextZ = e.altKey ? dragRef.current.rotZ0 + dx * 0.2 : dragRef.current.rotZ0;
      setRotation({ x: nextX, y: nextY, z: nextZ });
    } else {
      setUserPan({ x: dragRef.current.panX0 + dx, y: dragRef.current.panY0 + dy });
    }
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

  const copySelectedUrl = async () => {
    if (!selected) return;
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(selected.bestUrl);
    } catch {
      ignore();
    }
  };

  const childCount = selected ? (childrenByParent.get(selected.hash)?.length ?? 0) : 0;

  return (
    <div className={["sigilHoneycomb", className ?? ""].join(" ")}>
      <div className="sigilHoneycombHeader">
        <div className="sigilHoneycombTitle" aria-hidden="true" />

        <div className="sigilHoneycombControls">
          <div className="searchBox">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hash / pulse / phiKey / signature / chakra…"
              spellCheck={false}
            />
            {query ? (
              <button className="miniBtn" onClick={() => setQuery("")} type="button">
                Clear
              </button>
            ) : null}
          </div>

          <div className="toggleRow">
            <div className="seg">
              <button type="button" className={edgeMode === "none" ? "on" : ""} onClick={() => setEdgeMode("none")} aria-label="Edges off">
                <span className="btn-icon">◌</span>
                <span className="btn-text">Edges: Off</span>
              </button>
              <button type="button" className={edgeMode === "parent" ? "on" : ""} onClick={() => setEdgeMode("parent")} aria-label="Parent edges">
                <span className="btn-icon">↑</span>
                <span className="btn-text">Parent</span>
              </button>
              <button
                type="button"
                className={edgeMode === "parent+children" ? "on" : ""}
                onClick={() => setEdgeMode("parent+children")}
                aria-label="Parent and children edges"
              >
                <span className="btn-icon">⇄</span>
                <span className="btn-text">Parent+Kids</span>
              </button>
              <button type="button" className={edgeMode === "all" ? "on" : ""} onClick={() => setEdgeMode("all")} aria-label="All edges">
                <span className="btn-icon">◎</span>
                <span className="btn-text">All</span>
              </button>
            </div>

            <div className="seg" />
          </div>
        </div>
      </div>

      <div className="sigilHoneycombBody">
        <div
          className="combViewport"
          ref={viewportRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="combInner"
            style={{
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) rotateZ(${rotation.z}deg)`,
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
                  selected={it.node.hash === selectedHash}
                  onClick={(event) => selectHash(it.node.hash, event)}
                />
              ))}
          </div>

        </div>

        <aside className="combInspector" aria-label="Honeycomb inspector">
          <div className="inspectorCard">
            <div className="inspectorHead">
              <div className="inspectorTitle">Selection</div>
              <div className="inspectorSub">{selected ? shortHash(selected.hash, 16) : "—"}</div>
            </div>

            <div className="inspectorGrid">
              <div className="k">Pulse</div>
              <div className="v mono">{selected?.pulse ?? "—"}</div>

              <div className="k">Beat:Step</div>
              <div className="v mono">
                {selectedKks ? `${selectedKks.beat}:${selectedKks.stepIndex}` : "—"}
              </div>

              <div className="k">Chakra</div>
              <div className="v">{selected?.chakraDay ?? "—"}</div>

              <div className="k">ΔΦ</div>
              <div className="v mono">{formatPhi(selected?.phiDelta)}</div>

              <div className="k">Transfer</div>
              <div className="v">{selected?.transferDirection ?? "—"}</div>

              <div className="k">Parent</div>
              <div className="v mono">
                {selected?.parentHash ? (
                  <button className="linkBtn" type="button" onClick={() => selectHash(selected.parentHash!)}>
                    {shortHash(selected.parentHash, 14)}
                  </button>
                ) : (
                  "—"
                )}
              </div>

              <div className="k">Children</div>
              <div className="v mono">{selected ? childCount : "—"}</div>

              <div className="k">Origin</div>
              <div className="v mono">
                {selected?.originHash ? (
                  <button className="linkBtn" type="button" onClick={() => selectHash(selected.originHash!)}>
                    {shortHash(selected.originHash, 14)}
                  </button>
                ) : (
                  "—"
                )}
              </div>

              <div className="k">PhiKey</div>
              <div className="v mono">{selected?.userPhiKey ? shortHash(selected.userPhiKey, 20) : "—"}</div>

              <div className="k">KaiSig</div>
              <div className="v mono">{selected?.kaiSignature ? shortHash(selected.kaiSignature, 20) : "—"}</div>

              <div className="k">Degree</div>
              <div className="v mono">{selected?.degree ?? "—"}</div>
            </div>

            <div className="inspectorActions">
              <button type="button" className="primaryBtn" onClick={openSelected} disabled={!selected}>
                Open
              </button>
              <button type="button" className="miniBtn" onClick={copySelectedUrl} disabled={!selected}>
                Copy URL
              </button>
            </div>

            {selected?.sources?.length ? (
              <details className="sources">
                <summary>Sources ({selected.sources.length})</summary>
                <div className="sourcesList">
                  {selected.sources.slice(0, 40).map((s, i) => (
                    <div key={`${i}-${s}`} className="sourceItem mono">
                      {browserViewUrl(s)}
                    </div>
                  ))}
                  {selected.sources.length > 40 ? <div className="sourceMore">… {selected.sources.length - 40} more</div> : null}
                </div>
              </details>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Local helper: latest pulse in registry
───────────────────────────────────────────────────────────── */
function getLatestPulseFromRegistryLocal(): number | undefined {
  let latest: number | undefined;
  for (const [, payloadLoose] of memoryRegistry) {
    if (!isRecord(payloadLoose)) continue;
    const p = readNum(payloadLoose.pulse);
    if (p == null) continue;
    if (latest == null || p > latest) latest = p;
  }
  return latest;
}
