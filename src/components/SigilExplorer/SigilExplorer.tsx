// src/components/SigilExplorer.tsx
/* eslint-disable no-empty -- benign lifecycle errors are silenced */
"use client";

import React, {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ✅ CSS contract you pasted */
import "../SigilExplorer.css";

/* ──────────────────────────────────────────────────────────────────────────────
   Modular SigilExplorer wiring (components/SigilExplorer/*)
────────────────────────────────────────────────────────────────────────────── */

/** Core registry + storage */
import {
  memoryRegistry,
  addUrl,
  ensureRegistryHydrated,
  persistRegistryToStorage,
  parseImportedJson,
  REGISTRY_LS_KEY,
  MODAL_FALLBACK_LS_KEY,
  isOnline,
} from "./registryStore";

/** Breath cadence + chakra tinting */
import { chakraTintStyle } from "./chakra";

/** URL surface */
import {
  canonicalizeUrl,
  browserViewUrl,
  explorerOpenUrl,
  extractPayloadFromUrl,
  parseHashFromUrl,
  isPTildeUrl,
  contentKindForUrl,
  scoreUrlForView,
  momentKeyFor,
} from "./url";

/** Formatting + Kai-time comparisons */
import { formatPhi, formatUsd, getPhiFromPayload, short } from "./format";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import { computeIntrinsicUnsigned, type SigilMetadataLite } from "../../utils/valuation";
import { getKaiPulseEternalInt } from "../../SovereignSolar";

/** URL health probing */
import { loadUrlHealthFromStorage, probeUrl, setUrlHealth, urlHealth } from "./urlHealth";

/** Remote API client */
import {
  apiFetchWithFailover,
  API_SEAL_PATH,
  type ApiSealResponse,
  loadApiBackupDeadUntil,
  loadApiBaseHint,
} from "./apiClient";

/** Inhale queue (push) */
import {
  enqueueInhaleRawKrystal,
  flushInhaleQueue,
  forceInhaleUrls,
  loadInhaleQueueFromStorage,
  saveInhaleQueueToStorage,
  seedInhaleFromRegistry,
} from "./inhaleQueue";

/** Remote pull (exhale) */
import { pullAndImportRemoteUrls } from "./remotePull";
import { msUntilNextKaiBreath } from "./kaiCadence";

/** Username claim witness registry */
import {
  getUsernameClaimRegistry,
  normalizeUsername,
  subscribeUsernameClaimRegistry,
  type UsernameClaimRegistry,
} from "./witness";

/** Transfers registry */
import {
  getTransferMoveFromPayload,
  getTransferMoveFromRegistry,
  getTransferMoveFromTransferUrl,
  readSigilTransferRegistry,
  SIGIL_TRANSFER_CHANNEL_NAME,
  SIGIL_TRANSFER_EVENT,
  SIGIL_TRANSFER_LS_KEY,
  type SigilTransferRecord,
  type TransferMove,
} from "./transfers";
import type { SigilSharePayloadLoose } from "./types";
import { registerSigilUrl as registerSigilUrlGlobal } from "../../utils/sigilRegistry";
import { stepIndexFromPulseExact } from "../../utils/kai_pulse";

/** Tree build */
import { buildForest, resolveCanonicalHashFromNode } from "./tree/buildForest";
import type { SigilNode } from "./tree/types";
import SigilHoneycombExplorer from "./SigilHoneycombExplorer";
import PulseHoneycombModal from "./PulseHoneycombModal";

/* ─────────────────────────────────────────────────────────────────────
 *  Globals / constants
 *  ───────────────────────────────────────────────────────────────────── */
const hasWindow = typeof window !== "undefined";

type SyncReason = "open" | "pulse" | "visible" | "focus" | "online" | "import";

type PulseViewTarget = {
  pulse: number;
  originUrl?: string;
  originHash?: string;
  anchor?: { x: number; y: number };
};

const SIGIL_EXPLORER_OPEN_EVENT = "sigil:explorer:open";
const SIGIL_EXPLORER_CHANNEL_NAME = "sigil:explorer:bc:v1";

const UI_SCROLL_INTERACT_MS = 520;
const UI_TOGGLE_INTERACT_MS = 900;
const UI_FLUSH_PAD_MS = 80;
const IMPORT_BATCH_SIZE = 80;
const IMPORT_WORKER_THRESHOLD = 250_000;

const URL_PROBE_MAX_PER_REFRESH = 18;

function getLatestPulseFromRegistry(): number | undefined {
  let latest: number | undefined;
  for (const [, payload] of memoryRegistry) {
    const pulse = (payload as { pulse?: unknown }).pulse;
    if (typeof pulse !== "number" || !Number.isFinite(pulse)) continue;
    if (latest == null || pulse > latest) latest = pulse;
  }
  return latest;
}

function readRemotePulse(body: ApiSealResponse): number | undefined {
  const pulse = body?.pulse ?? body?.latestPulse ?? body?.latest_pulse;
  if (typeof pulse !== "number" || !Number.isFinite(pulse)) return undefined;
  return pulse;
}

const PHI_MARK_SRC = "/phi.svg";
const PHI_TEXT = "phi";

function PhiMark({ className }: { className?: string }) {
  const classes = ["phi-mark", className].filter(Boolean).join(" ");
  return <img className={classes} src={PHI_MARK_SRC} alt={PHI_TEXT} decoding="async" loading="lazy" draggable={false} />;
}

function renderPhiAmount(amount: number, options?: { sign?: string; className?: string; markClassName?: string }) {
  return (
    <span className={["phi-amount", options?.className].filter(Boolean).join(" ")}>
      {options?.sign ? <span className="phi-amount__sign">{options.sign}</span> : null}
      <span className="phi-amount__value">{formatPhi(amount)}</span>
      <PhiMark className={["phi-amount__mark", options?.markClassName].filter(Boolean).join(" ")} />
    </span>
  );
}

function nowMs(): number {
  return Date.now();
}

function yieldToMain(): Promise<void> {
  if (!hasWindow) return Promise.resolve();
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function cssEscape(s: string): string {
  const w = hasWindow ? (window as unknown as { CSS?: { escape?: (v: string) => string } }) : null;
  const esc = w?.CSS?.escape;
  if (typeof esc === "function") return esc(s);
  return s.replace(/["\\]/g, "\\$&");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function hasStringProp<T extends string>(obj: unknown, key: T): obj is Record<T, string> {
  return isRecord(obj) && typeof obj[key] === "string";
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function readQuality(value: unknown): "low" | "med" | "high" | undefined {
  if (value === "low" || value === "med" || value === "high") return value;
  return undefined;
}

function buildValuationMeta(payload: SigilSharePayloadLoose): SigilMetadataLite {
  const record = payload as Record<string, unknown>;
  const payloadSteps = readFiniteNumber((payload as { stepsPerBeat?: unknown }).stepsPerBeat);
  const transfers = Array.isArray(record.transfers) ? (record.transfers as SigilMetadataLite["transfers"]) : undefined;
  const segments = Array.isArray(record.segments) ? (record.segments as SigilMetadataLite["segments"]) : undefined;
  const ip = isRecord(record.ip) ? (record.ip as SigilMetadataLite["ip"]) : undefined;

  return {
    pulse: payload.pulse,
    kaiPulse: payload.pulse,
    beat: payload.beat,
    stepIndex: payload.stepIndex,
    stepsPerBeat: readFiniteNumber(record.stepsPerBeat) ?? payloadSteps,
    kaiSignature: payload.kaiSignature,
    userPhiKey: payload.userPhiKey,
    chakraDay: payload.chakraDay,
    chakraGate: typeof record.chakraGate === "string" ? record.chakraGate : undefined,
    seriesSize: readFiniteNumber(record.seriesSize),
    quality: readQuality(record.quality),
    creatorVerified: readBoolean(record.creatorVerified),
    creatorRep: readFiniteNumber(record.creatorRep),
    frequencyHz: readFiniteNumber(record.frequencyHz),
    transfers,
    cumulativeTransfers: readFiniteNumber(record.cumulativeTransfers),
    segments,
    segmentsMerkleRoot: typeof record.segmentsMerkleRoot === "string" ? record.segmentsMerkleRoot : undefined,
    transfersWindowRoot: typeof record.transfersWindowRoot === "string" ? record.transfersWindowRoot : undefined,
    ip,
  };
}

function computeLivePhi(payload: SigilSharePayloadLoose, nowPulse: number | null): number | null {
  if (nowPulse == null || !Number.isFinite(nowPulse)) return null;
  try {
    const meta = buildValuationMeta(payload);
    const { unsigned } = computeIntrinsicUnsigned(meta, nowPulse);
    return Number.isFinite(unsigned.valuePhi) ? unsigned.valuePhi : null;
  } catch {
    return null;
  }
}

function computeUsdPerPhi(payload: SigilSharePayloadLoose, nowPulse: number | null): number | null {
  if (nowPulse == null || !Number.isFinite(nowPulse)) return null;
  try {
    const meta = buildValuationMeta(payload);
    const quote = quotePhiForUsd(
      {
        meta,
        nowPulse,
        usd: 100,
        currentStreakDays: 0,
        lifetimeUsdSoFar: 0,
      },
      DEFAULT_ISSUANCE_POLICY,
    );
    return Number.isFinite(quote.usdPerPhi) ? quote.usdPerPhi : null;
  } catch {
    return null;
  }
}

function parseJsonAsync(text: string): Promise<unknown> {
  if (!hasWindow || typeof Worker === "undefined" || text.length < IMPORT_WORKER_THRESHOLD) {
    return Promise.resolve(JSON.parse(text) as unknown);
  }

  const workerSrc = `
    self.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        self.postMessage({ ok: true, value: parsed });
      } catch (err) {
        self.postMessage({ ok: false, error: err && err.message ? err.message : "parse-failed" });
      }
    };
  `;

  let worker: Worker | null = null;
  let workerUrl = "";
  try {
    const blob = new Blob([workerSrc], { type: "text/javascript" });
    workerUrl = URL.createObjectURL(blob);
    worker = new Worker(workerUrl);
  } catch {
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    return Promise.resolve(JSON.parse(text) as unknown);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };

    worker.onmessage = (event) => {
      const data = event.data as { ok?: boolean; value?: unknown; error?: string } | undefined;
      cleanup();
      if (data?.ok) resolve(data.value);
      else reject(new Error(data?.error ?? "parse-failed"));
    };

    worker.onerror = () => {
      cleanup();
      reject(new Error("parse-failed"));
    };

    worker.postMessage(text);
  });
}

/* ─────────────────────────────────────────────────────────────────────
 *  Detail extraction
 *  ───────────────────────────────────────────────────────────────────── */
type DetailEntry = { label: React.ReactNode; value: React.ReactNode; valueText?: string };

type FeedPostPayload = {
  author?: string;
  usernameClaim?: unknown;
};

type NodeValueSnapshot = {
  basePhi: number | null;
  netPhi: number | null;
  usdValue: number | null;
  usdPerPhi: number | null;
  transferMove: TransferMove | null;
  receivedAmount: number;
  receivedFromChildren: number;
  pendingFromChildren: number;
  pendingFromParent: number;
};

function resolveInhaleLabel(node: SigilNode): "inhale" | "exhale" | null {
  const kind = contentKindForUrl(node.url);
  if (kind === "stream") return "inhale";
  if (kind === "post") return "exhale";
  return null;
}

function resolveTransferMoveForNode(
  node: SigilNode,
  transferRegistry: ReadonlyMap<string, SigilTransferRecord>,
): TransferMove | undefined {
  const canonicalHash = resolveCanonicalHashFromNode(node);
  const registryMove = getTransferMoveFromRegistry(canonicalHash, transferRegistry);
  if (registryMove) return registryMove;

  const payloadMove = getTransferMoveFromPayload(node.payload);
  if (payloadMove) return payloadMove;

  const record = node.payload as unknown as Record<string, unknown>;
  const transferUrlMove = getTransferMoveFromTransferUrl(record);
  if (transferUrlMove) return transferUrlMove;

  if (isRecord(record.feed)) {
    const feedTransferUrlMove = getTransferMoveFromTransferUrl(record.feed as Record<string, unknown>);
    if (feedTransferUrlMove) return feedTransferUrlMove;
  }

  for (const url of node.urls) {
    const payload = extractPayloadFromUrl(url);
    if (!payload) continue;

    const derived = getTransferMoveFromPayload(payload);
    if (derived) return derived;

    const payloadRec = payload as unknown as Record<string, unknown>;
    const derivedTransferUrl = getTransferMoveFromTransferUrl(payloadRec);
    if (derivedTransferUrl) return derivedTransferUrl;
  }

  return undefined;
}

type ReceiveLockIndex = {
  nonces: Set<string>;
  canonicals: Set<string>;
};

function readTransferDirectionValue(value: unknown): "send" | "receive" | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("receive") || t.includes("received") || t.includes("inhale")) return "receive";
  if (t.includes("send") || t.includes("sent") || t.includes("exhale")) return "send";
  return null;
}

function readTransferDirectionFromPayload(payload: SigilSharePayloadLoose): "send" | "receive" | null {
  const record = payload as Record<string, unknown>;
  return (
    readTransferDirectionValue(record.transferDirection) ||
    readTransferDirectionValue(record.transferMode) ||
    readTransferDirectionValue(record.transferKind) ||
    readTransferDirectionValue(record.phiDirection)
  );
}

function readPayloadNonce(payload: SigilSharePayloadLoose): string | null {
  const record = payload as Record<string, unknown>;
  const raw = record.transferNonce ?? record.nonce;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readPayloadCanonical(payload: SigilSharePayloadLoose): string | null {
  const record = payload as Record<string, unknown>;
  const raw = record.canonicalHash ?? record.childHash ?? record.hash;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

function buildReceiveLockIndex(registry: typeof memoryRegistry): ReceiveLockIndex {
  const nonces = new Set<string>();
  const canonicals = new Set<string>();

  for (const payload of registry.values()) {
    if (readTransferDirectionFromPayload(payload) !== "receive") continue;
    const nonce = readPayloadNonce(payload);
    if (nonce) nonces.add(nonce);
    const canonical = readPayloadCanonical(payload);
    if (canonical) canonicals.add(canonical);
  }

  return { nonces, canonicals };
}

function resolveTransferStatusForNode(
  node: SigilNode,
  transferRegistry: ReadonlyMap<string, SigilTransferRecord>,
  receiveLocks: ReceiveLockIndex,
): "pending" | "received" | null {
  const transferMove = resolveTransferMoveForNode(node, transferRegistry);
  if (!transferMove) return null;
  if (transferMove.direction === "receive") return "received";

  const nonce = readPayloadNonce(node.payload);
  if (nonce && receiveLocks.nonces.has(nonce)) return "received";

  const canonical = resolveCanonicalHashFromNode(node);
  if (canonical && receiveLocks.canonicals.has(canonical)) return "received";

  return "pending";
}

function buildDetailEntries(
  node: SigilNode,
  usernameClaims: UsernameClaimRegistry,
  transferRegistry: ReadonlyMap<string, SigilTransferRecord>,
  receiveLocks: ReceiveLockIndex,
  valueSnapshot?: NodeValueSnapshot | null,
): DetailEntry[] {
  const record = node.payload as unknown as Record<string, unknown>;
  const entries: DetailEntry[] = [];
  const usedKeys = new Set<string>();
  const transferMove = resolveTransferMoveForNode(node, transferRegistry);
  const transferStatus = transferMove ? resolveTransferStatusForNode(node, transferRegistry, receiveLocks) : null;
  const displayLivePhi =
    transferStatus === "pending" && transferMove ? transferMove.amount : (valueSnapshot?.netPhi ?? null);
  const displayUsdValue =
    transferStatus === "pending" && transferMove
      ? transferMove.amountUsd ?? (valueSnapshot?.usdPerPhi != null ? transferMove.amount * valueSnapshot.usdPerPhi : null)
      : (valueSnapshot?.usdValue ?? null);

  if (displayLivePhi !== null && displayLivePhi !== undefined) {
    entries.push({
      label: (
        <span className="phi-detail__label">
          Live <PhiMark className="phi-detail__mark" /> value
        </span>
      ),
      value: renderPhiAmount(displayLivePhi),
      valueText: `${formatPhi(displayLivePhi)} ${PHI_TEXT}`,
    });
  }
  if (displayUsdValue !== null && displayUsdValue !== undefined) {
    entries.push({ label: "Live USD", value: `$${formatUsd(displayUsdValue)}` });
  }
  const pendingFromChildren = valueSnapshot?.pendingFromChildren ?? 0;
  const pendingFromParent = valueSnapshot?.pendingFromParent ?? 0;
  const pendingTotal = node.children.length > 0 ? pendingFromChildren : pendingFromChildren + pendingFromParent;
  if (pendingTotal > 0) {
    entries.push({
      label: "Exhale (pending)",
      value: renderPhiAmount(pendingTotal, { sign: "-" }),
      valueText: `-${formatPhi(pendingTotal)} ${PHI_TEXT}`,
    });
  }

  const exhaledToDerivatives = valueSnapshot?.receivedFromChildren ?? 0;
  if (exhaledToDerivatives > 0) {
    entries.push({
      label: (
        <span className="phi-detail__label">
          <PhiMark className="phi-detail__mark" /> Exhaled
        </span>
      ),
      value: renderPhiAmount(exhaledToDerivatives, { sign: "-" }),
      valueText: `-${formatPhi(exhaledToDerivatives)} ${PHI_TEXT}`,
    });
  }

  const phiSelf = getPhiFromPayload(node.payload);
  if (phiSelf !== undefined) {
    entries.push({
      label: (
        <span className="phi-detail__label">
          This glyph <PhiMark className="phi-detail__mark" />
        </span>
      ),
      value: renderPhiAmount(phiSelf),
      valueText: `${formatPhi(phiSelf)} ${PHI_TEXT}`,
    });
  }

  if (transferMove) {
    const transferDirectionLabel = transferMove.direction === "receive" ? "Inhaled" : "Exhaled";
    const transferPendingLabel = transferMove.direction === "receive" ? "Inhale (pending)" : "Exhale (pending)";
    const transferPulseSuffix = transferMove.sentPulse !== undefined ? ` • pulse ${transferMove.sentPulse}` : "";
    const transferPulseLabelSuffix = transferMove.sentPulse !== undefined ? ` (pulse ${transferMove.sentPulse})` : "";
    if (transferStatus) {
      entries.push({
        label: "Transfer status",
        value: `${transferStatus === "pending" ? transferPendingLabel : transferDirectionLabel}${transferPulseSuffix}`,
      });
    }
    if (transferStatus === "received") {
      entries.push({
        label: (
          <span className="phi-detail__label">
            <PhiMark className="phi-detail__mark" /> {transferDirectionLabel}
            {transferPulseLabelSuffix}
          </span>
        ),
        value: renderPhiAmount(transferMove.amount, { sign: "+" }),
        valueText: `+${formatPhi(transferMove.amount)} ${PHI_TEXT}`,
      });
    }
    if (transferMove.amountUsd !== undefined) entries.push({ label: "USD value", value: `$${formatUsd(transferMove.amountUsd)}` });
    if (transferMove.sentPulse !== undefined) entries.push({ label: "Sent pulse", value: String(transferMove.sentPulse) });

    const maybe = transferMove as unknown;
    if (hasStringProp(maybe, "txHash")) entries.push({ label: "Tx hash", value: maybe.txHash });
  }

  const feed = record.feed as FeedPostPayload | undefined;
  const authorRaw =
    typeof feed?.author === "string"
      ? feed.author
      : typeof record.author === "string"
        ? record.author
        : undefined;

  const claimEvidence = feed ? (feed as FeedPostPayload & { usernameClaim?: unknown }).usernameClaim : undefined;
  const normalizedFromClaim = claimEvidence
    ? normalizeUsername(
        (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.normalized ||
          (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.username ||
          "",
      )
    : "";
  const normalizedFromAuthor = normalizeUsername(authorRaw ?? "");
  const normalizedUsername = normalizedFromClaim || normalizedFromAuthor;

  if (normalizedUsername) {
    const claimEntry = usernameClaims[normalizedUsername];
    const displayName =
      typeof authorRaw === "string" && authorRaw.trim().length > 0 ? authorRaw.trim() : `@${normalizedUsername}`;

    if (claimEntry) {
      entries.push({ label: "Username (claimed)", value: `${displayName} → glyph ${short(claimEntry.claimHash, 10)}` });
      entries.push({ label: "Claim glyph", value: browserViewUrl(claimEntry.claimUrl) });
    } else {
      entries.push({ label: "Username", value: displayName });
    }
  }

  const addFromKey = (key: string, label: string) => {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0 && !usedKeys.has(key)) {
      entries.push({ label, value: v.trim() });
      usedKeys.add(key);
    }
  };

  addFromKey("userPhiKey", "PhiKey");
  addFromKey("phiKey", "PhiKey");
  addFromKey("phikey", "PhiKey");
  addFromKey("kaiSignature", "Kai Signature");

  if (typeof record.parentUrl === "string" && record.parentUrl.length > 0) entries.push({ label: "Parent URL", value: browserViewUrl(record.parentUrl) });
  if (typeof record.originUrl === "string" && record.originUrl.length > 0) entries.push({ label: "Origin URL", value: browserViewUrl(record.originUrl) });

  const labelCandidate = record.label ?? record.title ?? record.type ?? record.note ?? record.description;
  if (typeof labelCandidate === "string" && labelCandidate.trim().length > 0) entries.push({ label: "Label / Type", value: labelCandidate.trim() });

  entries.push({ label: "Primary URL", value: browserViewUrl(node.url) });

  const visibleVariants = node.urls.filter((u) => !isPTildeUrl(u)).map((u) => browserViewUrl(u));
  if (node.urls.length > 1) {
    entries.push({
      label: "URL variants",
      value:
        visibleVariants.length === 0
          ? `${node.urls.length} urls (kept in data; hidden from browser view)`
          : visibleVariants.length <= 3
            ? visibleVariants.join(" | ")
            : `${node.urls.length} urls (kept in data; rendered once)`,
    });
  }

  return entries.slice(0, 12);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Clipboard helper
 *  ───────────────────────────────────────────────────────────────────── */
async function copyText(text: string): Promise<void> {
  if (!hasWindow) return;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {}
}

/* ─────────────────────────────────────────────────────────────────────
 *  Prefetch helper (warm view urls)
 *  ───────────────────────────────────────────────────────────────────── */
async function prefetchViewUrl(u: string): Promise<void> {
  if (!hasWindow) return;
  try {
    await fetch(u, { method: "GET", cache: "force-cache", mode: "cors", credentials: "omit", redirect: "follow" });
  } catch {}
}

/* ─────────────────────────────────────────────────────────────────────
 *  UI components (CSS class contract)
 *  ───────────────────────────────────────────────────────────────────── */
function KaiStamp({ p }: { p: { pulse?: number; beat?: number; stepIndex?: number; stepsPerBeat?: number } }) {
  const pulse = typeof p.pulse === "number" ? p.pulse : 0;
  const stepsPerBeat = typeof p.stepsPerBeat === "number" && p.stepsPerBeat > 0 ? p.stepsPerBeat : 44;
  const step =
    typeof p.stepIndex === "number"
      ? p.stepIndex
      : typeof p.pulse === "number"
        ? stepIndexFromPulseExact(p.pulse, stepsPerBeat)
        : 0;
  const beat = typeof p.beat === "number" ? p.beat : 0;

  return (
    <span className="k-stamp" title={`pulse ${pulse} • beat ${beat} • step ${step}`}>
      <span className="k-pill">☤KAI {pulse}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">beat {beat}</span>
      <span className="k-dot">•</span>
      <span className="k-pill">step {step}</span>
    </span>
  );
}

type SigilTreeNodeProps = {
  node: SigilNode;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  phiTotalsByPulse: ReadonlyMap<number, number>;
  usernameClaims: UsernameClaimRegistry;
  transferRegistry: ReadonlyMap<string, SigilTransferRecord>;
  receiveLocks: ReceiveLockIndex;
  valueSnapshots: ReadonlyMap<string, NodeValueSnapshot>;
};

function SigilTreeNode({
  node,
  expanded,
  toggle,
  phiTotalsByPulse,
  usernameClaims,
  transferRegistry,
  receiveLocks,
  valueSnapshots,
}: SigilTreeNodeProps) {
  const open = expanded.has(node.id);

  const hash = resolveCanonicalHashFromNode(node);
  const sig = (node.payload as unknown as { kaiSignature?: string }).kaiSignature;
  const chakraDay = (node.payload as unknown as { chakraDay?: string }).chakraDay;

  const pulseKey =
    typeof (node.payload as { pulse?: unknown }).pulse === "number" ? (node.payload as { pulse: number }).pulse : undefined;

  const phiSentFromPulse = pulseKey != null ? phiTotalsByPulse.get(pulseKey) : undefined;

  const openHref = explorerOpenUrl(node.url);
  const valueSnapshot = valueSnapshots.get(node.id) ?? null;
  const detailEntries = open ? buildDetailEntries(node, usernameClaims, transferRegistry, receiveLocks, valueSnapshot) : [];
  const transferMove = resolveTransferMoveForNode(node, transferRegistry);
  const transferStatus = resolveTransferStatusForNode(node, transferRegistry, receiveLocks);
  const inhaleLabel = resolveInhaleLabel(node);
  const hasChildren = node.children.length > 0;
  const showOwnTransfer = !hasChildren;
  const livePhi = valueSnapshot?.netPhi ?? null;
  const liveUsd = valueSnapshot?.usdValue ?? null;
  const displayLivePhi = transferStatus === "pending" && transferMove ? transferMove.amount : livePhi;
  const displayLiveUsd =
    transferStatus === "pending" && transferMove
      ? transferMove.amountUsd ?? (valueSnapshot?.usdPerPhi != null ? transferMove.amount * valueSnapshot.usdPerPhi : null)
      : liveUsd;
  const pendingFromChildren = valueSnapshot?.pendingFromChildren ?? 0;
  const pendingFromParent = valueSnapshot?.pendingFromParent ?? 0;
  const derivedFromChildren = valueSnapshot?.receivedFromChildren ?? 0;
  const exhaleTotal = pendingFromChildren + derivedFromChildren;
  const derivedRatio = exhaleTotal > 0 ? derivedFromChildren / exhaleTotal : 0;
  const mixExhaleColor =
    pendingFromChildren > 0 && derivedFromChildren > 0
      ? {
          "--exhale-rgb": `${Math.round(255 * (0.85 + 0.15 * derivedRatio))},${Math.round(
            140 * (1 - derivedRatio) + 75 * derivedRatio,
          )},${Math.round(80 * (1 - derivedRatio) + 110 * derivedRatio)}`,
        }
      : undefined;
  const pendingChildrenTitle =
    pendingFromChildren > 0
      ? `Exhale (pending) children: -${formatPhi(pendingFromChildren)} ${PHI_TEXT}${
          displayLivePhi !== null ? ` • Live ${formatPhi(Math.max(0, displayLivePhi))} ${PHI_TEXT}` : ""
        }`
      : undefined;
  const pendingSendTitle =
    pendingFromParent > 0
      ? `Exhale (pending) send: -${formatPhi(pendingFromParent)} ${PHI_TEXT}${
          displayLivePhi !== null ? ` • Live ${formatPhi(Math.max(0, displayLivePhi))} ${PHI_TEXT}` : ""
        }`
      : undefined;
  const showPendingSend = showOwnTransfer && pendingFromParent > 0 && transferStatus !== "pending";
  const derivedTitle =
    derivedFromChildren > 0
      ? `Exhaled: -${formatPhi(derivedFromChildren)} ${PHI_TEXT}${
          displayLivePhi !== null ? ` • Live ${formatPhi(Math.max(0, displayLivePhi))} ${PHI_TEXT}` : ""
        }`
      : undefined;
  const liveTitle =
    displayLivePhi !== null
      ? `Live value: ${formatPhi(displayLivePhi)} ${PHI_TEXT}${
          displayLiveUsd !== null ? ` • $${formatUsd(displayLiveUsd)}` : ""
        }`
      : undefined;
  const transferDisplay =
    transferMove && transferStatus === "received"
      ? { direction: "send" as const, sign: "-", titleVerb: transferMove.direction === "receive" ? "inhaled" : "exhaled" }
      : transferMove
        ? { direction: "pending" as const, sign: "-", titleVerb: transferMove.direction === "receive" ? "inhaled" : "exhaled" }
        : null;

  return (
    <div className="node" style={chakraTintStyle(chakraDay)} data-chakra={String(chakraDay ?? "")} data-node-id={node.id}>
      <div className="node-row">
        <div className="node-main">
          <button
            className="twirl"
            aria-label={open ? "Collapse memories" : "Expand memories"}
            aria-expanded={open}
            onClick={() => toggle(node.id)}
            title={open ? "Collapse" : "Expand"}
            type="button"
          >
            <span className={`tw ${open ? "open" : ""}`} />
          </button>

          <a className="node-link" href={openHref} target="_blank" rel="noopener noreferrer" title={openHref}>
            <span>{short(sig ?? hash ?? "glyph", 12)}</span>
          </a>
        </div>

        <div className="node-meta">
          <KaiStamp p={node.payload as { pulse?: number; beat?: number; stepIndex?: number }} />

          {chakraDay && (
            <span className="chakra" title={String(chakraDay)}>
              {String(chakraDay)}
            </span>
          )}

          {showOwnTransfer && transferMove && transferDisplay && (
            <span
              className={`phi-move phi-move--${transferDisplay.direction}`}
              title={`Phi ${transferDisplay.titleVerb}${transferStatus === "pending" ? " (pending)" : ""}: ${formatPhi(transferMove.amount)} ${PHI_TEXT}${
                transferMove.amountUsd !== undefined ? ` • $${formatUsd(transferMove.amountUsd)}` : ""
              }${transferMove.sentPulse !== undefined ? ` • sent pulse ${transferMove.sentPulse}` : ""}`}
            >
              <span className="phi-move__sign" aria-hidden="true">
                {transferDisplay.sign}
              </span>
              {renderPhiAmount(transferMove.amount, { className: "phi-move__amount", markClassName: "phi-move__mark" })}
              {transferStatus === "received" && transferMove.amountUsd !== undefined && (
                <span className="phi-move__usd">${formatUsd(transferMove.amountUsd)}</span>
              )}
              {transferStatus === "received" && transferMove.amountUsd === undefined && valueSnapshot?.usdPerPhi != null && (
                <span className="phi-move__usd">${formatUsd(transferMove.amount * valueSnapshot.usdPerPhi)}</span>
              )}
              {transferStatus === "pending" && valueSnapshot?.usdPerPhi != null && (
                <span className="phi-move__usd">${formatUsd(transferMove.amount * valueSnapshot.usdPerPhi)}</span>
              )}
            </span>
          )}
          {showOwnTransfer && transferMove && transferStatus === "pending" && (
            <span className="phi-status phi-status--pending" title="Exhale pending">
              Exhale
            </span>
          )}
          {showOwnTransfer && transferMove && inhaleLabel === "exhale" && transferStatus === "received" && (
            <span className="phi-status phi-status--received" title="Exhale received">
              Exhaled
            </span>
          )}
          {!transferMove && inhaleLabel !== "inhale" && exhaleTotal > 0 && (
            <span
              className={`phi-status phi-status--${pendingFromChildren > 0 && derivedFromChildren > 0 ? "exhale-mix" : "received"}`}
              title={
                pendingFromChildren > 0 && derivedFromChildren > 0
                  ? `Exhale mix: ${formatPhi(derivedFromChildren)} exhaled • ${formatPhi(pendingFromChildren)} pending`
                  : pendingFromChildren > 0
                    ? `Exhale pending: ${formatPhi(pendingFromChildren)} ${PHI_TEXT}`
                    : `Exhaled: ${formatPhi(derivedFromChildren)} ${PHI_TEXT}`
              }
              style={mixExhaleColor as React.CSSProperties}
            >
              Exhale
            </span>
          )}
          {inhaleLabel === "inhale" && (
            <span className="phi-status phi-status--inhale" title="Inhale">
              Inhale
            </span>
          )}

          {displayLivePhi !== null && (
            <span className="phi-pill phi-pill--live" title={liveTitle}>
              <span className="phi-pill__label">
                <PhiMark className="phi-pill__mark" />
                {inhaleLabel === "inhale" ? "+" : "live:"}
              </span>
              {renderPhiAmount(displayLivePhi)}
            </span>
          )}
          {displayLiveUsd !== null && (
            <span className="phi-pill phi-pill--usd" title={liveTitle}>
              ${formatUsd(displayLiveUsd)}
            </span>
          )}
          {derivedFromChildren > 0 && (
            <span className="phi-pill phi-pill--drain" title={derivedTitle}>
              Exhaled {renderPhiAmount(derivedFromChildren, { sign: "-" })}
            </span>
          )}
          {pendingFromChildren > 0 && (
            <span className="phi-pill phi-pill--pending" title={pendingChildrenTitle}>
              Exhale (pending) {renderPhiAmount(pendingFromChildren, { sign: "-" })}
            </span>
          )}
          {showPendingSend && (
            <span className="phi-pill phi-pill--pending" title={pendingSendTitle}>
              Exhale (pending) {renderPhiAmount(pendingFromParent, { sign: "-" })}
            </span>
          )}
          {showOwnTransfer && transferStatus === "received" && transferMove && inhaleLabel === "exhale" && (
            <span
              className="phi-pill phi-pill--drain"
              title={`Exhaled: ${formatPhi(transferMove.amount)} ${PHI_TEXT}${
                transferMove.amountUsd !== undefined ? ` • $${formatUsd(transferMove.amountUsd)}` : ""
              }`}
            >
              Exhaled
            </span>
          )}

          {phiSentFromPulse !== undefined && (
            <span className="phi-pill" title={`Total ${PHI_TEXT} on pulse ${(node.payload as { pulse?: number }).pulse ?? ""}`}>
              <span className="phi-pill__label">
                <PhiMark className="phi-pill__mark" />
                pulse:
              </span>
              {renderPhiAmount(phiSentFromPulse)}
            </span>
          )}

          <button className="node-copy" aria-label="Copy URL" onClick={() => void copyText(openHref)} title="Copy URL" type="button">
            ⧉
          </button>
        </div>
      </div>

      {open && (
        <div className="node-open">
          <div className="node-detail">
            {detailEntries.length === 0 ? (
              <div className="node-detail-empty">No additional memory fields recorded on this glyph.</div>
            ) : (
              <div className="node-detail-grid">
                {detailEntries.map((entry, index) => (
                  <React.Fragment key={index}>
                    <div className="detail-label">{entry.label}</div>
                    <div
                      className="detail-value"
                      title={entry.valueText ?? (typeof entry.value === "string" ? entry.value : undefined)}
                    >
                      {entry.value}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {node.children.length > 0 && (
            <div className="node-children" aria-label="Memory Imprints">
              {node.children.map((c) => (
                <SigilTreeNode
                  key={c.id}
                  node={c}
                  expanded={expanded}
                  toggle={toggle}
                  phiTotalsByPulse={phiTotalsByPulse}
                  usernameClaims={usernameClaims}
                  transferRegistry={transferRegistry}
                  receiveLocks={receiveLocks}
                  valueSnapshots={valueSnapshots}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OriginPanel({
  root,
  expanded,
  toggle,
  phiTotalsByPulse,
  usernameClaims,
  transferRegistry,
  receiveLocks,
  valueSnapshots,
  onOpenPulseView,
}: {
  root: SigilNode;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  phiTotalsByPulse: ReadonlyMap<number, number>;
  usernameClaims: UsernameClaimRegistry;
  transferRegistry: ReadonlyMap<string, SigilTransferRecord>;
  receiveLocks: ReceiveLockIndex;
  valueSnapshots: ReadonlyMap<string, NodeValueSnapshot>;
  onOpenPulseView?: (target: PulseViewTarget) => void;
}) {
  const count = useMemo(() => {
    let n = 0;
    const walk = (s: SigilNode) => {
      n += 1;
      s.children.forEach(walk);
    };
    walk(root);
    return n;
  }, [root]);

  const originHash = parseHashFromUrl(root.url);
  const originSig = (root.payload as unknown as { kaiSignature?: string }).kaiSignature;
  const originPulse =
    readFiniteNumber((root.payload as { pulse?: unknown }).pulse) ??
    readFiniteNumber((memoryRegistry.get(root.url) as { pulse?: unknown } | undefined)?.pulse);

  const openHref = explorerOpenUrl(root.url);
  const chakraDay = (root.payload as unknown as { chakraDay?: string }).chakraDay;
  const rootSnapshot = valueSnapshots.get(root.id) ?? null;

  const branchValue = useMemo(() => {
    let derivedPhi = 0;
    let pendingPhi = rootSnapshot?.pendingFromParent ?? 0;
    for (const child of root.children) {
      const snap = valueSnapshots.get(child.id);
      if (snap?.receivedAmount) derivedPhi += snap.receivedAmount;
      if (snap?.pendingFromParent) pendingPhi += snap.pendingFromParent;
    }

    const basePhi = rootSnapshot?.basePhi ?? null;
    const netPhi = rootSnapshot?.netPhi ?? null;
    const usdPerPhi = rootSnapshot?.usdPerPhi ?? null;
    const usdValue = netPhi != null && usdPerPhi != null ? netPhi * usdPerPhi : null;

    return { basePhi, netPhi, usdValue, derivedPhi, pendingPhi };
  }, [root, rootSnapshot, valueSnapshots]);

  const transferTotals = useMemo(() => {
    let inhaleTotal = 0;
    let exhaleTotal = 0;
    let pendingTotal = 0;

    const walk = (node: SigilNode) => {
      const kind = contentKindForUrl(node.url);
      const snap = valueSnapshots.get(node.id) ?? null;
      if (kind === "stream" && snap?.netPhi != null) inhaleTotal += snap.netPhi;

      if (kind === "post") {
        const move = resolveTransferMoveForNode(node, transferRegistry);
        const status = move ? resolveTransferStatusForNode(node, transferRegistry, receiveLocks) : null;
        if (status === "received" && move) exhaleTotal += move.amount;
      }

      node.children.forEach(walk);
    };

    walk(root);
    for (const child of root.children) {
      const kind = contentKindForUrl(child.url);
      if (kind !== "post") continue;
      const move = resolveTransferMoveForNode(child, transferRegistry);
      const status = move ? resolveTransferStatusForNode(child, transferRegistry, receiveLocks) : null;
      if (status === "pending" && move) pendingTotal += move.amount;
    }
    return { inhaleTotal, exhaleTotal, pendingTotal };
  }, [receiveLocks, root, transferRegistry, valueSnapshots]);

  const originLiveTitle =
    branchValue.netPhi != null
      ? `Live origin value: ${formatPhi(branchValue.netPhi)} ${PHI_TEXT}${
          branchValue.usdValue != null ? ` • $${formatUsd(branchValue.usdValue)}` : ""
        }`
      : undefined;

  const handleOriginPulseView = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      if (typeof window !== "undefined") window.open(openHref, "_blank", "noopener,noreferrer");
      return;
    }
    if (originPulse == null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenPulseView?.({
      pulse: originPulse,
      originUrl: root.url,
      originHash: originHash ?? undefined,
      anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
    });
  };

  return (
    <section className="origin" aria-label="Sigil origin stream" style={chakraTintStyle(chakraDay)} data-chakra={String(chakraDay ?? "")} data-node-id={root.id}>
      <header className="origin-head">
        <div className="o-meta">
          <span className="o-title">Origin</span>
          <button
            className="o-link"
            onClick={handleOriginPulseView}
            type="button"
            title={originPulse != null ? `Open pulse view for ${openHref}` : openHref}
            aria-label="Open origin pulse view"
          >
            {short(originSig ?? originHash ?? "origin", 14)}
          </button>
          {chakraDay && (
            <span className="o-chakra" title={String(chakraDay)}>
              {String(chakraDay)}
            </span>
          )}
        </div>

        <div className="o-right">
          <KaiStamp p={root.payload as { pulse?: number; beat?: number; stepIndex?: number }} />
          {branchValue.netPhi != null && (
            <span className="phi-pill phi-pill--live" title={originLiveTitle}>
              <span className="phi-pill__label">
                <PhiMark className="phi-pill__mark" />
                live:
              </span>
              {renderPhiAmount(branchValue.netPhi)}
            </span>
          )}
          {branchValue.usdValue != null && (
            <span className="phi-pill phi-pill--usd" title={originLiveTitle}>
              ${formatUsd(branchValue.usdValue)}
            </span>
          )}
          {transferTotals.inhaleTotal > 0 && (
            <span className="phi-pill phi-pill--lift" title={`Inhales from memory: +${formatPhi(transferTotals.inhaleTotal)} ${PHI_TEXT}`}>
              Inhale {renderPhiAmount(transferTotals.inhaleTotal, { sign: "+" })}
            </span>
          )}
          {transferTotals.exhaleTotal > 0 && (
            <span className="phi-pill phi-pill--drain" title={`Exhaled: -${formatPhi(transferTotals.exhaleTotal)} ${PHI_TEXT}`}>
              Exhaled {renderPhiAmount(transferTotals.exhaleTotal, { sign: "-" })}
            </span>
          )}
          {transferTotals.pendingTotal > 0 && (
            <span className="phi-pill phi-pill--pending" title={`Exhale (pending): -${formatPhi(transferTotals.pendingTotal)} ${PHI_TEXT}`}>
              Exhale (pending) {renderPhiAmount(transferTotals.pendingTotal, { sign: "-" })}
            </span>
          )}
          <span className="o-count" title="Total content keys in this lineage">
            {count} keys
          </span>
          <button className="o-copy" onClick={() => void copyText(openHref)} title="Copy origin URL" type="button">
            Remember Origin
          </button>
        </div>
      </header>

      <div className="origin-body">
        {root.children.length === 0 ? (
          <div className="kx-empty">No memories yet. The stream begins here.</div>
        ) : (
          <div className="tree">
            {root.children.map((c) => (
              <SigilTreeNode
                key={c.id}
                node={c}
                expanded={expanded}
                toggle={toggle}
                phiTotalsByPulse={phiTotalsByPulse}
                usernameClaims={usernameClaims}
                transferRegistry={transferRegistry}
                receiveLocks={receiveLocks}
                valueSnapshots={valueSnapshots}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ExplorerToolbar({
  onAdd,
  onImport,
  onExport,
  total,
  lastAdded,
  viewMode,
  onViewModeChange,
}: {
  onAdd: (u: string) => void;
  onImport: (f: File) => void;
  onExport: () => void;
  total: number;
  lastAdded?: string;
  viewMode: "keystream" | "lattice";
  onViewModeChange: (next: "keystream" | "lattice") => void;
}) {
  const [input, setInput] = useState("");

  return (
    <div className="kx-toolbar" role="region" aria-label="Explorer toolbar">
      <div className="kx-toolbar-inner">
        <div className="kx-brand">
          <div className="kx-glyph" aria-hidden>
            <img className="kx-glyph__mark" src={PHI_MARK_SRC} alt="" aria-hidden="true" decoding="async" loading="eager" draggable={false} />
          </div>

          <div className="kx-title">
            <h1>
              KAIROS <span>Keystream</span>
            </h1>
            <div className="kx-tagline">
              Sovereign Lineage • No DB • Pure <PhiMark className="phi-tagline__mark" />
            </div>
          </div>
        </div>

        <div className="kx-controls">
          <form
            className="kx-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              onAdd(input.trim());
              setInput("");
            }}
          >
            <input
              className="kx-input"
              placeholder="Inhale a sigil (or memory)…"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Sigil Key"
            />
            <button className="kx-button" type="submit">
              Inhale
            </button>
          </form>

          <div className="kx-io" role="group" aria-label="Import and export">
            <label className="kx-import" title="Import a JSON list of Keys (or krystals)">
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                }}
                aria-label="Import JSON"
              />
              Inhale
            </label>

            <button className="kx-export" onClick={onExport} aria-label="Export registry to JSON" type="button">
              Exhale
            </button>
          </div>

          <div className="kx-view-toggle" role="group" aria-label="Explorer view mode">
            <button
              className="kx-view-btn"
              type="button"
              onClick={() => onViewModeChange(viewMode === "keystream" ? "lattice" : "keystream")}
              aria-pressed={viewMode === "lattice"}
            >
              {viewMode === "keystream" ? "Memory" : "Keystream"}
            </button>
          </div>

          <div className="kx-stats" aria-live="polite">
            <span className="kx-pill" title="Total KEYS in registry (includes variants)">
              {total} KEYS
            </span>
            {lastAdded && (
              <span className="kx-pill subtle" title={lastAdded}>
                Last: {short(lastAdded, 8)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Main Page — Layout matches CSS: .sigil-explorer + ONLY .explorer-scroll scrolls
 *  ───────────────────────────────────────────────────────────────────── */
const SigilExplorer: React.FC = () => {
  const [registryRev, setRegistryRev] = useState(() => (ensureRegistryHydrated() ? 1 : 0));
  const [transferRev, setTransferRev] = useState(0);
  const [lastAdded, setLastAdded] = useState<string | undefined>(undefined);
  const [usernameClaims, setUsernameClaims] = useState<UsernameClaimRegistry>(() => getUsernameClaimRegistry());
  const [nowPulse, setNowPulse] = useState(() => getKaiPulseEternalInt(new Date()));
  const [viewMode, setViewMode] = useState<"keystream" | "lattice">("keystream");
  const [pulseView, setPulseView] = useState<{
    open: boolean;
    pulse: number | null;
    originUrl?: string;
    originHash?: string;
    anchor?: { x: number; y: number };
  }>({ open: false, pulse: null });

  const unmounted = useRef(false);
  const prefetchedRef = useRef<Set<string>>(new Set());

  // Scroll safety guards
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const scrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);

  // UI stability gate
  const interactUntilRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const pendingBumpRef = useRef(false);
  const pendingLastAddedRef = useRef<string | undefined>(undefined);
  const pendingTransferBumpRef = useRef(0);
  const pendingNowPulseRef = useRef<number | null>(null);
  const pendingClaimEntriesRef = useRef<
    Array<{
      normalized: string;
      claimHash: string;
      claimUrl: string;
      originHash?: string | null;
      ownerHint?: string | null;
    }>
  >([]);
  const syncNowRef = useRef<((reason: SyncReason) => Promise<void>) | null>(null);

  const markInteracting = useCallback((ms: number) => {
    const until = nowMs() + ms;
    if (until > interactUntilRef.current) interactUntilRef.current = until;
  }, []);

  const flushDeferredUi = useCallback(() => {
    if (!hasWindow) return;
    if (unmounted.current) return;

    const now = nowMs();
    const remaining = interactUntilRef.current - now;
    if (remaining > 0) {
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushDeferredUi();
      }, remaining + UI_FLUSH_PAD_MS);
      return;
    }

    const queuedClaims = pendingClaimEntriesRef.current.splice(0);
    if (queuedClaims.length > 0) {
      startTransition(() => {
        setUsernameClaims((prev) => {
          let next = prev;
          for (const entry of queuedClaims) {
            const current = next[entry.normalized];
            if (
              current &&
              current.claimHash === entry.claimHash &&
              current.claimUrl === entry.claimUrl &&
              current.originHash === (entry.originHash ?? current.originHash) &&
              current.ownerHint === (entry.ownerHint ?? current.ownerHint)
            ) {
              continue;
            }
            next = {
              ...next,
              [entry.normalized]: {
                ...current,
                normalized: entry.normalized,
                claimHash: entry.claimHash,
                claimUrl: entry.claimUrl,
                originHash: entry.originHash ?? current?.originHash,
                ownerHint: entry.ownerHint ?? current?.ownerHint ?? null,
                updatedAt: current?.updatedAt ?? 0,
              },
            };
          }
          return next;
        });
      });
    }

    if (pendingLastAddedRef.current !== undefined) {
      const v = pendingLastAddedRef.current;
      pendingLastAddedRef.current = undefined;
      startTransition(() => setLastAdded(v));
    }

    if (pendingNowPulseRef.current !== null) {
      const nextPulse = pendingNowPulseRef.current;
      pendingNowPulseRef.current = null;
      startTransition(() => setNowPulse(nextPulse));
    }

    if (pendingTransferBumpRef.current > 0) {
      const delta = pendingTransferBumpRef.current;
      pendingTransferBumpRef.current = 0;
      startTransition(() => setTransferRev((v) => v + delta));
    }

    if (pendingBumpRef.current) {
      pendingBumpRef.current = false;
      startTransition(() => setRegistryRev((v) => v + 1));
    }
  }, [markInteracting]);

  const scheduleUiFlush = useCallback(() => {
    if (!hasWindow) return;
    if (flushTimerRef.current != null) return;

    const now = nowMs();
    const remaining = interactUntilRef.current - now;
    const delay = Math.max(0, remaining) + UI_FLUSH_PAD_MS;

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushDeferredUi();
    }, delay);
  }, [flushDeferredUi]);

  const bump = useCallback(() => {
    if (unmounted.current) return;

    const now = nowMs();
    if (now < interactUntilRef.current || scrollingRef.current) {
      pendingBumpRef.current = true;
      scheduleUiFlush();
      return;
    }
    startTransition(() => setRegistryRev((v) => v + 1));
  }, [scheduleUiFlush]);

  const setLastAddedSafe = useCallback(
    (v: string | undefined) => {
      if (unmounted.current) return;

      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingLastAddedRef.current = v;
        scheduleUiFlush();
        return;
      }
      startTransition(() => setLastAdded(v));
    },
    [scheduleUiFlush],
  );

  const bumpTransferRevSafe = useCallback(
    (delta = 1) => {
      if (unmounted.current) return;

      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingTransferBumpRef.current += delta;
        scheduleUiFlush();
        return;
      }
      startTransition(() => setTransferRev((v) => v + delta));
    },
    [scheduleUiFlush],
  );

  const setNowPulseSafe = useCallback(
    (next: number) => {
      if (unmounted.current) return;

      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingNowPulseRef.current = next;
        scheduleUiFlush();
        return;
      }
      startTransition(() => setNowPulse(next));
    },
    [scheduleUiFlush],
  );

  // Toggle anchor preservation
  const lastToggleAnchorRef = useRef<{ id: string; scrollTop: number; rectTop: number } | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = useCallback(
    (id: string) => {
      markInteracting(UI_TOGGLE_INTERACT_MS);

      const el = scrollElRef.current;
      if (el) {
        const sel = `[data-node-id="${cssEscape(id)}"]`;
        const nodeEl = el.querySelector(sel) as HTMLElement | null;
        lastToggleAnchorRef.current = { id, scrollTop: el.scrollTop, rectTop: nodeEl ? nodeEl.getBoundingClientRect().top : 0 };
      }

      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

      scheduleUiFlush();
    },
    [markInteracting, scheduleUiFlush],
  );

  useEffect(() => {
    if (!hasWindow) return;
    const tick = () => setNowPulseSafe(getKaiPulseEternalInt(new Date()));
    const id = window.setInterval(tick, 6000);
    return () => window.clearInterval(id);
  }, [setNowPulseSafe]);

  // Prevent browser pull-to-refresh overscroll while explorer is open
  useEffect(() => {
    if (!hasWindow) return;

    const html = document.documentElement as HTMLElement | null;
    const body = document.body as HTMLElement | null;
    const root = (document.scrollingElement as HTMLElement | null) || (document.documentElement as HTMLElement | null);

    const prev = {
      htmlOverscroll: html?.style.overscrollBehavior ?? "",
      htmlOverscrollY: html?.style.overscrollBehaviorY ?? "",
      bodyOverscroll: body?.style.overscrollBehavior ?? "",
      bodyOverscrollY: body?.style.overscrollBehaviorY ?? "",
      rootOverscroll: root?.style.overscrollBehavior ?? "",
      rootOverscrollY: root?.style.overscrollBehaviorY ?? "",
    };

    if (html) {
      html.style.overscrollBehavior = "none";
      html.style.overscrollBehaviorY = "none";
    }
    if (body) {
      body.style.overscrollBehavior = "none";
      body.style.overscrollBehaviorY = "none";
    }
    if (root) {
      root.style.overscrollBehavior = "none";
      root.style.overscrollBehaviorY = "none";
    }

    return () => {
      if (html) {
        html.style.overscrollBehavior = prev.htmlOverscroll;
        html.style.overscrollBehaviorY = prev.htmlOverscrollY;
      }
      if (body) {
        body.style.overscrollBehavior = prev.bodyOverscroll;
        body.style.overscrollBehaviorY = prev.bodyOverscrollY;
      }
      if (root) {
        root.style.overscrollBehavior = prev.rootOverscroll;
        root.style.overscrollBehaviorY = prev.rootOverscrollY;
      }
    };
  }, []);

  // Touch guard: prevent top/bottom overdrag from triggering pull-to-refresh
  useEffect(() => {
    if (!hasWindow) return;
    const el = scrollElRef.current;
    if (!el) return;

    let lastY = 0;
    let lastX = 0;

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      lastY = ev.touches[0]?.clientY ?? 0;
      lastX = ev.touches[0]?.clientX ?? 0;
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (!ev.cancelable) return;
      if (ev.touches.length !== 1) return;

      const y = ev.touches[0]?.clientY ?? 0;
      const x = ev.touches[0]?.clientX ?? 0;

      const dy = y - lastY;
      const dx = x - lastX;

      lastY = y;
      lastX = x;

      if (Math.abs(dy) <= Math.abs(dx)) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= maxScroll - 1;

      const pullingDown = dy > 0;
      const pushingUp = dy < 0;

      if ((atTop && pullingDown && window.scrollY <= 0) || (atBottom && pushingUp)) {
        ev.preventDefault();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // Scroll listener (isolated)
  useEffect(() => {
    if (!hasWindow) return;
    const el = scrollElRef.current;
    if (!el) return;

    const onScroll = () => {
      scrollingRef.current = true;
      markInteracting(UI_SCROLL_INTERACT_MS);

      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollingRef.current = false;
        scrollIdleTimerRef.current = null;
        scheduleUiFlush();
      }, 180);
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
      scrollingRef.current = false;
    };
  }, [markInteracting, scheduleUiFlush]);

  const handleOpenPulseView = useCallback((target: PulseViewTarget) => {
    if (!Number.isFinite(target.pulse)) return;
    setPulseView({
      open: true,
      pulse: target.pulse,
      originUrl: target.originUrl,
      originHash: target.originHash,
      anchor: target.anchor,
    });
  }, []);

  // Apply toggle anchor preservation after DOM commit
  useLayoutEffect(() => {
    const anchor = lastToggleAnchorRef.current;
    if (!anchor) return;
    lastToggleAnchorRef.current = null;

    const el = scrollElRef.current;
    if (!el) return;

    const sel = `[data-node-id="${cssEscape(anchor.id)}"]`;
    const nodeEl = el.querySelector(sel) as HTMLElement | null;
    if (!nodeEl) return;

    const afterTop = nodeEl.getBoundingClientRect().top;
    const delta = afterTop - anchor.rectTop;

    if (Number.isFinite(delta) && Math.abs(delta) > 1) {
      el.scrollTop = Math.max(0, anchor.scrollTop + delta);
    }
  }, [expanded]);

  // Remote seal + sync guards
  const remoteSealRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const lastFullSeedSealRef = useRef<string | null>(null);

  useEffect(() => {
    unmounted.current = false;

    loadApiBackupDeadUntil();
    loadApiBaseHint();

    loadUrlHealthFromStorage();
    loadInhaleQueueFromStorage();

    const hydrated = ensureRegistryHydrated();
    if (hydrated) bump();

    // Inhale current URL if it contains a payload
    if (hasWindow) {
      const here = canonicalizeUrl(window.location.href);
      if (extractPayloadFromUrl(here)) {
        const changed = addUrl(here, { includeAncestry: true, broadcast: false, persist: true, source: "local", enqueueToApi: true });
        setLastAddedSafe(browserViewUrl(here));
        if (changed) bump();
      }
    }

    // Stable global hook
    const prev = window.__SIGIL__?.registerSigilUrl;
    const prevSend = window.__SIGIL__?.registerSend;
    if (!window.__SIGIL__) window.__SIGIL__ = {};
    window.__SIGIL__.registerSigilUrl = registerSigilUrlGlobal;
    window.__SIGIL__.registerSend = (rec: unknown) => {
      if (!rec || typeof rec !== "object") return;
      const url = (rec as { url?: unknown }).url;
      if (typeof url !== "string" || !url.trim()) return;
      const changed = addUrl(url, { includeAncestry: true, broadcast: true, persist: true, source: "local", enqueueToApi: true });
      if (changed) {
        setLastAddedSafe(browserViewUrl(url));
        bump();
      }
    };

    // event surface
    const onUrlRegistered = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        const changed = addUrl(u, { includeAncestry: true, broadcast: true, persist: true, source: "local", enqueueToApi: true });
        if (changed) {
          setLastAddedSafe(browserViewUrl(u));
          bump();
        }
      }
    };
    window.addEventListener("sigil:url-registered", onUrlRegistered as EventListener);

    const onMint = (e: Event) => {
      const anyEvent = e as CustomEvent<{ url: string }>;
      const u = anyEvent?.detail?.url;
      if (typeof u === "string" && u.length) {
        const changed = addUrl(u, { includeAncestry: true, broadcast: true, persist: true, source: "local", enqueueToApi: true });
        if (changed) {
          setLastAddedSafe(browserViewUrl(u));
          bump();
        }
      }
    };
    window.addEventListener("sigil:minted", onMint as EventListener);

    // Cross-tab quick add
    const channel = hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(SIGIL_EXPLORER_CHANNEL_NAME) : null;
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as unknown as { type?: unknown; url?: unknown };
      if (data?.type === "sigil:add" && typeof data.url === "string") {
        const changed = addUrl(data.url, { includeAncestry: true, broadcast: false, persist: true, source: "local", enqueueToApi: true });
        if (changed) {
          setLastAddedSafe(browserViewUrl(data.url));
          bump();
        }
      }
    };
    channel?.addEventListener("message", onMsg);

    // Storage hydration (registry + modal fallback + transfers)
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      const isRegistryKey = ev.key === REGISTRY_LS_KEY;
      const isModalKey = ev.key === MODAL_FALLBACK_LS_KEY;
      const isTransferKey = ev.key === SIGIL_TRANSFER_LS_KEY;

      if (isTransferKey) {
        bumpTransferRevSafe();
        return;
      }
      if (!isRegistryKey && !isModalKey) return;
      if (!ev.newValue) return;

      try {
        const urls: unknown = JSON.parse(ev.newValue);
        if (!Array.isArray(urls)) return;

        let changed = false;
        for (const u of urls) {
          if (typeof u !== "string") continue;
          if (addUrl(u, { includeAncestry: true, broadcast: false, persist: false, source: "local", enqueueToApi: true })) changed = true;
        }

        setLastAddedSafe(undefined);
        if (changed) {
          persistRegistryToStorage();
          bump();
        }
      } catch {}
    };
    window.addEventListener("storage", onStorage);

    const onTransferEvent = () => bumpTransferRevSafe();
    window.addEventListener(SIGIL_TRANSFER_EVENT, onTransferEvent as EventListener);

    const transferChannel = hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(SIGIL_TRANSFER_CHANNEL_NAME) : null;
    const onTransferMsg = (ev: MessageEvent) => {
      const data = ev.data as unknown as { type?: unknown };
      if (data?.type === "transfer:update") bumpTransferRevSafe();
    };
    transferChannel?.addEventListener("message", onTransferMsg);

    const onPageHide = () => {
      saveInhaleQueueToStorage();
      void flushInhaleQueue();
    };
    window.addEventListener("pagehide", onPageHide);

    // Username claim registry subscription (deferred)
    const unsubClaims = subscribeUsernameClaimRegistry((entry) => {
      const now = nowMs();
      if (now < interactUntilRef.current || scrollingRef.current) {
        pendingClaimEntriesRef.current.push({
          normalized: entry.normalized,
          claimHash: entry.claimHash,
          claimUrl: entry.claimUrl,
          originHash: entry.originHash,
          ownerHint: entry.ownerHint,
        });
        scheduleUiFlush();
        return;
      }

      startTransition(() => {
        setUsernameClaims((prevClaims) => {
          const current = prevClaims[entry.normalized];
          if (
            current &&
            current.claimHash === entry.claimHash &&
            current.claimUrl === entry.claimUrl &&
            current.originHash === entry.originHash &&
            current.ownerHint === entry.ownerHint
          ) {
            return prevClaims;
          }
          return { ...prevClaims, [entry.normalized]: entry };
        });
      });
    });

    // BREATH LOOP: inhale(push) ⇄ exhale(pull)
    const ac = new AbortController();

    const inhaleOnce = async (reason: SyncReason) => {
      if (unmounted.current) return;
      if (!isOnline()) return;
      if (scrollingRef.current) return;
      if (nowMs() < interactUntilRef.current && (reason === "pulse" || reason === "import")) return;

      await flushInhaleQueue();
    };

    const exhaleOnce = async (reason: SyncReason) => {
      if (unmounted.current) return;
      if (!isOnline()) return;
      if (syncInFlightRef.current) return;
      if (scrollingRef.current) return;
      if (nowMs() < interactUntilRef.current && (reason === "pulse" || reason === "import")) return;

      syncInFlightRef.current = true;
      try {
        const prevSeal = remoteSealRef.current;

        const res = await apiFetchWithFailover((base) => new URL(API_SEAL_PATH, base).toString(), {
          method: "GET",
          cache: "no-store",
          signal: ac.signal,
          headers: undefined,
        });

        if (!res) return;
        if (res.status === 304) return;
        if (!res.ok) return;

        let nextSeal = "";
        let remotePulse: number | undefined;
        try {
          const body = (await res.json()) as ApiSealResponse;
          nextSeal = typeof body?.seal === "string" ? body.seal : "";
          remotePulse = readRemotePulse(body);
        } catch {
          return;
        }

        const localLatestPulse = remotePulse != null ? getLatestPulseFromRegistry() : undefined;
        const hasNewerPulse =
          remotePulse != null && (localLatestPulse == null || remotePulse > localLatestPulse);

        if (prevSeal && nextSeal && prevSeal === nextSeal && !hasNewerPulse) {
          remoteSealRef.current = nextSeal;
          return;
        }

        const importedRes = await pullAndImportRemoteUrls(ac.signal);

        if (importedRes.pulled) {
          remoteSealRef.current = importedRes.remoteSeal ?? nextSeal ?? prevSeal ?? null;
        }

        if (importedRes.imported > 0) {
          setLastAddedSafe(undefined);
          bump();
        }

        const sealNow = remoteSealRef.current;
        const shouldFullSeed =
          reason === "open" ||
          ((reason === "visible" || reason === "focus" || reason === "online" || reason === "import") &&
            sealNow !== lastFullSeedSealRef.current);

        if (shouldFullSeed) {
          seedInhaleFromRegistry();
          lastFullSeedSealRef.current = sealNow;
          await flushInhaleQueue();
        }
      } finally {
        syncInFlightRef.current = false;
      }
    };

    syncNowRef.current = async (reason: SyncReason) => {
      await inhaleOnce(reason);
      await exhaleOnce(reason);
    };

    seedInhaleFromRegistry();
    void inhaleOnce("open");
    void exhaleOnce("open");

    let breathTimer: number | null = null;

    const scheduleNextBreath = (): void => {
      if (!hasWindow) return;
      if (unmounted.current) return;

      if (breathTimer != null) window.clearTimeout(breathTimer);

      const delay = msUntilNextKaiBreath();
      breathTimer = window.setTimeout(() => {
        breathTimer = null;

        if (document.visibilityState !== "visible") {
          scheduleNextBreath();
          return;
        }
        if (!isOnline()) {
          scheduleNextBreath();
          return;
        }

        void inhaleOnce("pulse");
        void exhaleOnce("pulse");
        scheduleNextBreath();
      }, delay);
    };

    const resnapBreath = (): void => {
      scheduleNextBreath();
    };

    scheduleNextBreath();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        resnapBreath();
        void inhaleOnce("visible");
        void exhaleOnce("visible");
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const onFocus = () => {
      resnapBreath();
      void inhaleOnce("focus");
      void exhaleOnce("focus");
    };

    const onOnline = () => {
      resnapBreath();
      void inhaleOnce("online");
      void exhaleOnce("online");
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      if (window.__SIGIL__) {
        window.__SIGIL__.registerSigilUrl = prev;
        window.__SIGIL__.registerSend = prevSend;
      }

      window.removeEventListener("sigil:url-registered", onUrlRegistered as EventListener);
      window.removeEventListener("sigil:minted", onMint as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SIGIL_TRANSFER_EVENT, onTransferEvent as EventListener);

      transferChannel?.removeEventListener("message", onTransferMsg);
      transferChannel?.close();

      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);

      channel?.removeEventListener("message", onMsg);
      channel?.close();

      if (typeof unsubClaims === "function") unsubClaims();

      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;

      if (breathTimer != null) window.clearTimeout(breathTimer);
      breathTimer = null;

      ac.abort();
      syncNowRef.current = null;
      unmounted.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, markInteracting, scheduleUiFlush, setLastAddedSafe]);

  const requestImmediateSync = useCallback((reason: SyncReason) => {
    const fn = syncNowRef.current;
    if (fn) void fn(reason);
  }, []);

  useEffect(() => {
    if (!hasWindow) return;
    const onOpen = () => requestImmediateSync("visible");
    window.addEventListener(SIGIL_EXPLORER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SIGIL_EXPLORER_OPEN_EVENT, onOpen);
  }, [requestImmediateSync]);

  const forest = useMemo(() => buildForest(memoryRegistry), [registryRev]);
  const transferRegistry = useMemo(() => readSigilTransferRegistry(), [transferRev]);
  const receiveLocks = useMemo(() => buildReceiveLockIndex(memoryRegistry), [registryRev, transferRev]);

  const totalKeys = useMemo(() => {
    let n = 0;
    for (const [,] of memoryRegistry) n += 1;
    return n;
  }, [registryRev]);

  const valueSnapshots = useMemo(() => {
    const out = new Map<string, NodeValueSnapshot>();

    const walk = (
      node: SigilNode,
    ): { receivedFromParent: number; pendingFromParent: number; liftToParent: number } => {
      const basePhi = computeLivePhi(node.payload, nowPulse);
      const usdPerPhi = computeUsdPerPhi(node.payload, nowPulse);
      const transferMove = resolveTransferMoveForNode(node, transferRegistry) ?? null;
      const transferStatus = resolveTransferStatusForNode(node, transferRegistry, receiveLocks);
      const receivedAmount = transferStatus === "received" && transferMove ? transferMove.amount : 0;
      const baseValue = receivedAmount > 0 ? receivedAmount : basePhi ?? 0;

      let childReceivedTotal = 0;
      let childPendingTotal = 0;
      let childLiftTotal = 0;
      for (const child of node.children) {
        const childSummary = walk(child);
        childReceivedTotal += childSummary.receivedFromParent;
        childPendingTotal += childSummary.pendingFromParent;
        childLiftTotal += childSummary.liftToParent;
      }

      const pendingOutgoing = transferStatus === "pending" && transferMove?.direction === "send" ? transferMove.amount : 0;
      const netPhi = Math.max(0, baseValue + childLiftTotal - childReceivedTotal);
      const usdValue =
        transferStatus === "received" && transferMove?.amountUsd
          ? transferMove.amountUsd
          : usdPerPhi != null
            ? netPhi * usdPerPhi
            : null;

      const pendingFromParent = pendingOutgoing;
      const liftToParent = contentKindForUrl(node.url) === "stream" ? netPhi : 0;
      out.set(node.id, {
        basePhi,
        netPhi: Number.isFinite(netPhi) ? netPhi : null,
        usdValue,
        usdPerPhi,
        transferMove,
        receivedAmount,
        receivedFromChildren: childReceivedTotal,
        pendingFromChildren: childPendingTotal,
        pendingFromParent,
      });

      return {
        receivedFromParent: receivedAmount,
        pendingFromParent,
        liftToParent,
      };
    };

    for (const root of forest) walk(root);
    return out;
  }, [forest, nowPulse, receiveLocks, transferRegistry]);

  const phiTotalsByPulse = useMemo((): ReadonlyMap<number, number> => {
    const totals = new Map<number, number>();
    const seenByPulse = new Map<number, Set<string>>();

    for (const [rawUrl, payload] of memoryRegistry) {
      const pulse = typeof payload.pulse === "number" ? payload.pulse : undefined;
      if (pulse == null) continue;

      const url = canonicalizeUrl(rawUrl);
      const mkey = momentKeyFor(url, payload);

      let seen = seenByPulse.get(pulse);
      if (!seen) {
        seen = new Set<string>();
        seenByPulse.set(pulse, seen);
      }
      if (seen.has(mkey)) continue;
      seen.add(mkey);

      const amt = getPhiFromPayload(payload);
      if (amt === undefined) continue;

      totals.set(pulse, (totals.get(pulse) ?? 0) + amt);
    }

    return totals;
  }, [registryRev]);

  const prefetchTargets = useMemo((): string[] => {
    const urls: string[] = [];
    for (const [rawUrl] of memoryRegistry) {
      const viewUrl = explorerOpenUrl(rawUrl);
      const canon = canonicalizeUrl(viewUrl);
      if (!urls.includes(canon)) urls.push(canon);
    }
    return urls;
  }, [registryRev]);

  useEffect(() => {
    if (!hasWindow) return;
    if (prefetchTargets.length === 0) return;

    const pending = prefetchTargets.filter((u) => !prefetchedRef.current.has(u));
    if (pending.length === 0) return;

    let cancelled = false;

    const runPrefetch = async () => {
      for (const u of pending) {
        if (cancelled) break;
        prefetchedRef.current.add(u);
        await prefetchViewUrl(u);
      }
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let cancel: (() => void) | null = null;

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => void runPrefetch(), { timeout: 1000 });
      cancel = () => w.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(() => void runPrefetch(), 120);
      cancel = () => window.clearTimeout(id);
    }

    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [prefetchTargets]);

  const probePrimaryCandidates = useCallback(async () => {
    if (!hasWindow) return;
    if (scrollingRef.current) return;
    if (!isOnline()) return;
    if (nowMs() < interactUntilRef.current) return;

    const candidates: string[] = [];

    const walk = (n: SigilNode) => {
      if (n.urls.length > 1) {
        const prefer = contentKindForUrl(n.url);

        const normalized = [...n.urls]
          .map((u) => canonicalizeUrl(browserViewUrl(u)))
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => scoreUrlForView(b, prefer) - scoreUrlForView(a, prefer));

        for (const u of normalized.slice(0, 2)) {
          const key = canonicalizeUrl(u);
          if (!urlHealth.has(key) && !candidates.includes(key)) candidates.push(key);
        }
      }
      n.children.forEach(walk);
    };

    for (const r of forest) walk(r);
    if (candidates.length === 0) return;

    for (const u of candidates.slice(0, URL_PROBE_MAX_PER_REFRESH)) {
      const res = await probeUrl(u);
      if (res === "ok") setUrlHealth(u, 1);
      if (res === "bad") setUrlHealth(u, -1);
    }
  }, [forest]);

  useEffect(() => {
    if (!hasWindow) return;

    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      void probePrimaryCandidates();
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let cancel: (() => void) | null = null;

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 900 });
      cancel = () => w.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(run, 250);
      cancel = () => window.clearTimeout(id);
    }

    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [registryRev, probePrimaryCandidates]);

  const handleAdd = useCallback(
    (url: string) => {
      markInteracting(UI_TOGGLE_INTERACT_MS);

      const changed = addUrl(url, { includeAncestry: true, broadcast: true, persist: true, source: "local", enqueueToApi: true });
      // addUrl already enqueues when requested

      if (changed) {
        setLastAddedSafe(browserViewUrl(url));
        bump();
      }
    },
    [bump, markInteracting, setLastAddedSafe],
  );

  const handleImport = useCallback(
    async (file: File) => {
      markInteracting(0);

      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = await parseJsonAsync(text);
      } catch {
        return;
      }

      const { urls, rawKrystals } = parseImportedJson(parsed);
      if (urls.length === 0 && rawKrystals.length === 0) return;

      let changed = false;

      for (let i = 0; i < rawKrystals.length; i += IMPORT_BATCH_SIZE) {
        for (const k of rawKrystals.slice(i, i + IMPORT_BATCH_SIZE)) {
          enqueueInhaleRawKrystal(k);
        }
        if (i + IMPORT_BATCH_SIZE < rawKrystals.length) await yieldToMain();
      }

      for (let i = 0; i < urls.length; i += IMPORT_BATCH_SIZE) {
        for (const u of urls.slice(i, i + IMPORT_BATCH_SIZE)) {
          if (
            addUrl(u, {
              includeAncestry: true,
              broadcast: true,
              persist: true,
              source: "import",
              enqueueToApi: true,
            })
          ) {
            changed = true;
          }
          // addUrl already enqueues when requested
        }

        if (changed) {
          setLastAddedSafe(undefined);
          bump();
        }

        if (i + IMPORT_BATCH_SIZE < urls.length) await yieldToMain();
      }

      // If import had explicit urls, push them immediately (fast UX)
      if (urls.length > 0) forceInhaleUrls(urls);

      if (changed) {
        setLastAddedSafe(undefined);
        bump();
      }

      requestImmediateSync("import");
    },
    [bump, markInteracting, requestImmediateSync, setLastAddedSafe],
  );

  const handleExport = useCallback(() => {
    markInteracting(UI_TOGGLE_INTERACT_MS);

    const urls: string[] = [];
    for (const [u] of memoryRegistry) urls.push(u);

    const blob = new Blob([JSON.stringify({ urls }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sigil-registry-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [markInteracting]);

  return (
    <div className="sigil-explorer" aria-label="Kairos Keystream Explorer">
      <ExplorerToolbar
        onAdd={handleAdd}
        onImport={handleImport}
        onExport={handleExport}
        total={totalKeys}
        lastAdded={lastAdded}
        viewMode={viewMode}
        onViewModeChange={(next) => {
          markInteracting(UI_TOGGLE_INTERACT_MS);
          setViewMode(next);
        }}
      />

      <div
        className={["explorer-scroll", viewMode === "lattice" ? "explorer-scroll--lattice" : ""].filter(Boolean).join(" ")}
        ref={scrollElRef}
        role="region"
        aria-label="Explorer scroll viewport"
      >
        <div className="explorer-inner">
          {viewMode === "keystream" ? (
            <>
              {forest.length === 0 ? (
                <div className="kx-empty">
                  <p>No sigil-glyphs in your keystream yet.</p>
                  <ol>
                    <li>Import your keystream memories.</li>
                    <li>Seal a moment — auto-registered here.</li>
                    <li>Inhale any sigil-glyph or memory key above — lineage aligns instantly.</li>
                  </ol>
                </div>
              ) : (
                <div className="forest" aria-label="Sigil forest">
                  {forest.map((root) => (
                    <OriginPanel
                      key={root.id}
                      root={root}
                      expanded={expanded}
                      toggle={toggle}
                      phiTotalsByPulse={phiTotalsByPulse}
                      usernameClaims={usernameClaims}
                      transferRegistry={transferRegistry}
                      receiveLocks={receiveLocks}
                      valueSnapshots={valueSnapshots}
                      onOpenPulseView={handleOpenPulseView}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="kx-view kx-view--lattice" aria-label="Memory">
              <SigilHoneycombExplorer className="kx-lattice" syncMode="embedded" onOpenPulseView={handleOpenPulseView} />
            </div>
          )}

          <footer className="kx-footer" aria-label="Explorer footer">
            <span className="row">
               <span>Determinate • Stateless • Kairos-Memory</span>
              <span className="dot">•</span>
              <span>{isOnline() ? "online" : "offline"}</span>
              <span className="dot">•</span>
              <span>{totalKeys} keys</span>
            </span>
          </footer>
        </div>
      </div>

      <PulseHoneycombModal
        open={pulseView.open}
        pulse={pulseView.pulse}
        originUrl={pulseView.originUrl}
        originHash={pulseView.originHash}
        anchor={pulseView.anchor}
        registryRev={registryRev}
        onClose={() => setPulseView({ open: false, pulse: null, anchor: undefined })}
      />
    </div>
  );
};

export default SigilExplorer;
