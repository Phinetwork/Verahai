// src/components/verifier/VerifierStamper.tsx
// VerifierStamper.tsx · Divine Sovereign Transfer Gate (mobile-first)
// v25.1 — NO-ZOOM SEND INPUT (iOS Safari-safe wrapper + hooks)
//         value strip positioned under Pulse/Beat/Step/Day (above Presence/Stewardship/Memory tabs),
//         breath-synced trend pills (▲ green / ▼ red / none on flat),
//         + click-to-open LiveChart popover (Φ/$ pills), μΦ-locked exhale parity + ChakraGate surfacing,
//         child-lock + valuation parity

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./VerifierStamper.css";
import SendPhiAmountField from "./SendPhiAmountField";
import useRollingChartSeries from "./hooks/useRollingChartSeries";
import { KV, ValueChip, IconBtn } from "./ui";
import { S } from "./styles";
import {
  getSigilZkBridge,
  getSigilZkVkey,
  setSigilZkVkey,
  setVerifierBridge,
} from "./window";

/* ───────── μΦ parity helpers (shared with ValuationModal) ───────── */
import {
  snap6, // -> number snapped to 6dp
  toScaled6, // -> bigint scaled at 6dp
  toStr6, // -> string with exactly 6dp from a 6dp-scaled bigint
} from "../../utils/phi-precision";

/* Modularized (use local ./ paths from inside /verifier) */
import VerifierErrorBoundary from "../verifier/VerifierErrorBoundary";
import type {
  SigilMetadata,
  SigilMetadataWithOptionals,
  UiState,
  TabKey,
  ChakraDay,
  SigilTransfer,
  HardenedTransferV14,
  SigilPayload,
  ZkBundle,
  ZkRef,
} from "../verifier/types/local";
import { resolveChakraDay } from "../verifier/types/local";
import { logError } from "../verifier/utils/log";
import { base64EncodeUtf8, base64DecodeUtf8 } from "../verifier/utils/base64";
import { registerSigilUrl } from "../../utils/sigilRegistry";
import { buildNotePayload } from "../verifier/utils/notePayload";
import {
  toScaledBig,
  fromScaledBig,
  mulScaled,
  divScaled,
  roundScaledToDecimals,
  fromScaledBigFixed,
  fmtPhiFixed4,
  exhalePhiFromTransferScaled,
} from "../verifier/utils/decimal";
import {
  getChildLockInfo,
  CLAIM_STEPS,
  CLAIM_PULSES,
} from "../verifier/utils/childExpiry";
import { deriveState } from "../verifier/utils/stateMachine";
import { publishRotation } from "../verifier/utils/rotationBus";
import { rewriteUrlPayload } from "../verifier/utils/urlPayload";
import { safeShowDialog, switchModal } from "../verifier/utils/modal";
import { getSigilGlobal } from "../verifier/utils/sigilGlobal";
import { getFirst, getPath, fromSvgDataset } from "../verifier/utils/metaDataset";
import JsonTree from "../verifier/ui/JsonTree";
import StatusChips from "../verifier/ui/StatusChips";

/* Existing flows kept */
import SealMomentModal from "../SealMomentModalTransfer";
import ValuationModal from "../ValuationModal";
import { buildValueSeal, attachValuation, type ValueSeal } from "../../utils/valuation";
import NotePrinter from "../ExhaleNote";
import type { BanknoteInputs as NoteBanknoteInputs, VerifierBridge } from "../exhale-note/types";

import { kaiPulseNow, SIGIL_CTX, SIGIL_TYPE, SEGMENT_SIZE } from "./constants";
import { sha256Hex, phiFromPublicKey } from "./crypto";
import { loadOrCreateKeypair, signB64u, type Keypair } from "./keys";
import { parseSvgFile, centrePixelSignature, embedMetadata, embedMetadataText, pngBlobFromSvgDataUrl } from "./svg";
import { pulseFilename, safeFilename, download, fileToPayload } from "./files";
import {
  computeKaiSignature,
  derivePhiKeyFromSig,
  expectedPrevHeadRootV14,
  stableStringify,
  hashTransfer,
  hashTransferSenderSide,
  genNonce,
} from "./sigilUtils";
import { buildMerkleRoot, merkleProof, verifyProof } from "./merkle";
import { sealCurrentWindowIntoSegment } from "./segments";
import { verifyHistorical } from "./verifyHistorical";
import { verifyZkOnHead } from "./zk";
import { embedProofMetadata } from "../../utils/svgProof";
import { extractProofBundleMetaFromSvg, type ProofBundleMeta } from "../../utils/sigilMetadata";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import { BREATH_MS } from "../valuation/constants";
import { recordSend, getSpentScaledFor, markConfirmedByLeaf } from "../../utils/sendLedger";
import { recordSigilTransferMovement } from "../../utils/sigilTransferRegistry";
import { buildBundleUnsigned, buildVerifierSlug, hashBundle, hashProofCapsuleV1, hashSvgText, normalizeChakraDay, PROOF_CANON, PROOF_HASH_ALG } from "../KaiVoh/verifierProof";
import { isKASAuthorSig } from "../../utils/authorSig";
import { computeZkPoseidonHash } from "../../utils/kai";
import { generateZkProofFromPoseidonHash } from "../../utils/zkProof";
import type { SigilProofHints } from "../../types/sigil";
import type { SigilSharePayloadLoose } from "../SigilExplorer/types";
import { apiFetchWithFailover, API_URLS_PATH, loadApiBackupDeadUntil, loadApiBaseHint } from "../SigilExplorer/apiClient";
import { extractPayloadFromUrl } from "../SigilExplorer/url";
import { enqueueInhaleKrystal, flushInhaleQueue } from "../SigilExplorer/inhaleQueue";
import { memoryRegistry, isOnline } from "../SigilExplorer/registryStore";
import {
  buildKasChallenge,
  ensureReceiverPasskey,
  findStoredKasPasskeyByCredId,
  getWebAuthnAssertionJson,
  isReceiveSig,
  loadStoredReceiverPasskey,
  verifyWebAuthnAssertion,
  type ReceiveSig,
} from "../../utils/webauthnReceive";

/* Live chart popover (stay inside Verifier modal) */
import LiveChart from "../valuation/chart/LiveChart";
import InhaleUploadIcon from "../InhaleUploadIcon";
import type { PhiMoveSuccessDetail, SigilMetadataLiteExtended } from "./types";

type GlyphUnlockState = {
  isRequired: boolean;
  isUnlocked: boolean;
  credId?: string;
  unlockedAtNonce?: string;
};

function readPhiAmountFromMeta(meta: SigilMetadataWithOptionals): string | undefined {
  const candidate =
    meta.childAllocationPhi ??
    meta.branchBasePhi ??
    (meta as unknown as { childAllocationPhi?: number | string }).childAllocationPhi ??
    (meta as unknown as { branchBasePhi?: number | string }).branchBasePhi;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSigilProofHints(value: unknown): value is SigilProofHints {
  if (!isRecord(value)) return false;
  return (
    typeof value.scheme === "string" &&
    typeof value.api === "string" &&
    typeof value.explorer === "string"
  );
}

function readReceiveSigFromBundle(raw: unknown): ReceiveSig | null {
  if (!isRecord(raw)) return null;
  const candidate = raw.receiveSig;
  return isReceiveSig(candidate) ? candidate : null;
}

const RECEIVE_LOCK_PREFIX = "kai:receive:lock:v1";
const RECEIVE_REMOTE_LIMIT = 200;
const RECEIVE_REMOTE_PAGES = 3;

type ApiUrlsPageResponse = {
  status: "ok";
  state_seal: string;
  total: number;
  offset: number;
  limit: number;
  urls: string[];
};

function readTransferDirection(value: unknown): "send" | "receive" | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("receive") || t.includes("received") || t.includes("inhale")) return "receive";
  if (t.includes("send") || t.includes("sent") || t.includes("exhale")) return "send";
  return null;
}

function readTransferDirectionFromPayload(payload: SigilSharePayloadLoose): "send" | "receive" | null {
  const record = payload as Record<string, unknown>;
  const readFrom = (src: Record<string, unknown> | null) =>
    src
      ? readTransferDirection(src.transferDirection) ||
        readTransferDirection(src.transferMode) ||
        readTransferDirection(src.transferKind) ||
        readTransferDirection(src.phiDirection) ||
        readTransferDirection(src.breathDirection) ||
        readTransferDirection(src.breathMode) ||
        readTransferDirection(src.breathKind) ||
        readTransferDirection(src.breath) ||
        readTransferDirection(src.direction) ||
        readTransferDirection(src.action) ||
        readTransferDirection(src.transferAction) ||
        readTransferDirection(src.transferFlow) ||
        readTransferDirection(src.flow)
      : null;
  const feed = isRecord(record.feed) ? (record.feed as Record<string, unknown>) : null;
  return readFrom(record) || readFrom(feed);
}

function readPayloadCanonical(payload: SigilSharePayloadLoose): string | null {
  const record = payload as Record<string, unknown>;
  const raw =
    record.canonicalHash ??
    record.canonical ??
    record.canonical_hash ??
    record.childHash ??
    record.hash ??
    record.sigilHash ??
    record.sigil_hash;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

function readPayloadNonce(payload: SigilSharePayloadLoose): string | null {
  const record = payload as Record<string, unknown>;
  const raw =
    record.transferNonce ??
    record.nonce ??
    record.transferToken ??
    record.token ??
    record.receiveNonce ??
    record.inhaleNonce;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function resolveOriginUrlFromRegistry(parentCanonical: string, fallbackUrl: string): string {
  if (!parentCanonical) return fallbackUrl;
  for (const payload of memoryRegistry.values()) {
    const payloadCanonical = readPayloadCanonical(payload);
    if (!payloadCanonical || payloadCanonical !== parentCanonical) continue;
    const record = payload as Record<string, unknown>;
    const originUrl = typeof record.originUrl === "string" ? record.originUrl.trim() : "";
    if (originUrl) return originUrl;
    const parentUrl = typeof record.parentUrl === "string" ? record.parentUrl.trim() : "";
    if (!parentUrl) continue;
    const parentPayload = extractPayloadFromUrl(parentUrl);
    const parentOrigin = parentPayload && typeof parentPayload.originUrl === "string" ? parentPayload.originUrl.trim() : "";
    if (parentOrigin) return parentOrigin;
  }
  return fallbackUrl;
}

function hasReceiveProofFields(payload: SigilSharePayloadLoose): boolean {
  const record = payload as Record<string, unknown>;
  const readFlag = (src: Record<string, unknown> | null) => {
    if (!src) return false;
    if (typeof src.receiverSignature === "string" && src.receiverSignature.trim()) return true;
    if (typeof src.receiverStamp === "string" && src.receiverStamp.trim()) return true;
    return typeof src.receiverKaiPulse === "number" && Number.isFinite(src.receiverKaiPulse);
  };
  const feed = isRecord(record.feed) ? (record.feed as Record<string, unknown>) : null;
  return readFlag(record) || readFlag(feed);
}

function isReceiveLockPayload(payload: SigilSharePayloadLoose): boolean {
  return readTransferDirectionFromPayload(payload) === "receive" || hasReceiveProofFields(payload);
}

function collectReceiveSigHistory(raw: Record<string, unknown>, nextSig?: ReceiveSig | null): ReceiveSig[] {
  const history: ReceiveSig[] = [];
  const existing = raw.receiveSigHistory;
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (isReceiveSig(item)) history.push(item);
    }
  }
  if (nextSig) history.push(nextSig);
  return history;
}

function readExhaleInfoFromTransfer(
  transfer?: SigilTransfer
): { amountUsd?: string; sentPulse?: number } {
  if (!transfer) return {};
  let sentPulse = typeof transfer.senderKaiPulse === "number" ? transfer.senderKaiPulse : undefined;
  let amountUsd: string | undefined;

  try {
    if (transfer.payload?.mime?.startsWith("application/vnd.kairos-exhale")) {
      const obj = JSON.parse(base64DecodeUtf8(transfer.payload.encoded)) as
        | { kind?: string; amountUsd?: string | number; atPulse?: number }
        | null;
      if (obj?.kind === "exhale") {
        if (typeof obj.amountUsd === "string" && obj.amountUsd.trim()) {
          amountUsd = obj.amountUsd.trim();
        } else if (typeof obj.amountUsd === "number" && Number.isFinite(obj.amountUsd)) {
          amountUsd = obj.amountUsd.toFixed(2);
        }
        if (typeof obj.atPulse === "number" && Number.isFinite(obj.atPulse)) {
          sentPulse = obj.atPulse;
        }
      }
    }
  } catch (err) {
    logError("exhale.decodeTransferInfo", err);
  }

  return { amountUsd, sentPulse };
}

function dispatchPhiMoveSuccess(detail: PhiMoveSuccessDetail) {
  try {
    window.dispatchEvent(new CustomEvent<PhiMoveSuccessDetail>("phi:move", { detail }));
  } catch (err) {
    logError("dispatch(phi:move)", err);
  }
}

function registerUrlForExplorer(url: string) {
  registerSigilUrl(url);
}

/* ═════════════ Component ═════════════ */
const VerifierStamperInner: React.FC = () => {
  const svgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);
  const noteDlgRef = useRef<HTMLDialogElement>(null);

  const [pulseNow, setPulseNow] = useState<number>(kaiPulseNow());
  useEffect(() => {
    const id = window.setInterval(() => setPulseNow(kaiPulseNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    loadApiBackupDeadUntil();
    loadApiBaseHint();
  }, []);

  const [svgURL, setSvgURL] = useState<string | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [rawMeta, setRawMeta] = useState<string | null>(null);
  const [meta, setMeta] = useState<SigilMetadata | null>(null);

  const [contentSigExpected, setContentSigExpected] = useState<string | null>(null);
  const [contentSigMatches, setContentSigMatches] = useState<boolean | null>(null);
  const [phiKeyExpected, setPhiKeyExpected] = useState<string | null>(null);
  const [phiKeyMatches, setPhiKeyMatches] = useState<boolean | null>(null);

  const [liveSig, setLiveSig] = useState<string | null>(null);
  const [rgbSeed, setRgbSeed] = useState<[number, number, number] | null>(null);

  const [payload, setPayload] = useState<SigilPayload | null>(null);

  const [amountMode, setAmountMode] = useState<"USD" | "PHI">("PHI");
  const [phiInput, setPhiInput] = useState<string>("");
  const [usdInput, setUsdInput] = useState<string>("");

  const [uiState, setUiState] = useState<UiState>("idle");
  const [tab, setTab] = useState<TabKey>("summary");
  const [error, setError] = useState<string | null>(null);
  const [viewRaw, setViewRaw] = useState<boolean>(false);

  const [headProof, setHeadProof] = useState<{ ok: boolean; index: number; root: string } | null>(null);

  const [sealOpen, setSealOpen] = useState<boolean>(false);
  const [sealUrl, setSealUrl] = useState<string>("");
  const [sealHash, setSealHash] = useState<string>("");
  const [valuationOpen, setValuationOpen] = useState<boolean>(false);
  const [noteOpen, setNoteOpen] = useState<boolean>(false);
  const [sigilSvgRaw, setSigilSvgRaw] = useState<string | null>(null);
  const [proofBundleMeta, setProofBundleMeta] = useState<ProofBundleMeta | null>(null);
  const [bundleHash, setBundleHash] = useState<string | null>(null);

  const [unlockState, setUnlockState] = useState<GlyphUnlockState>({ isRequired: false, isUnlocked: false });
  const [unlockBusy, setUnlockBusy] = useState<boolean>(false);
  const [unlockAvailable, setUnlockAvailable] = useState<boolean>(false);
  const autoUnlockRef = useRef<string | null>(null);

  const [receiveSig, setReceiveSig] = useState<ReceiveSig | null>(null);
  const [receiveStatus, setReceiveStatus] = useState<"idle" | "new" | "already">("idle");
  const [receiveBusy, setReceiveBusy] = useState<boolean>(false);
  const autoReceiveRef = useRef<string | null>(null);

  const [rotateOut, setRotateOut] = useState<boolean>(false);
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (rotateOut) d.setAttribute("data-rotate", "true");
    else d.removeAttribute("data-rotate");
  }, [rotateOut]);

  const resolveReceiverPasskey = useCallback(async () => {
    const receiver = loadStoredReceiverPasskey();
    if (receiver) return receiver;
    return ensureReceiverPasskey();
  }, []);

  const computeBundleHashFromSvg = useCallback(
    async (svgText: string, metaValue: SigilMetadata, proofMetaValue: ProofBundleMeta | null): Promise<string | null> => {
      if (!svgText.trim()) return null;
      const svgHash = await hashSvgText(svgText);
      const proofCapsule = proofMetaValue?.proofCapsule;
      const capsuleHash = proofMetaValue?.capsuleHash ?? (proofCapsule ? await hashProofCapsuleV1(proofCapsule) : null);
      let bundleSeed: Record<string, unknown> | null = null;
      if (proofMetaValue?.raw && isRecord(proofMetaValue.raw)) {
        bundleSeed = { ...(proofMetaValue.raw as Record<string, unknown>), svgHash, capsuleHash, proofCapsule: proofCapsule ?? undefined };
      } else if (metaValue.kaiSignature && typeof metaValue.pulse === "number") {
        const chakraDay = normalizeChakraDay(metaValue.chakraDay ?? "") ?? "Crown";
        const verifierSlug = buildVerifierSlug(metaValue.pulse, metaValue.kaiSignature);
        const phiKey = metaValue.userPhiKey ?? (await derivePhiKeyFromSig(metaValue.kaiSignature));
        const fallbackCapsule = {
          v: "KPV-1" as const,
          pulse: metaValue.pulse,
          chakraDay,
          kaiSignature: metaValue.kaiSignature,
          phiKey,
          verifierSlug,
        };
        const capsuleHashNext = capsuleHash ?? (await hashProofCapsuleV1(fallbackCapsule));
        bundleSeed = {
          hashAlg: proofMetaValue?.hashAlg ?? PROOF_HASH_ALG,
          canon: proofMetaValue?.canon ?? PROOF_CANON,
          proofCapsule: fallbackCapsule,
          capsuleHash: capsuleHashNext,
          svgHash,
          shareUrl: proofMetaValue?.shareUrl,
          verifierUrl: proofMetaValue?.verifierUrl,
          zkPoseidonHash: proofMetaValue?.zkPoseidonHash,
          zkProof: proofMetaValue?.zkProof,
          proofHints: proofMetaValue?.proofHints,
          zkPublicInputs: proofMetaValue?.zkPublicInputs,
          authorSig: proofMetaValue?.authorSig ?? null,
        };
      }

      if (!bundleSeed) return null;
      const bundleUnsigned = buildBundleUnsigned(bundleSeed);
      return hashBundle(bundleUnsigned);
    },
    []
  );

  const attemptUnlock = useCallback(
    async (mode: "auto" | "manual"): Promise<void> => {
      if (unlockBusy || unlockState.isUnlocked) return;
      if (!bundleHash || !proofBundleMeta?.authorSig || !isKASAuthorSig(proofBundleMeta.authorSig)) return;
      if (!findStoredKasPasskeyByCredId(proofBundleMeta.authorSig.credId)) return;

      setUnlockBusy(true);
      try {
        const { nonce, challengeBytes } = await buildKasChallenge("unlock", bundleHash);
        const assertion = await getWebAuthnAssertionJson({
          challenge: challengeBytes,
          allowCredIds: [proofBundleMeta.authorSig.credId],
          preferInternal: true,
        });
        const ok = await verifyWebAuthnAssertion({
          assertion,
          expectedChallenge: challengeBytes,
          pubKeyJwk: proofBundleMeta.authorSig.pubKeyJwk,
          expectedCredId: proofBundleMeta.authorSig.credId,
        });
        if (!ok) {
          setError("Unlock failed.");
          return;
        }
        setUnlockState({ isRequired: true, isUnlocked: true, credId: proofBundleMeta.authorSig.credId, unlockedAtNonce: nonce });
      } catch {
        if (mode === "manual") setError("Unlock canceled.");
      } finally {
        setUnlockBusy(false);
      }
    },
    [unlockBusy, unlockState.isUnlocked, bundleHash, proofBundleMeta?.authorSig]
  );

  const claimReceiveSig = useCallback(async (): Promise<ReceiveSig | null> => {
    if (receiveBusy || receiveStatus !== "new") return null;
    if (!bundleHash) return null;
    setReceiveBusy(true);
    try {
      const passkey = await resolveReceiverPasskey();
      const { nonce, challengeBytes } = await buildKasChallenge("receive", bundleHash);
      const assertion = await getWebAuthnAssertionJson({
        challenge: challengeBytes,
        allowCredIds: [passkey.credId],
        preferInternal: true,
      });
      const ok = await verifyWebAuthnAssertion({
        assertion,
        expectedChallenge: challengeBytes,
        pubKeyJwk: passkey.pubKeyJwk,
        expectedCredId: passkey.credId,
      });
      if (!ok) {
        setError("Receive signature invalid.");
        return null;
      }

      const nextSig: ReceiveSig = {
        v: "KRS-1",
        alg: "webauthn-es256",
        nonce,
        binds: { bundleHash },
        credId: passkey.credId,
        pubKeyJwk: passkey.pubKeyJwk as ReceiveSig["pubKeyJwk"],
        assertion,
      };

      window.localStorage.setItem(`received:${bundleHash}`, JSON.stringify(nextSig));
      setReceiveSig(nextSig);
      setReceiveStatus("already");
      return nextSig;
    } catch {
      setError("Receive claim canceled.");
      return null;
    } finally {
      setReceiveBusy(false);
    }
  }, [receiveBusy, receiveStatus, bundleHash, resolveReceiverPasskey]);

  const [me, setMe] = useState<Keypair | null>(null);
  useEffect(() => {
    (async () => {
      try {
        setMe(await loadOrCreateKeypair());
      } catch (err) {
        logError("loadOrCreateKeypair", err);
      }
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/zk/verification_key.json", { cache: "no-store" });
        if (!res.ok) return;
        const vkey: unknown = await res.json();
        if (!alive) return;
        setSigilZkVkey(vkey);
      } catch (err) {
        logError("fetch(/zk/verification_key.json)", err);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [canonical, setCanonical] = useState<string | null>(null);
  const [canonicalContext, setCanonicalContext] = useState<"parent" | "derivative" | null>(null);
  const receiveRemoteCache = useRef<Map<string, { found: boolean; checked: boolean }>>(new Map());

  const openVerifier = () => safeShowDialog(dlgRef.current);

  const closeVerifier = () => {
    // Reset interactive state so next sigil is clean
    setError(null);
    setUiState("idle");
    setTab("summary");
    setViewRaw(false);
    setPhiInput("");
    setUsdInput("");
    setPayload(null);

    // 🔑 CRITICAL: allow re-uploading the same file again
    if (svgInput.current) svgInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";

    dlgRef.current?.close();
    dlgRef.current?.setAttribute("data-open", "false");
  };

  const noteInitial = useMemo<NoteBanknoteInputs>(
    () =>
      buildNotePayload({
        meta,
        sigilSvgRaw,
        verifyUrl: sealUrl || (typeof window !== "undefined" ? window.location.href : ""),
        pulseNow,
      }),
    [meta, sigilSvgRaw, sealUrl, pulseNow]
  );

  const openNote = () =>
    switchModal(dlgRef.current, () => {
      const d = noteDlgRef.current;
      if (!d) return;
      const p = buildNotePayload({
        meta,
        sigilSvgRaw,
        verifyUrl: sealUrl || (typeof window !== "undefined" ? window.location.href : ""),
        pulseNow,
      });
      const bridge: VerifierBridge = { getNoteData: async () => p };
      setVerifierBridge(bridge);
      try {
        window.dispatchEvent(new CustomEvent<NoteBanknoteInputs>("kk:note-data", { detail: p }));
      } catch (err) {
        logError("dispatch(kk:note-data)", err);
      }
      safeShowDialog(d);
      setNoteOpen(true);
    });

  const closeNote = () => {
    const d = noteDlgRef.current;
    d?.close();
    d?.setAttribute("data-open", "false");
    setNoteOpen(false);
  };

  const openValuation = () => switchModal(dlgRef.current, () => setValuationOpen(true));
  const closeValuation = () => setValuationOpen(false);

  const onAttachValuation = async (seal: ValueSeal) => {
    if (!meta) return;
    const updated = attachValuation(meta, seal) as SigilMetadata;
    setMeta(updated);
    setRawMeta(JSON.stringify(updated, null, 2));
    if (svgURL) {
      const durl = await embedMetadata(svgURL, updated);
      download(durl, `${pulseFilename("sigil_with_valuation", updated.pulse ?? 0, pulseNow)}.svg`);
    }
    setValuationOpen(false);
  };

  const refreshHeadWindow = useCallback(async (m: SigilMetadata) => {
    const transfers = m.transfers ?? [];
    const root = await (await import("./sigilUtils")).computeHeadWindowRoot(transfers);
    (m as SigilMetadataWithOptionals).transfersWindowRoot = root;

    if (transfers.length > 0) {
      const leaves = await Promise.all(transfers.map(hashTransfer));
      const index = leaves.length - 1;
      const proof = await merkleProof(leaves, index);
      const okDirect = await verifyProof(root, proof);
      const okBundle = await verifyHistorical(m, { kind: "head", windowMerkleRoot: root, transferProof: proof });
      setHeadProof({ ok: okDirect && okBundle, index, root });
    } else setHeadProof(null);

    try {
      const v14Leaves = await Promise.all(
        (m.hardenedTransfers ?? []).map(async (t) =>
          sha256Hex(
            stableStringify({
              previousHeadRoot: t.previousHeadRoot,
              senderPubKey: t.senderPubKey,
              senderSig: t.senderSig,
              senderKaiPulse: t.senderKaiPulse,
              nonce: t.nonce,
              transferLeafHashSend: t.transferLeafHashSend,
              receiverPubKey: t.receiverPubKey,
              receiverSig: t.receiverSig,
              receiverKaiPulse: t.receiverKaiPulse,
              transferLeafHashReceive: t.transferLeafHashReceive,
              zkSend: t.zkSend ?? null,
              zkReceive: t.zkReceive ?? null,
            })
          )
        )
      );
      (m as SigilMetadataWithOptionals).transfersWindowRootV14 = await buildMerkleRoot(v14Leaves);
    } catch (err) {
      logError("refreshHeadWindow.buildMerkleRoot(v14)", err);
    }

    try {
      await verifyZkOnHead(m);
      setMeta({ ...m });
    } catch (err) {
      logError("refreshHeadWindow.verifyZkOnHead", err);
    }

    return m;
  }, []);

  const isPersistedChild = useCallback(async (m: SigilMetadata) => {
    const parentCanonical =
      (m.canonicalHash as string | undefined)?.toLowerCase() ||
      (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();
    const explicitChildOf = (m as SigilMetadataWithOptionals).childOfHash?.toLowerCase();
    if (explicitChildOf && (m.canonicalHash?.toLowerCase() ?? "") !== parentCanonical) return true;
    return (m.canonicalHash?.toLowerCase() ?? "") !== parentCanonical;
  }, []);

  const computeEffectiveCanonical = useCallback(
    async (m: SigilMetadata): Promise<{ canonical: string; context: "parent" | "derivative" }> => {
      const parentCanonical =
        (m.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();

      if (await isPersistedChild(m)) {
        const childCanon = (m.canonicalHash as string).toLowerCase();
        const used = !!(m as SigilMetadataWithOptionals).sendLock?.used;
        const lastClosed = !!(m.transfers ?? []).slice(-1)[0]?.receiverSignature;
        return { canonical: childCanon, context: used || lastClosed ? "parent" : "derivative" };
      }

      const last = (m.transfers ?? []).slice(-1)[0];
      const hardenedLast = (m.hardenedTransfers ?? []).slice(-1)[0];
      const isChildOpen = !!last && !last.receiverSignature;
      if (!isChildOpen) return { canonical: parentCanonical, context: "parent" };

      const sendLeaf = last ? await hashTransferSenderSide(last) : "";
      const prevHead =
        hardenedLast?.previousHeadRoot ||
        (m as SigilMetadataWithOptionals).transfersWindowRootV14 ||
        (m as SigilMetadataWithOptionals).transfersWindowRoot ||
        "";
      const seed = stableStringify({
        parent: parentCanonical,
        nonce: m.transferNonce || "",
        senderStamp: last?.senderStamp || "",
        senderKaiPulse: last?.senderKaiPulse || 0,
        prevHead,
        leafSend: sendLeaf,
      });
      const childCanonical = (await sha256Hex(seed)).toLowerCase();
      return { canonical: childCanonical, context: "derivative" };
    },
    [isPersistedChild]
  );

  const buildReceiveLockKeys = useCallback(
    async (m: SigilMetadata): Promise<{ keys: string[]; canonical: string | null; nonce: string | null }> => {
      const keys = new Set<string>();
      if (bundleHash) keys.add(`${RECEIVE_LOCK_PREFIX}:bundle:${bundleHash}`);

      const last = m.transfers?.slice(-1)[0];
      if (last) {
        const sendLeaf = await hashTransferSenderSide(last);
        if (sendLeaf) keys.add(`${RECEIVE_LOCK_PREFIX}:leaf:${sendLeaf}`);
      }

      const nonce =
        (m as SigilMetadataWithOptionals).transferNonce ??
        (m as SigilMetadataWithOptionals).sendLock?.nonce ??
        null;
      if (nonce) keys.add(`${RECEIVE_LOCK_PREFIX}:nonce:${nonce}`);

      let effCanonical = canonical;
      if (!effCanonical) {
        try {
          const eff = await computeEffectiveCanonical(m);
          effCanonical = eff.canonical;
        } catch (err) {
          logError("receive.lock.computeCanonical", err);
        }
      }
      if (effCanonical) keys.add(`${RECEIVE_LOCK_PREFIX}:canonical:${effCanonical}`);

      return { keys: Array.from(keys), canonical: effCanonical ?? null, nonce };
    },
    [bundleHash, canonical, computeEffectiveCanonical]
  );

  const hasLocalReceiveLock = useCallback(
    async (m: SigilMetadata): Promise<boolean> => {
      const { keys } = await buildReceiveLockKeys(m);
      return keys.some((key) => window.localStorage.getItem(key));
    },
    [buildReceiveLockKeys]
  );

  const hasRegistryReceiveLock = useCallback(
    async (m: SigilMetadata): Promise<boolean> => {
      const { canonical, nonce } = await buildReceiveLockKeys(m);
      if (!canonical && !nonce) return false;

      for (const payload of memoryRegistry.values()) {
        if (!isReceiveLockPayload(payload)) continue;
        const payloadCanonical = readPayloadCanonical(payload);
        const payloadNonce = readPayloadNonce(payload);
        if (nonce && payloadNonce && payloadNonce === nonce) return true;
        if (canonical && payloadCanonical && payloadCanonical === canonical) return true;
      }

      return false;
    },
    [buildReceiveLockKeys]
  );

  const checkRemoteReceiveLock = useCallback(
    async (m: SigilMetadata): Promise<{ found: boolean; checked: boolean }> => {
      if (!isOnline()) return { found: false, checked: false };
      const { canonical, nonce } = await buildReceiveLockKeys(m);
      if (!canonical && !nonce) return { found: false, checked: false };

      const cacheKey = `${canonical ?? ""}|${nonce ?? ""}`;
      const cached = receiveRemoteCache.current.get(cacheKey);
      if (cached !== undefined) return cached;

      let found = false;
      let checked = false;
      let hadSuccess = false;
      let failed = false;
      for (let page = 0; page < RECEIVE_REMOTE_PAGES; page += 1) {
        const offset = page * RECEIVE_REMOTE_LIMIT;
        const res = await apiFetchWithFailover(
          (base) => {
            const url = new URL(API_URLS_PATH, base);
            url.searchParams.set("offset", String(offset));
            url.searchParams.set("limit", String(RECEIVE_REMOTE_LIMIT));
            return url.toString();
          },
          { method: "GET", cache: "no-store" }
        );

        if (!res) {
          failed = true;
          break;
        }

        if (!res.ok && res.status !== 304) {
          failed = true;
          break;
        }
        hadSuccess = true;

        let urls: unknown = [];
        if (res.status !== 304) {
          try {
            const responsePayload = (await res.json()) as Partial<ApiUrlsPageResponse> | null;
            urls = responsePayload?.urls ?? [];
          } catch {
            urls = [];
          }
        }

        if (!Array.isArray(urls) || urls.length === 0) break;

        for (const rawUrl of urls) {
          if (typeof rawUrl !== "string") continue;
          const payload = extractPayloadFromUrl(rawUrl);
          if (!payload) continue;
          if (!isReceiveLockPayload(payload)) continue;
          const payloadCanonical = readPayloadCanonical(payload);
          const payloadNonce = readPayloadNonce(payload);
          if (nonce && payloadNonce && payloadNonce === nonce) {
            found = true;
            break;
          }
          if (canonical && payloadCanonical && payloadCanonical === canonical) {
            found = true;
            break;
          }
        }

        if (found) break;
        if (urls.length < RECEIVE_REMOTE_LIMIT) break;
      }

      checked = hadSuccess && !failed;
      const result = { found, checked };
      if (checked) {
        receiveRemoteCache.current.set(cacheKey, result);
      }
      return result;
    },
    [buildReceiveLockKeys]
  );

  const hasRemoteReceiveLock = useCallback(
    async (m: SigilMetadata): Promise<boolean> => {
      const result = await checkRemoteReceiveLock(m);
      return result.found;
    },
    [checkRemoteReceiveLock]
  );

  const hasReceiveLock = useCallback(
    async (m: SigilMetadata): Promise<boolean> => {
      if (await hasLocalReceiveLock(m)) return true;
      if (await hasRegistryReceiveLock(m)) return true;
      return hasRemoteReceiveLock(m);
    },
    [hasLocalReceiveLock, hasRegistryReceiveLock, hasRemoteReceiveLock]
  );

  const writeReceiveLock = useCallback(
    async (m: SigilMetadata, nowPulse: number) => {
      const { keys } = await buildReceiveLockKeys(m);
      for (const key of keys) {
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, JSON.stringify({ pulse: nowPulse }));
        }
      }
    },
    [buildReceiveLockKeys]
  );

  const publishReceiveLock = useCallback(
    async (m: SigilMetadata, amountPhi?: string) => {
      let canonicalHash = (m.canonicalHash as string | undefined)?.toLowerCase() ?? null;
      const parentCanonical =
        (m as SigilMetadataWithOptionals).childOfHash?.toLowerCase() ||
        (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();

      if (!canonicalHash) {
        try {
          const eff = await computeEffectiveCanonical(m);
          canonicalHash = eff.canonical;
        } catch (err) {
          logError("receive.lock.canonicalFallback", err);
        }
      }

      if (!canonicalHash) return;

      const token = (m as SigilMetadataWithOptionals).transferNonce || genNonce();
      const chakraDay: ChakraDay = (m.chakraDay as ChakraDay) || "Root";
      const sharePayload = {
        pulse: m.pulse as number,
        beat: m.beat as number,
        stepIndex: m.stepIndex as number,
        chakraDay,
        kaiSignature: m.kaiSignature,
        userPhiKey: m.userPhiKey,
      };

      let parentUrl = "";
      try {
        const { makeSigilUrl } = await import("../../utils/sigilUrl");
        parentUrl = makeSigilUrl(parentCanonical, sharePayload);
        const parentToken = (m as SigilMetadataWithOptionals).transferNonce || "";
        if (parentToken) {
          parentUrl = rewriteUrlPayload(parentUrl, sharePayload, parentToken);
        }
      } catch (err) {
        logError("receive.lock.parentUrl", err);
        const u = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
        u.pathname = `/s/${parentCanonical}`;
        parentUrl = u.toString();
      }

      const originUrl = resolveOriginUrlFromRegistry(parentCanonical, parentUrl);

      const lastTransfer = m.transfers?.slice(-1)[0];
      const enriched = {
        ...sharePayload,
        parentUrl,
        originUrl,
        canonicalHash,
        parentHash: parentCanonical,
        transferNonce: token,
        ...(amountPhi
          ? {
              transferDirection: "receive",
              transferAmountPhi: amountPhi,
              phiDelta: amountPhi,
            }
          : { transferDirection: "receive" }),
        ...(lastTransfer?.receiverSignature
          ? {
              receiverSignature: lastTransfer.receiverSignature,
              receiverStamp: lastTransfer.receiverStamp,
              receiverKaiPulse: lastTransfer.receiverKaiPulse,
            }
          : {}),
      };

      let base = "";
      try {
        const { makeSigilUrl } = await import("../../utils/sigilUrl");
        base = makeSigilUrl(canonicalHash, sharePayload);
      } catch (err) {
        logError("receive.lock.makeSigilUrl", err);
        const u = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
        u.pathname = `/s/${canonicalHash}`;
        base = u.toString();
      }

      let historyParam: string | undefined;
      try {
        const { encodeSigilHistory } = await import("../../utils/sigilUrl");
        const lite: Array<{ s: string; p: number; r?: string }> = [];
        for (const t of m.transfers ?? []) {
          if (!t?.senderSignature || typeof t.senderKaiPulse !== "number") continue;
          lite.push(
            typeof t.receiverSignature === "string" && typeof t.receiverKaiPulse === "number"
              ? { s: t.senderSignature, p: t.senderKaiPulse, r: t.receiverSignature }
              : { s: t.senderSignature, p: t.senderKaiPulse }
          );
        }
        const enc = encodeSigilHistory(lite);
        historyParam = enc.startsWith("h:") ? enc.slice(2) : enc;
      } catch (err) {
        logError("receive.lock.encodeSigilHistory", err);
      }

      const url = rewriteUrlPayload(base, enriched, token, historyParam);
      registerUrlForExplorer(url);
      enqueueInhaleKrystal(url, enriched);
      void flushInhaleQueue();
    },
    [computeEffectiveCanonical]
  );

  const handleSvg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    let rawSvg = "";
    try {
      rawSvg = await f.text();
      setSigilSvgRaw(rawSvg);
    } catch (err) {
      logError("handleSvg.readFile", err);
      setSigilSvgRaw(null);
    }

    setSourceFilename(f.name || null);
    setError(null);
    setPayload(null);
    setTab("summary");
    setViewRaw(false);

    const url = URL.createObjectURL(f);
    setSvgURL(url);

    const { meta: m, contextOk, typeOk } = await parseSvgFile(f);

    m.segmentSize ??= SEGMENT_SIZE;
    const segCount = (m.segments ?? []).reduce((a, s) => a + (s.count || 0), 0);
    if (typeof m.cumulativeTransfers !== "number") m.cumulativeTransfers = segCount + (m.transfers?.length ?? 0);
    if ((m.segments?.length ?? 0) > 0 && !m.segmentsMerkleRoot)
      m.segmentsMerkleRoot = await buildMerkleRoot((m.segments ?? []).map((s) => s.root));

    const pulseForSeal = typeof m.pulse === "number" ? m.pulse : kaiPulseNow();
    const { sig, rgb } = await centrePixelSignature(url, pulseForSeal);
    setLiveSig(sig);
    setRgbSeed(rgb);

    const expected = await computeKaiSignature(m);
    setContentSigExpected(expected);
    const cMatch = expected && m.kaiSignature ? expected.toLowerCase() === m.kaiSignature.toLowerCase() : null;
    setContentSigMatches(cMatch);

    if (m.kaiSignature) {
      const expectedPhi = await derivePhiKeyFromSig(m.kaiSignature);
      setPhiKeyExpected(expectedPhi);
      setPhiKeyMatches(m.userPhiKey ? expectedPhi === m.userPhiKey : null);
    } else {
      setPhiKeyExpected(null);
      setPhiKeyMatches(null);
    }

    try {
      if ((m as SigilMetadataWithOptionals).creatorPublicKey) {
        const phi = await phiFromPublicKey((m as SigilMetadataWithOptionals).creatorPublicKey!);
        if (!m.userPhiKey) m.userPhiKey = phi;
      }
    } catch (err) {
      logError("handleSvg.phiFromPublicKey", err);
    }

    const hasCore =
      typeof m.pulse === "number" &&
      typeof m.beat === "number" &&
      typeof m.stepIndex === "number" &&
      typeof m.chakraDay === "string";

    const last = m.transfers?.slice(-1)[0];
    const receiveProof = Boolean(receiveSig);
    const sealedByProof = receiveProof && last && !last.receiverSignature;
    const lastParty = last?.receiverSignature || (!sealedByProof ? last?.senderSignature : null) || null;
    const isOwner = lastParty && sig ? lastParty === sig : null;
    const hasTransfers = !!(m.transfers && m.transfers.length > 0);
    const lastOpen = !!(last && !last.receiverSignature && !sealedByProof);
    const lastClosed = !!(last && (last.receiverSignature || sealedByProof));
    const isUnsigned = !m.kaiSignature;

    const m2 = await refreshHeadWindow(m);

    let effCtx: "parent" | "derivative" | null = null;
    try {
      const eff = await computeEffectiveCanonical(m2);
      setCanonical(eff.canonical);
      setCanonicalContext(eff.context);
      effCtx = eff.context;
    } catch (err) {
      logError("computeEffectiveCanonical", err);
      setCanonical(null);
      setCanonicalContext(null);
    }

    const { used: childUsed } = getChildLockInfo(m2, kaiPulseNow());

    let metaNext = m2;

    const nextUi: UiState = deriveState({
      contextOk,
      typeOk,
      hasCore,
      contentSigMatches: cMatch,
      isOwner,
      hasTransfers,
      lastOpen,
      lastClosed,
      isUnsigned,
      childUsed,
      childExpired: false,
      parentOpenExpired: false,
      isChildContext: effCtx === "derivative",
    });
    setUiState(nextUi);

    setAmountMode("PHI");
    setPhiInput("");
    setUsdInput("");

    openVerifier();

    if (rawSvg) {
      const proofMetaNext = extractProofBundleMetaFromSvg(rawSvg);
      setProofBundleMeta(proofMetaNext);
      const bundleHashNext = await computeBundleHashFromSvg(rawSvg, m2, proofMetaNext);
      setBundleHash(bundleHashNext);
      const receiveFromBundle = readReceiveSigFromBundle(proofMetaNext?.raw);
      if (receiveFromBundle) {
        metaNext = { ...metaNext, receiveSig: receiveFromBundle };
      }
      if (proofMetaNext?.raw && isRecord(proofMetaNext.raw)) {
        metaNext = { ...metaNext, proofBundleRaw: proofMetaNext.raw };
      }
      const poseidonHash = typeof metaNext.zkPoseidonHash === "string" ? metaNext.zkPoseidonHash : undefined;
      const payloadHashHex = typeof metaNext.payloadHashHex === "string" ? metaNext.payloadHashHex : undefined;
      if (poseidonHash && !metaNext.zkProof && payloadHashHex) {
        try {
          const computed = await computeZkPoseidonHash(payloadHashHex);
          if (computed.hash === poseidonHash) {
            const generated = await generateZkProofFromPoseidonHash({
              poseidonHash,
              secret: computed.secret,
              proofHints: isSigilProofHints(metaNext.proofHints) ? metaNext.proofHints : undefined,
            });
            if (generated) {
              metaNext = { ...metaNext, zkProof: generated.proof, zkPublicInputs: generated.zkPublicInputs, proofHints: generated.proofHints };
            }
          }
        } catch (err) {
          logError("zk.generateFromPoseidon", err);
        }
      }
    } else {
      setProofBundleMeta(null);
      setBundleHash(null);
    }

    setMeta(metaNext);
    setRawMeta(JSON.stringify(metaNext, null, 2));

    // 🔑 Important: clear the input so choosing the same file again fires onChange
    if (e.target) e.target.value = "";
  };

  useEffect(() => {
    if (!bundleHash) {
      setUnlockState({ isRequired: false, isUnlocked: false });
      setUnlockAvailable(false);
      autoUnlockRef.current = null;
      return;
    }

    const authorSig = proofBundleMeta?.authorSig;
    if (!authorSig || !isKASAuthorSig(authorSig)) {
      setUnlockState({ isRequired: false, isUnlocked: false });
      setUnlockAvailable(false);
      autoUnlockRef.current = null;
      return;
    }

    setUnlockState((prev) => (prev.isUnlocked && prev.credId === authorSig.credId ? prev : { isRequired: true, isUnlocked: false, credId: authorSig.credId }));
    setUnlockAvailable(!!findStoredKasPasskeyByCredId(authorSig.credId));
  }, [bundleHash, proofBundleMeta?.authorSig]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!bundleHash) {
        setReceiveSig(null);
        setReceiveStatus("idle");
        autoReceiveRef.current = null;
      }

      if (bundleHash) {
        const key = `received:${bundleHash}`;
        const stored = window.localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as unknown;
            if (!alive) return;
            setReceiveSig(isReceiveSig(parsed) ? parsed : null);
          } catch {
            if (!alive) return;
            setReceiveSig(null);
          }
          if (!alive) return;
          setReceiveStatus("already");
          return;
        }
      }

      const embedded = readReceiveSigFromBundle(proofBundleMeta?.raw);
      if (embedded) {
        if (!alive) return;
        setReceiveSig(embedded);
        setReceiveStatus("already");
        return;
      }

      if (meta && (await hasReceiveLock(meta))) {
        if (!alive) return;
        setReceiveSig(null);
        setReceiveStatus("already");
        return;
      }

      if (!alive) return;
      setReceiveSig(null);
      setReceiveStatus(bundleHash ? "new" : "idle");
    })();
    return () => {
      alive = false;
    };
  }, [bundleHash, proofBundleMeta?.raw, meta, hasReceiveLock]);

  useEffect(() => {
    if (!bundleHash || unlockState.isUnlocked || !unlockState.isRequired) return;
    autoUnlockRef.current = bundleHash;
  }, [bundleHash, unlockState.isUnlocked, unlockState.isRequired]);

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPayload(await fileToPayload(f));
  };

  const sealUnsigned = async () => {
    if (!meta || !svgURL) return;
    const m = { ...meta };
    const nowPulse = kaiPulseNow();
    if (!m.kaiSignature) {
      const sig = await computeKaiSignature(m);
      if (!sig) {
        setError("Cannot compute kaiSignature — missing core fields.");
        return;
      }
      m.kaiSignature = sig;
    }
    if (!m.userPhiKey && m.kaiSignature) m.userPhiKey = await derivePhiKeyFromSig(m.kaiSignature);
    if (typeof m.kaiPulse !== "number") m.kaiPulse = nowPulse;
    try {
      if (!(m as SigilMetadataWithOptionals).creatorPublicKey && me) (m as SigilMetadataWithOptionals).creatorPublicKey = me.spkiB64u;
    } catch (err) {
      logError("sealUnsigned.creatorPublicKey", err);
    }
    const durl = await embedMetadata(svgURL, m);
    download(durl, `${safeFilename("sigil_sealed", nowPulse)}.svg`);
    const m2 = await refreshHeadWindow(m);
    setMeta(m2);
    setRawMeta(JSON.stringify(m2, null, 2));
    setUiState((p) => (p === "unsigned" ? "readySend" : p));
    setError(null);
  };

  async function buildChildMetaForDownload(
    updated: SigilMetadata,
    args: { parentCanonical: string; childCanonical: string; allocationPhiStr: string; issuedPulse: number }
  ) {
    const m = JSON.parse(JSON.stringify(updated)) as SigilMetadataWithOptionals;
    m.canonicalHash = args.childCanonical;
    m.childOfHash = args.parentCanonical;
    m.childAllocationPhi = args.allocationPhiStr; // exact 6dp string
    m.childIssuedPulse = args.issuedPulse;
    m.childClaim = { steps: CLAIM_STEPS, expireAtPulse: args.issuedPulse + CLAIM_PULSES };
    m.sendLock = { nonce: updated.transferNonce!, used: false };
    m.branchBasePhi = args.allocationPhiStr; // keep parity for branch head
    m.branchSpentPhi = "0";
    return m;
  }

  const shareTransferLink = useCallback(async (m: SigilMetadata, transferAmountPhi?: string) => {
    let parentCanonical = (m.canonicalHash as string | undefined)?.toLowerCase() ?? "";
    if (!parentCanonical) {
      try {
        const eff = await computeEffectiveCanonical(m);
        parentCanonical = eff.canonical;
      } catch (err) {
        logError("shareTransferLink.computeCanonical", err);
      }
    }
    if (!parentCanonical) {
      parentCanonical = (await sha256Hex(`${m.pulse}|${m.beat}|${m.stepIndex}|${m.chakraDay}`)).toLowerCase();
    }

    const last = (m.transfers ?? []).slice(-1)[0];
    const hardenedLast = (m.hardenedTransfers ?? []).slice(-1)[0];
    const sendLeaf = last ? await hashTransferSenderSide(last) : "";
    const childSeed = stableStringify({
      parent: parentCanonical,
      nonce: m.transferNonce || "",
      senderStamp: last?.senderStamp || "",
      senderKaiPulse: last?.senderKaiPulse || 0,
      prevHead:
        hardenedLast?.previousHeadRoot ||
        (m as SigilMetadataWithOptionals).transfersWindowRootV14 ||
        (m as SigilMetadataWithOptionals).transfersWindowRoot ||
        "",
      leafSend: sendLeaf,
    });
    const childHash = (await sha256Hex(childSeed)).toLowerCase();

    const token = m.transferNonce || genNonce();
    const chakraDay: ChakraDay = (m.chakraDay as ChakraDay) || "Root";
    const sharePayload = {
      pulse: m.pulse as number,
      beat: m.beat as number,
      stepIndex: m.stepIndex as number,
      chakraDay,
      kaiSignature: m.kaiSignature,
      userPhiKey: m.userPhiKey,
    };

    const startPulse = last?.senderKaiPulse ?? kaiPulseNow();
    const claim = {
      steps: CLAIM_STEPS,
      expireAtPulse: startPulse + CLAIM_PULSES,
      stepsPerBeat: (m as SigilMetadataWithOptionals).stepsPerBeat ?? 12,
    };

    let preview: { unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number } | undefined;
    try {
      if (last?.payload?.mime?.startsWith("application/vnd.kairos-exhale")) {
        const obj = JSON.parse(base64DecodeUtf8(last.payload.encoded)) as
          | { kind?: string; unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
          | null;
        if (obj?.kind === "exhale") preview = { unit: obj.unit, amountPhi: obj.amountPhi, amountUsd: obj.amountUsd, usdPerPhi: obj.usdPerPhi };
      }
    } catch (err) {
      logError("shareTransferLink.previewDecode", err);
    }

    let parentUrl = "";
    try {
      const { makeSigilUrl } = await import("../../utils/sigilUrl");
      parentUrl = makeSigilUrl(parentCanonical, sharePayload);
      const parentToken = m.transferNonce || "";
      if (parentToken) {
        parentUrl = rewriteUrlPayload(parentUrl, sharePayload, parentToken);
      }
    } catch (err) {
      logError("shareTransferLink.parentUrl", err);
      const u = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
      u.pathname = `/s/${parentCanonical}`;
      parentUrl = u.toString();
    }

    const originUrl = resolveOriginUrlFromRegistry(parentCanonical, parentUrl);

    const enriched = {
      ...sharePayload,
      parentUrl,
      originUrl,
      canonicalHash: childHash,
      parentHash: parentCanonical,
      transferNonce: token,
      claim,
      preview,
      transferDirection: "send",
      ...(transferAmountPhi
        ? {
            transferAmountPhi,
            phiDelta: `-${transferAmountPhi}`,
          }
        : {}),
    };

    let base = "";
    try {
      const { makeSigilUrl } = await import("../../utils/sigilUrl");
      base = makeSigilUrl(childHash, sharePayload);
    } catch (err) {
      logError("shareTransferLink.makeSigilUrl", err);
      const u = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
      u.pathname = `/s/${childHash}`;
      base = u.toString();
    }

    let historyParam: string | undefined;
    try {
      const { encodeSigilHistory } = await import("../../utils/sigilUrl");
      const lite: Array<{ s: string; p: number; r?: string }> = [];
      for (const t of m.transfers ?? []) {
        if (!t?.senderSignature || typeof t.senderKaiPulse !== "number") continue;
        lite.push(
          typeof t.receiverSignature === "string" && typeof t.receiverKaiPulse === "number"
            ? { s: t.senderSignature, p: t.senderKaiPulse, r: t.receiverSignature }
            : { s: t.senderSignature, p: t.senderKaiPulse }
        );
      }
      const enc = encodeSigilHistory(lite);
      historyParam = enc.startsWith("h:") ? enc.slice(2) : enc;
    } catch (err) {
      logError("shareTransferLink.encodeSigilHistory", err);
    }

    const url = rewriteUrlPayload(base, enriched, token, historyParam);
    setSealUrl(url);
    setSealHash(childHash);
    setRotateOut(true);
    if (parentUrl) registerUrlForExplorer(parentUrl);
    registerUrlForExplorer(url);
    switchModal(dlgRef.current, () => setSealOpen(true));
    try {
      publishRotation([parentCanonical], token);
    } catch (err) {
      logError("shareTransferLink.publishRotation", err);
    }
  }, []);

  const syncMetaAndUi = useCallback(
    async (mNew: SigilMetadata) => {
      setMeta(mNew);
      setRawMeta(JSON.stringify(mNew, null, 2));

      const hasCore =
        typeof mNew.pulse === "number" &&
        typeof mNew.beat === "number" &&
        typeof mNew.stepIndex === "number" &&
        typeof mNew.chakraDay === "string";

      const lastTx = mNew.transfers?.slice(-1)[0];
      const receiveProof = Boolean(receiveSig);
      const sealedByProof = receiveProof && lastTx && !lastTx.receiverSignature;
      const lastParty = lastTx?.receiverSignature || (!sealedByProof ? lastTx?.senderSignature : null) || null;
      const isOwner = lastParty && liveSig ? lastParty === liveSig : null;
      const hasTransfers = !!(mNew.transfers && mNew.transfers.length > 0);
      const lastOpen = !!(lastTx && !lastTx.receiverSignature && !sealedByProof);
      const lastClosed = !!(lastTx && (lastTx.receiverSignature || sealedByProof));
      const isUnsigned = !mNew.kaiSignature;

      let effCtx: "parent" | "derivative" | null = null;
      try {
        const eff = await computeEffectiveCanonical(mNew);
        setCanonical(eff.canonical);
        setCanonicalContext(eff.context);
        effCtx = eff.context;
      } catch (err) {
        logError("syncMetaAndUi.computeEffectiveCanonical", err);
        setCanonical(null);
        setCanonicalContext(null);
      }

      const { used: childUsed } = getChildLockInfo(mNew, kaiPulseNow());
      const cMatch =
        contentSigExpected && mNew.kaiSignature ? contentSigExpected.toLowerCase() === mNew.kaiSignature.toLowerCase() : null;

      const next: UiState = deriveState({
        contextOk: true,
        typeOk: true,
        hasCore,
        contentSigMatches: cMatch,
        isOwner,
        hasTransfers,
        lastOpen,
        lastClosed,
        isUnsigned,
        childUsed,
        childExpired: false,
        parentOpenExpired: false,
        isChildContext: effCtx === "derivative",
      });
      setUiState(next);
    },
    [liveSig, computeEffectiveCanonical, contentSigExpected, receiveSig]
  );

  useEffect(() => {
    if (meta) {
      void syncMetaAndUi(meta);
    }
  }, [receiveSig, meta, syncMetaAndUi]);

  const fmtPhiCompact = useCallback((s: string) => {
    let t = (s || "").trim();
    if (!t) return "0";
    if (t.startsWith(".")) t = "0" + t;
    t = t.replace(/\.?$/, (m) => (/\.\d/.test(t) ? m : ""));
    return t;
  }, []);

  const fmtUsdNoSym = useCallback(
    (v: number) =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true,
      }).format(Math.max(0, v || 0)),
    []
  );

  const canShare = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: (data?: unknown) => Promise<void> }).share === "function",
    []
  );

  useEffect(
    () => () => {
      if (svgURL?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(svgURL);
        } catch (err) {
          logError("revokeObjectURL", err);
        }
      }
    },
    [svgURL]
  );

  // ⬇️ add deps: canonicalContext, sourceFilename
  const metaLiteForNote = useMemo<SigilMetadataLiteExtended | null>(() => {
    if (!meta) return null;
    const mOpt = meta as SigilMetadataWithOptionals;
    const steps: number = typeof mOpt.stepsPerBeat === "number" ? mOpt.stepsPerBeat : 12;
    const twr = mOpt.transfersWindowRoot ?? mOpt.transfersWindowRootV14 ?? "";

    // ⬇️ include derivative hints + exact child value fields (strings or numbers both OK)
    const out: SigilMetadataLiteExtended = {
      pulse: meta.pulse as number,
      beat: meta.beat as number,
      stepIndex: meta.stepIndex as number,
      stepsPerBeat: steps,
      chakraDay: (meta.chakraDay as ChakraDay) || "Root",
      kaiSignature: meta.kaiSignature ?? "",
      userPhiKey: meta.userPhiKey ?? "",
      transfersWindowRoot: twr,

      // NEW: minimal hints so ValuationModal can detect & resolve child value
      canonicalContext: canonicalContext ?? undefined,
      childOfHash: mOpt.childOfHash ?? undefined,
      sendLock: mOpt.sendLock ?? undefined,
      childClaim: mOpt.childClaim ?? undefined,
      childAllocationPhi: mOpt.childAllocationPhi ?? undefined,
      branchBasePhi: mOpt.branchBasePhi ?? undefined,

      // if you carry these in meta, pass through for valuation consumers
      valuationSource: mOpt.valuationSource,
      stats: mOpt.stats,

      // filename helps the “sigil_send” heuristic
      fileName: sourceFilename ?? undefined,
    };

    return out;
  }, [meta, canonicalContext, sourceFilename]);

  // Chakra Gate (display without the word "gate")
  const chakraGate = useMemo<string | null>(() => {
    if (!meta) return null;
    const raw =
      getFirst(meta, ["chakraGate", "valuationSource.chakraGate"]) ||
      fromSvgDataset(meta as SigilMetadataWithOptionals, "data-chakra-gate") ||
      null;
    if (!raw) return null;

    const cleaned = raw.replace(/\bgate\b/gi, "").replace(/\s{2,}/g, " ").trim();
    return cleaned || raw;
  }, [meta]);

  type InitialGlyph = { hash: string; value: number; pulseCreated: number; meta: SigilMetadataLiteExtended };
  const [initialGlyph, setInitialGlyph] = useState<InitialGlyph | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!metaLiteForNote) {
        setInitialGlyph(null);
        return;
      }
      const canonicalHash =
        (meta?.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${metaLiteForNote.pulse}|${metaLiteForNote.beat}|${metaLiteForNote.stepIndex}|${metaLiteForNote.chakraDay}`)).toLowerCase();
      try {
        const headHash =
          (meta as SigilMetadataWithOptionals)?.transfersWindowRoot ||
          (meta as SigilMetadataWithOptionals)?.transfersWindowRootV14 ||
          "";
        const { seal } = await buildValueSeal(metaLiteForNote, pulseNow, sha256Hex, headHash);
        if (!cancelled)
          setInitialGlyph({
            hash: canonicalHash,
            value: seal.valuePhi ?? 0,
            pulseCreated: metaLiteForNote.pulse ?? pulseNow,
            meta: metaLiteForNote,
          });
      } catch (err) {
        logError("buildValueSeal", err);
        if (!cancelled)
          setInitialGlyph({
            hash: canonicalHash,
            value: 0,
            pulseCreated: metaLiteForNote.pulse ?? pulseNow,
            meta: metaLiteForNote,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metaLiteForNote, meta, pulseNow]);

  useEffect(() => {
    if (!noteOpen || sigilSvgRaw || !svgURL) return;
    (async () => {
      try {
        const txt = await fetch(svgURL).then((r) => r.text());
        setSigilSvgRaw(txt);
      } catch (err) {
        logError("ensureRawSvgForNote", err);
      }
    })();
  }, [noteOpen, sigilSvgRaw, svgURL]);

  const issuancePolicy = DEFAULT_ISSUANCE_POLICY;
  const { usdPerPhi } = useMemo(() => {
    try {
      const nowKai = pulseNow;
      const metaLiteSafe: SigilMetadataLiteExtended =
        metaLiteForNote ?? {
          pulse: 0,
          beat: 0,
          stepIndex: 0,
          stepsPerBeat: 12,
          chakraDay: "Root",
          kaiSignature: "",
          userPhiKey: "",
          transfersWindowRoot: "",
        };
      const q = quotePhiForUsd(
        { meta: metaLiteSafe, nowPulse: nowKai, usd: 100, currentStreakDays: 0, lifetimeUsdSoFar: 0 },
        issuancePolicy
      );
      return { usdPerPhi: q.usdPerPhi ?? 0 };
    } catch (err) {
      logError("quotePhiForUsd", err);
      return { usdPerPhi: 0 };
    }
  }, [metaLiteForNote, pulseNow, issuancePolicy]);

  const persistedBaseScaled = useMemo(
    () => toScaledBig(((meta as SigilMetadataWithOptionals | null)?.branchBasePhi ?? "")),
    [meta]
  );

  const pivotIndex = useMemo(() => {
    const trs = meta?.transfers ?? [];
    for (let i = trs.length - 1; i >= 0; i -= 1) if (trs[i]?.receiverSignature) return i;
    return trs.length > 0 ? trs.length - 1 : -1;
  }, [meta?.transfers]);

  const lastTransfer = useMemo(() => (meta?.transfers ?? []).slice(-1)[0], [meta?.transfers]);
  const isChildContext = useMemo(() => canonicalContext === "derivative", [canonicalContext]);

  const basePhiScaled = useMemo(() => {
    if (isChildContext) {
      const childAllocStr = (meta as SigilMetadataWithOptionals | null)?.childAllocationPhi;
      if (childAllocStr) {
        const ex = toScaledBig(childAllocStr);
        if (ex > 0n) return ex;
      }
      const exOpen = toScaledBig(fromScaledBig(exhalePhiFromTransferScaled(lastTransfer)));
      return exOpen > 0n ? exOpen : 0n;
    }
    if (persistedBaseScaled > 0n) return persistedBaseScaled;
    if (pivotIndex >= 0 && meta?.transfers) {
      const v = exhalePhiFromTransferScaled(meta.transfers[pivotIndex]);
      return v > 0n ? v : 0n;
    }
    return toScaledBig(String(initialGlyph?.value ?? 0) || "0");
  }, [isChildContext, meta, lastTransfer, persistedBaseScaled, pivotIndex, initialGlyph]);

  const ledgerSpentScaled = useMemo(() => {
    if (!canonical) return 0n;
    try {
      return getSpentScaledFor(canonical);
    } catch (err) {
      logError("ledgerSpentScaled", err);
      return 0n;
    }
  }, [canonical]);

  const totalSpentScaled = useMemo(() => (isChildContext ? 0n : ledgerSpentScaled), [isChildContext, ledgerSpentScaled]);

  const remainingPhiScaled = useMemo(
    () => (basePhiScaled > totalSpentScaled ? basePhiScaled - totalSpentScaled : 0n),
    [basePhiScaled, totalSpentScaled]
  );

  const remainingPhiDisplay4 = useMemo(
    () => fromScaledBigFixed(roundScaledToDecimals(remainingPhiScaled, 4), 4),
    [remainingPhiScaled]
  );

  // Snap headline Φ to 6dp for UI (math stays BigInt elsewhere)
  const headerPhi = useMemo(() => snap6(Number(fromScaledBig(remainingPhiScaled))), [remainingPhiScaled]);

  const usdPerPhiRateScaled = useMemo(() => toScaledBig((usdPerPhi || 0).toFixed(18)), [usdPerPhi]);
  const headerUsd = useMemo(
    () => Number(fromScaledBig(mulScaled(remainingPhiScaled, usdPerPhiRateScaled))) || 0,
    [remainingPhiScaled, usdPerPhiRateScaled]
  );

  /* ────────────────────────────────────────────────────────────────
     Breath-synced trend computation (BREATH_MS):
     - Φ chip trend is driven by headerPhi deltas
     - $ chip trend is driven by headerUsd deltas (rounded to cents)
     - flash triggers only on change, clears after 420ms
     CSS is responsible for ▲ green / ▼ red / none on flat.
  ───────────────────────────────────────────────────────────────── */
  const [phiTrend, setPhiTrend] = useState<"up" | "down" | "flat">("flat");
  const [usdTrend, setUsdTrend] = useState<"up" | "down" | "flat">("flat");
  const [phiFlash, setPhiFlash] = useState<boolean>(false);
  const [usdFlash, setUsdFlash] = useState<boolean>(false);

  const latestPhiRef = useRef<number>(headerPhi);
  const latestUsdRef = useRef<number>(headerUsd);
  const shownPhiRef = useRef<number>(headerPhi);
  const shownUsdRef = useRef<number>(Math.round(headerUsd * 100) / 100);

  const phiFlashTimeoutRef = useRef<number | null>(null);
  const usdFlashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    latestPhiRef.current = headerPhi;
  }, [headerPhi]);

  useEffect(() => {
    latestUsdRef.current = headerUsd;
  }, [headerUsd]);

  useEffect(() => {
    const eps = 1e-9;

    const tick = () => {
      // Φ
      const nextPhi = latestPhiRef.current;
      const prevPhi = shownPhiRef.current;
      const phiDelta = nextPhi - prevPhi;
      const nextPhiTrend: "up" | "down" | "flat" =
        phiDelta > eps ? "up" : phiDelta < -eps ? "down" : "flat";

      if (nextPhiTrend !== "flat" && Math.abs(phiDelta) > eps) {
        setPhiTrend(nextPhiTrend);
        setPhiFlash(true);
        if (phiFlashTimeoutRef.current) window.clearTimeout(phiFlashTimeoutRef.current);
        phiFlashTimeoutRef.current = window.setTimeout(() => setPhiFlash(false), 420);
      } else {
        setPhiTrend("flat");
      }
      shownPhiRef.current = nextPhi;

      // USD (round to cents so we don't flicker on microscopic float changes)
      const nextUsd = Math.round(latestUsdRef.current * 100) / 100;
      const prevUsd = shownUsdRef.current;
      const usdDelta = nextUsd - prevUsd;
      const nextUsdTrend: "up" | "down" | "flat" =
        usdDelta > eps ? "up" : usdDelta < -eps ? "down" : "flat";

      if (nextUsdTrend !== "flat" && Math.abs(usdDelta) > eps) {
        setUsdTrend(nextUsdTrend);
        setUsdFlash(true);
        if (usdFlashTimeoutRef.current) window.clearTimeout(usdFlashTimeoutRef.current);
        usdFlashTimeoutRef.current = window.setTimeout(() => setUsdFlash(false), 420);
      } else {
        setUsdTrend("flat");
      }
      shownUsdRef.current = nextUsd;
    };

    // Initialize refs so first tick doesn't "flash" from 0 → value
    shownPhiRef.current = latestPhiRef.current;
    shownUsdRef.current = Math.round(latestUsdRef.current * 100) / 100;

    const id = window.setInterval(tick, BREATH_MS);
    return () => {
      window.clearInterval(id);
      if (phiFlashTimeoutRef.current) window.clearTimeout(phiFlashTimeoutRef.current);
      if (usdFlashTimeoutRef.current) window.clearTimeout(usdFlashTimeoutRef.current);
    };
  }, []);

  /* ────────────────────────────────────────────────────────────────
     LiveChart popover (stays inside the verifier modal)
  ───────────────────────────────────────────────────────────────── */
  const [chartOpen, setChartOpen] = useState(false);
  const [chartFocus, setChartFocus] = useState<"phi" | "usd">("phi");
  // force a remount when opening/switching focus so ResponsiveContainer never measures at 0
  const [chartReflowKey, setChartReflowKey] = useState(0);
  const openChartPopover = useCallback((focus: "phi" | "usd") => {
    setChartFocus(focus);
    setChartOpen(true);
    setChartReflowKey((k) => k + 1);
  }, []);
  useEffect(() => {
    if (chartOpen) setChartReflowKey((k) => k + 1);
  }, [chartOpen, chartFocus]);

  const closeChartPopover = useCallback(() => {
    setChartOpen(false);
  }, []);

  useEffect(() => {
    if (!chartOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChartPopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartOpen, closeChartPopover]);

  /* ────────────────────────────────────────────────────────────────
     μΦ-exact conversion & send-input normalization
     - For PHI mode: normalize user input to exactly 6dp via toScaled6 → toStr6
     - For USD mode: compute Φ from USD, then round to 6dp string
     Every downstream use (canExhale, send, payload, ledger) consumes this 6dp string.
  ───────────────────────────────────────────────────────────────── */
  const conv = useMemo(() => {
    if (amountMode === "PHI") {
      const phiNormalized = fmtPhiCompact(phiInput);
      const phi6Scaled = toScaled6(phiNormalized); // 6dp BigInt
      const phi6String = toStr6(phi6Scaled); // "X.XXXXXX"
      const usdScaled = mulScaled(toScaledBig(phi6String), usdPerPhiRateScaled);
      const usdNumber = Number(fromScaledBig(usdScaled));
      return {
        displayLeftLabel: "Φ",
        displayRight: Number.isFinite(usdNumber) ? `$ ${fmtUsdNoSym(usdNumber)}` : "$ 0.00",
        phiStringToSend: phi6String, // exact 6dp string
        usdNumberAtSend: Number.isFinite(usdNumber) ? usdNumber : 0,
      };
    }

    // USD mode
    const usdScaled = toScaledBig(usdInput);
    const phiScaled = divScaled(usdScaled, usdPerPhiRateScaled);
    const phi6String = fromScaledBigFixed(roundScaledToDecimals(phiScaled, 6), 6); // exact 6dp
    return {
      displayLeftLabel: "$",
      displayRight: `≈ Φ ${fromScaledBigFixed(roundScaledToDecimals(phiScaled, 4), 4)}`, // friendly preview (4dp)
      phiStringToSend: phi6String, // exact 6dp string
      usdNumberAtSend: Number(fromScaledBig(usdScaled)) || 0,
    };
  }, [amountMode, phiInput, usdInput, usdPerPhiRateScaled, fmtUsdNoSym, fmtPhiCompact]);

  const canExhale = useMemo(
    () => toScaledBig(conv.phiStringToSend || "0") > 0n && toScaledBig(conv.phiStringToSend || "0") <= remainingPhiScaled,
    [conv.phiStringToSend, remainingPhiScaled]
  );

  const downloadZip = useCallback(async () => {
    if (!meta || !svgURL) return;
    const svgDataUrl = await embedMetadata(svgURL, meta);
    const svgBlob = await fetch(svgDataUrl).then((r) => r.blob());
    let pngBlob: Blob | null = null;
    try {
      pngBlob = await pngBlobFromSvgDataUrl(svgDataUrl, 1024);
    } catch (err) {
      logError("pngBlobFromSvgDataUrl", err);
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const sigilPulse = meta.pulse ?? 0;
    const last = meta.transfers?.slice(-1)[0];
    const sendPulse = last?.senderKaiPulse ?? meta.kaiPulse ?? kaiPulseNow();
    const base = pulseFilename("sigil_bundle", sigilPulse, sendPulse);
    zip.file(`${base}.svg`, svgBlob);
    if (pngBlob) zip.file(`${base}.png`, pngBlob);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    download(zipBlob, `${base}.zip`);
  }, [meta, svgURL]);

  const isSendFilename = useMemo(() => (sourceFilename || "").toLowerCase().includes("sigil_send"), [sourceFilename]);

  const send = async () => {
    if (!meta || !svgURL || !liveSig) return;

    if (meta.kaiSignature && contentSigExpected && meta.kaiSignature.toLowerCase() !== contentSigExpected.toLowerCase()) {
      setError("Content signature mismatch — cannot send.");
      setUiState("sigMismatch");
      return;
    }

    const m: SigilMetadata = { ...meta };
    if (!m.kaiSignature) {
      const sig = await computeKaiSignature(m);
      if (!sig) {
        setError("Cannot compute kaiSignature — missing core fields.");
        return;
      }
      m.kaiSignature = sig;
      if (!m.userPhiKey) m.userPhiKey = await derivePhiKeyFromSig(sig);
    }
    if (typeof m.kaiPulse !== "number") m.kaiPulse = kaiPulseNow();

    const nowPulse = kaiPulseNow();
    const stamp = await sha256Hex(`${liveSig}-${m.pulse ?? 0}-${nowPulse}`);

    // μΦ-normalized amount from conv (already 6dp string)
    const validPhi6 = (conv.phiStringToSend || "").trim(); // "X.XXXXXX"
    const reqScaled = toScaledBig(validPhi6);

    if (reqScaled <= 0n) {
      setError("Enter a Φ amount greater than zero.");
      return;
    }
    if (reqScaled > remainingPhiScaled) {
      setError(
        `Exhale exceeds resonance Φ — requested Φ ${fromScaledBigFixed(reqScaled, 4)} but only Φ ${remainingPhiDisplay4} remains on this glyph.`
      );
      return;
    }

    const cleanUsd = Number.isFinite(conv.usdNumberAtSend) ? Math.max(0, conv.usdNumberAtSend) : 0;

    // Prefer exhale payload (μΦ-exact)
    let chosenPayload: SigilPayload | undefined;
    {
      const body = {
        kind: "exhale" as const,
        unit: amountMode,
        amountPhi: validPhi6, // ← exact 6dp string
        amountUsd: cleanUsd.toFixed(2),
        usdPerPhi: usdPerPhi || 0,
        atPulse: nowPulse,
        kaiSignature: m.kaiSignature || "",
        userPhiKey: m.userPhiKey || "",
      };
      chosenPayload = {
        name: `exhale_${validPhi6.replace(/\./g, "_")}phi.json`,
        mime: "application/vnd.kairos-exhale+json",
        size: base64EncodeUtf8(JSON.stringify(body)).length,
        encoded: base64EncodeUtf8(JSON.stringify(body)),
      };
    }
    if (!chosenPayload && payload) chosenPayload = payload;

    const transfer: SigilTransfer = {
      senderSignature: liveSig,
      senderStamp: stamp,
      senderKaiPulse: nowPulse,
      payload: chosenPayload ?? undefined,
    };
    const transferNonce = genNonce();
    const updated: SigilMetadata = {
      ...m,
      ["@context"]: m["@context"] ?? SIGIL_CTX,
      type: m.type ?? SIGIL_TYPE,
      canonicalHash: m.canonicalHash || undefined,
      transferNonce,
      transfers: [...(m.transfers ?? []), transfer],
      segmentSize: m.segmentSize ?? SEGMENT_SIZE,
    };

    try {
      const prevSpent = toScaledBig((meta as SigilMetadataWithOptionals)?.branchSpentPhi ?? "0");
      const newSpentScaled = prevSpent + reqScaled; // μΦ-normalized increment
      (updated as SigilMetadataWithOptionals).branchBasePhi =
        (meta as SigilMetadataWithOptionals)?.branchBasePhi ?? fromScaledBig(basePhiScaled);
      (updated as SigilMetadataWithOptionals).branchSpentPhi = fromScaledBig(newSpentScaled);
    } catch (err) {
      logError("send.persistBranchProgress", err);
    }

    // Hardened + ZK + ledger (unchanged; amounts already μΦ normalized)
    let parentCanonical = "",
      childCanonical = "",
      transferLeafHashSend = "",
      prevHeadV14 = "";
    try {
      parentCanonical =
        (updated.canonicalHash as string | undefined)?.toLowerCase() ||
        (await sha256Hex(`${updated.pulse}|${updated.beat}|${updated.stepIndex}|${updated.chakraDay}`)).toLowerCase();

      if (me) {
        (updated as SigilMetadataWithOptionals).creatorPublicKey ??= me.spkiB64u;

        const indexV14 = updated.hardenedTransfers?.length ?? 0;
        prevHeadV14 = await expectedPrevHeadRootV14(updated, indexV14);
        transferLeafHashSend = await hashTransferSenderSide(transfer);
        const nonce = updated.transferNonce!;

        const mod = (await import("./sigilUtils")) as typeof import("./sigilUtils");
        const msg = mod.buildSendMessageV14(updated, {
          previousHeadRoot: prevHeadV14,
          senderKaiPulse: nowPulse,
          senderPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
          nonce,
          transferLeafHashSend,
        });
        const senderSig = await signB64u(me.priv, msg);

        const hardened: HardenedTransferV14 = {
          previousHeadRoot: prevHeadV14,
          senderPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
          senderSig,
          senderKaiPulse: nowPulse,
          nonce,
          transferLeafHashSend,
        };

        const sigilZk = getSigilZkBridge();
        if (sigilZk?.provideSendProof) {
          try {
            const proofObj = await sigilZk.provideSendProof({
              meta: updated,
              leafHash: transferLeafHashSend,
              previousHeadRoot: prevHeadV14,
              nonce,
            });
            if (proofObj) {
              const bundle: ZkBundle = {
                scheme: "groth16",
                curve: "BLS12-381",
                proof: proofObj.proof,
                publicSignals: proofObj.publicSignals,
                vkey: proofObj.vkey,
              };
              (hardened as SigilMetadataWithOptionals).zkSendBundle = bundle;
              const publicHash = await mod.hashAny(proofObj.publicSignals);
              const proofHash = await mod.hashAny(proofObj.proof);
              const vkey = proofObj.vkey ?? (updated as SigilMetadataWithOptionals).zkVerifyingKey ?? getSigilZkVkey();
              const vkeyHash = vkey ? await mod.hashAny(vkey) : undefined;
              const ref: ZkRef = { scheme: "groth16", curve: "BLS12-381", publicHash, proofHash, vkeyHash };
              (hardened as SigilMetadataWithOptionals).zkSend = ref;
            }
          } catch (err) {
            logError("provideSendProof", err);
          }
        }

        updated.hardenedTransfers = [...(updated.hardenedTransfers ?? []), hardened];
      }

      const childSeed = stableStringify({
        parent: parentCanonical,
        nonce: updated.transferNonce || "",
        senderStamp: transfer.senderStamp || "",
        senderKaiPulse: transfer.senderKaiPulse || 0,
        prevHead:
          prevHeadV14 ||
          (updated as SigilMetadataWithOptionals).transfersWindowRootV14 ||
          (updated as SigilMetadataWithOptionals).transfersWindowRoot ||
          "",
        leafSend: transferLeafHashSend,
      });
      childCanonical = (await sha256Hex(childSeed)).toLowerCase();

      const rec = {
        parentCanonical,
        childCanonical,
        amountPhiScaled: toScaledBig(validPhi6).toString(), // μΦ-exact
        senderKaiPulse: nowPulse,
        transferNonce: updated.transferNonce!,
        senderStamp: stamp,
        previousHeadRoot: prevHeadV14,
        transferLeafHashSend,
      };
      try {
        await recordSend(rec);
      } catch (err) {
        logError("recordSend", err);
      }
      recordSigilTransferMovement({
        hash: childCanonical,
        direction: "send",
        amountPhi: validPhi6,
        amountUsd: cleanUsd.toFixed(2),
        sentPulse: nowPulse,
      });
      try {
        getSigilGlobal().registerSend?.(rec);
      } catch (err) {
        logError("__SIGIL__.registerSend", err);
      }
      try {
        window.dispatchEvent(new CustomEvent("sigil:sent", { detail: rec }));
      } catch (err) {
        logError("dispatchEvent(sigil:sent)", err);
      }
    } catch (err) {
      logError("send.hardenedBuild/ledger", err);
    }

    // Child metadata with μΦ allocation
    const childMeta = await buildChildMetaForDownload(updated, {
      parentCanonical,
      childCanonical,
      allocationPhiStr: validPhi6,
      issuedPulse: nowPulse,
    });
    const baseSvgText = await fetch(svgURL).then((r) => r.text());
    const childSvgText = embedMetadataText(baseSvgText, childMeta);
    let childSvgWithProof = childSvgText;

    try {
      const rawBundle = proofBundleMeta?.raw;
      if (rawBundle && isRecord(rawBundle)) {
        const priorReceiveSig = readReceiveSigFromBundle(rawBundle);
        const receiveSigHistory = collectReceiveSigHistory(rawBundle, priorReceiveSig);
        const proofCapsule = proofBundleMeta?.proofCapsule;
        const capsuleHash = proofBundleMeta?.capsuleHash ?? (proofCapsule ? await hashProofCapsuleV1(proofCapsule) : null);
        const svgHash = await hashSvgText(childSvgText);

        const nextBundle: Record<string, unknown> = {
          ...(rawBundle as Record<string, unknown>),
          svgHash,
          capsuleHash,
          proofCapsule: proofCapsule ?? undefined,
        };
        if (receiveSigHistory.length > 0) {
          nextBundle.receiveSigHistory = receiveSigHistory;
        }
        delete nextBundle.receiveSig;
        delete nextBundle.bundleHash;

        const bundleUnsigned = buildBundleUnsigned(nextBundle);
        const bundleHashNext = await hashBundle(bundleUnsigned);
        nextBundle.bundleHash = bundleHashNext;
        childSvgWithProof = embedProofMetadata(childSvgText, nextBundle);
      }
    } catch (err) {
      logError("send.embedProofBundle", err);
    }

    const childDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(childSvgWithProof)))}`;
    const sigilPulse = updated.pulse ?? 0;
    download(childDataUrl, `${pulseFilename("sigil_send", sigilPulse, nowPulse)}.svg`);
    const phiAmountNumber = Number(validPhi6);
    dispatchPhiMoveSuccess({
      mode: "send",
      amountPhiDisplay: `Φ ${fmtPhiFixed4(validPhi6)}`,
      amountDisplay: `Φ ${fmtPhiFixed4(validPhi6)}`,
      amountPhi: Number.isFinite(phiAmountNumber) ? phiAmountNumber : undefined,
      downloadUrl: childDataUrl,
      downloadLabel: "Sigil Send",
      message: "Transfer sealed.",
    });

    // Optional: seal segment after cap
    const windowSize = (updated.transfers ?? []).length;
    const cap = updated.segmentSize ?? SEGMENT_SIZE;
    if (windowSize >= cap) {
      const { meta: rolled, segmentFileBlob } = await sealCurrentWindowIntoSegment(updated);
      if (segmentFileBlob)
        download(
          segmentFileBlob,
          `sigil_segment_${rolled.pulse ?? 0}_${String((rolled.segments?.length ?? 1) - 1).padStart(6, "0")}.json`
        );
      const durl2 = await embedMetadata(svgURL, rolled);
      download(durl2, `${pulseFilename("sigil_head_after_seal", rolled.pulse ?? 0, nowPulse)}.svg`);
      const rolled2 = await refreshHeadWindow(rolled);
      await syncMetaAndUi(rolled2);
      setError(null);
      setPhiInput("");
      setUsdInput("");
      await shareTransferLink(rolled2, validPhi6);
      return;
    }

    const updated2 = await refreshHeadWindow(updated);
    await syncMetaAndUi(updated2);
    setError(null);
    setPhiInput("");
    setUsdInput("");
    await shareTransferLink(updated2, validPhi6);
  };

  const receive = async () => {
    if (!meta || !svgURL || !liveSig) return;

    if (!isOnline()) {
      setError("Online connection required to verify global receive lock.");
      return;
    }

    const remoteCheck = await checkRemoteReceiveLock(meta);
    if (!remoteCheck.checked) {
      setError("Unable to verify the global receive lock. Please try again.");
      return;
    }

    if (remoteCheck.found) {
      setError("This transfer has already been received.");
      setReceiveStatus("already");
      return;
    }

    if ((await hasLocalReceiveLock(meta)) || (await hasRegistryReceiveLock(meta))) {
      setError("This transfer has already been received.");
      setReceiveStatus("already");
      return;
    }

    let receiveSigLocal = receiveSig ?? null;
    if (receiveStatus === "new" && !receiveSigLocal) {
      receiveSigLocal = await claimReceiveSig();
      if (!receiveSigLocal) return;
    }

    const { used } = getChildLockInfo(meta, kaiPulseNow());
    if (used) {
      setError("This transfer link has already been used.");
      return;
    }

    const last = meta.transfers?.slice(-1)[0];
    if (!last || last.receiverSignature) return;

    const nowPulse = kaiPulseNow();
    const updatedLast: SigilTransfer = {
      ...last,
      receiverSignature: liveSig,
      receiverStamp: await sha256Hex(`${liveSig}-${last.senderStamp}-${nowPulse}`),
      receiverKaiPulse: nowPulse,
    };
    const updated: SigilMetadataWithOptionals = {
      ...(meta as SigilMetadataWithOptionals),
      transfers: [...(meta.transfers ?? []).slice(0, -1), updatedLast],
    };

    try {
      if (me && (updated.hardenedTransfers?.length ?? 0) > 0) {
        const hLast = updated.hardenedTransfers![updated.hardenedTransfers!.length - 1];
        if (!hLast.receiverSig) {
          (updated as SigilMetadataWithOptionals).creatorPublicKey ??= me.spkiB64u;
          const transferLeafHashReceive = await hashTransfer(updatedLast);
          const mod = (await import("./sigilUtils")) as typeof import("./sigilUtils");
          const msgR = mod.buildReceiveMessageV14({
            previousHeadRoot: hLast.previousHeadRoot,
            senderSig: hLast.senderSig,
            receiverKaiPulse: nowPulse,
            receiverPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
            transferLeafHashReceive,
          });
          const receiverSig = await signB64u(me.priv, msgR);
          const newHLast: HardenedTransferV14 = {
            ...hLast,
            receiverPubKey: (updated as SigilMetadataWithOptionals).creatorPublicKey!,
            receiverSig,
            receiverKaiPulse: nowPulse,
            transferLeafHashReceive,
          };

          const sigilZk = getSigilZkBridge();
          if (sigilZk?.provideReceiveProof) {
            try {
              const proofObj = await sigilZk.provideReceiveProof({
                meta: updated,
                leafHash: transferLeafHashReceive,
                previousHeadRoot: hLast.previousHeadRoot,
                linkSig: hLast.senderSig,
              });
              if (proofObj) {
                const bundle: ZkBundle = {
                  scheme: "groth16",
                  curve: "BLS12-381",
                  proof: proofObj.proof,
                  publicSignals: proofObj.publicSignals,
                  vkey: proofObj.vkey,
                };
                (newHLast as SigilMetadataWithOptionals).zkReceiveBundle = bundle;
                const publicHash = await mod.hashAny(proofObj.publicSignals);
                const proofHash = await mod.hashAny(proofObj.proof);
                const vkey = proofObj.vkey ?? (updated as SigilMetadataWithOptionals).zkVerifyingKey ?? getSigilZkVkey();
                const vkeyHash = vkey ? await mod.hashAny(vkey) : undefined;
                const ref: ZkRef = { scheme: "groth16", curve: "BLS12-381", publicHash, proofHash, vkeyHash };
                (newHLast as SigilMetadataWithOptionals).zkReceive = ref;
              }
            } catch (err) {
              logError("provideReceiveProof", err);
            }
          }

          updated.hardenedTransfers = [...updated.hardenedTransfers!.slice(0, -1), newHLast];

          try {
            const parentCanon =
              (updated.childOfHash as string | undefined)?.toLowerCase() ||
              (await sha256Hex(`${updated.pulse}|${updated.beat}|${updated.stepIndex}|${updated.chakraDay}`)).toLowerCase();
            if (hLast.transferLeafHashSend) markConfirmedByLeaf(parentCanon, hLast.transferLeafHashSend);
          } catch (err) {
            logError("ledger.markConfirmedByLeaf", err);
          }
        }
      }
    } catch (err) {
      logError("receive.hardenedSeal", err);
    }

    try {
      if (await isPersistedChild(updated))
        updated.sendLock = { ...(updated.sendLock ?? { nonce: updated.transferNonce! }), used: true, usedPulse: nowPulse };
    } catch (err) {
      logError("receive.setUsedLock", err);
    }

    try {
      await writeReceiveLock(updated, nowPulse);
    } catch (err) {
      logError("receive.setReceiveLock", err);
    }

    try {
      const amountPhi = readPhiAmountFromMeta(updated as SigilMetadataWithOptionals);
      await publishReceiveLock(updated, amountPhi);
    } catch (err) {
      logError("receive.publishReceiveLock", err);
    }

    try {
      const eff = await computeEffectiveCanonical(updated);
      const amountPhi = readPhiAmountFromMeta(updated as SigilMetadataWithOptionals);
      if (eff?.canonical && amountPhi) {
        const lastTransfer = updated.transfers?.[updated.transfers.length - 1];
        const exhaleInfo = readExhaleInfoFromTransfer(lastTransfer);
        recordSigilTransferMovement({
          hash: eff.canonical,
          direction: "receive",
          amountPhi,
          amountUsd: exhaleInfo.amountUsd,
          sentPulse: exhaleInfo.sentPulse,
        });
      }
    } catch (err) {
      logError("receive.recordTransferMovement", err);
    }

    let durl = await embedMetadata(svgURL, updated);
    const baseSvg = await fetch(durl).then((r) => r.text());
    const svgHash = await hashSvgText(baseSvg);
    const proofCapsule = proofBundleMeta?.proofCapsule;
    const capsuleHash = proofBundleMeta?.capsuleHash ?? (proofCapsule ? await hashProofCapsuleV1(proofCapsule) : null);

    let nextBundle: Record<string, unknown>;
    if (proofBundleMeta?.raw && isRecord(proofBundleMeta.raw)) {
      nextBundle = {
        ...(proofBundleMeta.raw as Record<string, unknown>),
        svgHash,
        capsuleHash,
        proofCapsule: proofCapsule ?? undefined,
        ...(receiveSigLocal ? { receiveSig: receiveSigLocal } : {}),
      };
    } else if (updated.kaiSignature && typeof updated.pulse === "number") {
      const chakraDay = normalizeChakraDay(updated.chakraDay ?? "") ?? "Crown";
      const verifierSlug = buildVerifierSlug(updated.pulse, updated.kaiSignature);
      const phiKey = updated.userPhiKey ?? (await derivePhiKeyFromSig(updated.kaiSignature));
      const fallbackCapsule = {
        v: "KPV-1" as const,
        pulse: updated.pulse,
        chakraDay,
        kaiSignature: updated.kaiSignature,
        phiKey,
        verifierSlug,
      };
      const capsuleHashNext = capsuleHash ?? (await hashProofCapsuleV1(fallbackCapsule));
      nextBundle = {
        hashAlg: proofBundleMeta?.hashAlg ?? PROOF_HASH_ALG,
        canon: proofBundleMeta?.canon ?? PROOF_CANON,
        proofCapsule: fallbackCapsule,
        capsuleHash: capsuleHashNext,
        svgHash,
        shareUrl: proofBundleMeta?.shareUrl,
        verifierUrl: proofBundleMeta?.verifierUrl,
        zkPoseidonHash: proofBundleMeta?.zkPoseidonHash,
        zkProof: proofBundleMeta?.zkProof,
        proofHints: proofBundleMeta?.proofHints,
        zkPublicInputs: proofBundleMeta?.zkPublicInputs,
        authorSig: proofBundleMeta?.authorSig ?? null,
        ...(receiveSigLocal ? { receiveSig: receiveSigLocal } : {}),
      };
    } else {
      nextBundle = { svgHash, capsuleHash, ...(receiveSigLocal ? { receiveSig: receiveSigLocal } : {}) };
    }

    const bundleUnsigned = buildBundleUnsigned(nextBundle);
    const bundleHashNext = await hashBundle(bundleUnsigned);
    nextBundle.bundleHash = bundleHashNext;

    const updatedSvg = embedProofMetadata(baseSvg, nextBundle);
    durl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(updatedSvg)))}`;
    const sigilPulse = updated.pulse ?? 0;
    download(durl, `${pulseFilename("sigil_receive", sigilPulse, nowPulse)}.svg`);
    const receivedPhi = readPhiAmountFromMeta(updated);
    const receivedPhiNumber = receivedPhi ? Number(receivedPhi) : NaN;
    dispatchPhiMoveSuccess({
      mode: "receive",
      amountPhiDisplay: receivedPhi ? `Φ ${fmtPhiFixed4(receivedPhi)}` : undefined,
      amountDisplay: receivedPhi ? `Φ ${fmtPhiFixed4(receivedPhi)}` : undefined,
      amountPhi: Number.isFinite(receivedPhiNumber) ? receivedPhiNumber : undefined,
      downloadUrl: durl,
      downloadLabel: "Sigil Receive",
      message: "Transfer received.",
    });
    const updated2 = await refreshHeadWindow(updated);
    await syncMetaAndUi(updated2);
    setError(null);
  };

  const sealSegmentNow = useCallback(async () => {
    if (!meta || !(meta.transfers?.length)) return;
    if (isSendFilename) {
      setError("Segmentation is disabled on SEND sigils.");
      return;
    }
    const { meta: rolled, segmentFileBlob } = await sealCurrentWindowIntoSegment(meta);
    if (segmentFileBlob)
      download(
        segmentFileBlob,
        `sigil_segment_${rolled.pulse ?? 0}_${String((rolled.segments?.length ?? 1) - 1).padStart(6, "0")}.json`
      );
    if (svgURL) {
      const durl = await embedMetadata(svgURL, rolled);
      download(durl, `${pulseFilename("sigil_head_after_seal", rolled.pulse ?? 0, kaiPulseNow())}.svg`);
    }
    const rolled2 = await refreshHeadWindow(rolled);
    await syncMetaAndUi(rolled2);
    setError(null);
  }, [meta, svgURL, isSendFilename, refreshHeadWindow, syncMetaAndUi]);

  const frequencyHz = useMemo(
    () =>
      getFirst(meta, ["frequencyHz", "valuationSource.frequencyHz"]) ||
      fromSvgDataset(meta as SigilMetadataWithOptionals, "data-frequency-hz"),
    [meta]
  );

  const zkPoseidonHash = useMemo(() => {
    const raw = getPath(meta, "zkPoseidonHash") ?? getPath(meta, "proofHints.poseidonHash");
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : null;
    }
    return null;
  }, [meta]);

  const zkPublicInputs = useMemo(() => {
    const raw = getPath(meta, "zkPublicInputs");
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "string") return raw;
    try {
      return stableStringify(raw);
    } catch (err) {
      logError("zkPublicInputs.stringify", err);
      return "[zkPublicInputs]";
    }
  }, [meta]);

  const zkProof = useMemo(() => {
    const raw = getPath(meta, "zkProof") ?? getPath(meta, "proofHints.proof");
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : null;
    }
    return raw;
  }, [meta]);

  const zkProofDisplay = useMemo(() => {
    if (!zkProof) return null;
    if (typeof zkProof === "string") return zkProof;
    try {
      return stableStringify(zkProof);
    } catch (err) {
      logError("zkProof.stringify", err);
      return "[zkProof]";
    }
  }, [zkProof]);

  const authorSigValue = useMemo(() => {
    const value = getPath(meta, "authorSig");
    if (value !== undefined && value !== null) return value;
    return getPath(meta, "authSig");
  }, [meta]);

  const authorSigDisplay = useMemo(() => {
    if (authorSigValue === undefined || authorSigValue === null) return null;
    if (typeof authorSigValue === "string") {
      const trimmed = authorSigValue.trim();
      return trimmed.length ? trimmed : null;
    }
    try {
      return stableStringify(authorSigValue);
    } catch (err) {
      logError("authorSig.stringify", err);
      return "[authorSig]";
    }
  }, [authorSigValue]);

  // Chakra: resolve from chakraDay or chakraGate (strips "gate" implicitly)
  const chakraDayDisplay = useMemo<ChakraDay | null>(() => resolveChakraDay(meta ?? {}), [meta]);

  const { used: childUsed } = useMemo(() => getChildLockInfo(meta, pulseNow), [meta, pulseNow]);

  const zkSummary = useMemo(() => {
    const hardened = meta?.hardenedTransfers ?? [];
    if (!hardened.length) return null;
    let send = 0;
    let receive = 0;
    let verifiedSend = 0;
    let verifiedReceive = 0;
    for (const t of hardened) {
      if (t?.zkSend || t?.zkSendBundle) {
        send += 1;
        if (t?.zkSend?.verified) verifiedSend += 1;
      }
      if (t?.zkReceive || t?.zkReceiveBundle) {
        receive += 1;
        if (t?.zkReceive?.verified) verifiedReceive += 1;
      }
    }
    if (!send && !receive) return null;
    const parts: string[] = [];
    if (send) parts.push(`send ${verifiedSend}/${send}`);
    if (receive) parts.push(`receive ${verifiedReceive}/${receive}`);
    return { send, receive, verifiedSend, verifiedReceive, label: parts.join(" • ") };
  }, [meta]);

  const seriesKey = useMemo(() => {
    // canonical is best; fallback to core tuple so it still resets correctly
    if (canonical) return canonical;
    if (!meta) return "none";
    return `${meta.pulse ?? "x"}|${meta.beat ?? "x"}|${meta.stepIndex ?? "x"}|${meta.chakraDay ?? "x"}`;
  }, [canonical, meta]);

  const chartData = useRollingChartSeries({
    seriesKey,
    sampleMs: BREATH_MS,
    valuePhi: headerPhi,
    usdPerPhi,
    maxPoints: 4096,
    snapKey: chartReflowKey, // 👈 ensures “exact price on open”
  });

  // sensible PV: use your initialGlyph seal if present, else current live Φ
  const pvForChart = useMemo(() => {
    const v = Number(initialGlyph?.value);
    return Number.isFinite(v) && v > 0 ? v : headerPhi;
  }, [initialGlyph, headerPhi]);

  return (
    <div
      className="verifier-stamper"
      role="application"
      style={{ maxWidth: "100vw", overflowX: "hidden" }}
    >
      {/* Top toolbar — Stream + ΦKey on the same row, with live Kai pulse */}
      <div className="toolbar">
        <div className="toolbar-main">
          <div className="brand-lockup" aria-label="Kairos live status">
            <div className="brand-text">
              <div className="live-pulse">
                <span className="now">LIVE</span>
                <span className="pulse-number"> ☤KAI {pulseNow}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-actions" aria-label="Verifier actions">
            <button
              className="primary"
              onClick={() => svgInput.current?.click()}
              type="button"
            >
              <InhaleUploadIcon color="#37FFE4" />

              <span className="phikey-label" aria-label="PhiKey">
                <img className="phikey-mark" src="/phi.svg" alt="Φ" />
                <span className="phikey-text">Key</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <input ref={svgInput} type="file" accept=".svg" hidden onChange={handleSvg} />

      {/* Verifier Modal */}
      <dialog
        ref={dlgRef}
        className="glass-modal fullscreen"
        id="verifier-dialog"
        data-open="false"
        aria-label="Kai-Sigil Verifier Modal"
        style={S.full}
      >
        <div className="modal-viewport" style={S.viewport}>
          <div className="modal-topbar" style={S.gridBar}>
            <div className="status-strip" aria-live="polite" style={S.valueStrip}>
              <StatusChips
                uiState={uiState}
                contentSigMatches={contentSigMatches}
                phiKeyMatches={phiKeyMatches}
                meta={meta}
                headProof={headProof}
                canonicalContext={canonicalContext}
                childUsed={childUsed}
                childExpired={false}
                parentOpenExpired={false}
                isSendFilename={isSendFilename}
              />
            </div>
            <button
              className="close-btn holo"
              data-aurora="true"
              aria-label="Close"
              title="Close"
              onClick={closeVerifier}
              style={{ justifySelf: "end", marginRight: 8 }}
            >
              ×
            </button>
          </div>

          {svgURL && meta && (
            <>
              {/* Header */}
              <header className="modal-header" style={{ paddingInline: 16 }}>
                <img src={svgURL} alt="Sigil thumbnail" width={64} height={64} style={S.headerImg} />
                <div className="header-fields" style={{ minWidth: 0 }}>
                  <h2 style={{ overflowWrap: "anywhere" }}>
                    Pulse <span>{meta.pulse ?? "—"}</span>
                  </h2>
                  <p>
                    Beat <span>{meta.beat ?? "—"}</span> · Step <span>{meta.stepIndex ?? "—"}</span> · Day:{" "}
                    <span>{(chakraDayDisplay as ChakraDay) ?? (meta.chakraDay as ChakraDay) ?? "—"}</span>
                  </p>

                  {/* Value strip MUST remain under Beat/Step/Day; CSS handles final spacing */}
                  <div className="value-strip" aria-live="polite">
                    <ValueChip
                      kind="phi"
                      trend={phiTrend}
                      flash={phiFlash}
                      title={canonicalContext === "derivative" ? "Resonance Φ for this derivative glyph" : "Resonance Φ on this glyph"}
                      ariaLabel="Open live chart for Φ value"
                      onClick={() => openChartPopover("phi")}
                    >
                      <span className="sym">Φ</span>
                      {headerPhi.toFixed(6)}
                    </ValueChip>

                    <ValueChip
                      kind="usd"
                      trend={usdTrend}
                      flash={usdFlash}
                      title="Indicative USD (issuance model)"
                      ariaLabel="Open live chart for USD value"
                      onClick={() => openChartPopover("usd")}
                    >
                      <span className="sym">$</span>
                      {fmtUsdNoSym(headerUsd)}
                    </ValueChip>
                  </div>

                </div>
              </header>

              {/* Live chart popover (overlays inside verifier modal, easy exit, no navigation) */}
              {chartOpen && (
                <div
                  className="chart-popover-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Live chart"
                  onMouseDown={closeChartPopover}
                  onClick={closeChartPopover}
                  style={S.popBg}
                >
                  <div
                    className="chart-popover"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={S.popCard}
                  >
                    <div className="chart-popover-head" style={S.popHead}>
                      <div style={S.popTitle} className="chart-popover-title">
                        {chartFocus === "phi" ? "Φ Resonance · Live" : "$ Price · Live"}
                      </div>
                      <button
                        className="close-btn holo"
                        data-aurora="true"
                        aria-label="Close chart"
                        title="Close"
                        onClick={closeChartPopover}
                        style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      >
                        ×
                      </button>
                    </div>

                    <div className="chart-popover-body" style={S.popBody}>
                      <React.Suspense fallback={<div style={{ padding: 16, color: "var(--dim)" }}>Loading chart…</div>}>
                        <LiveChart
                          data={chartData}
                          live={headerPhi}
                          pv={pvForChart}
                          premiumX={1}
                          momentX={1}
                          colors={["rgba(167,255,244,1)"]}
                          usdPerPhi={usdPerPhi}
                          mode={chartFocus === "usd" ? "usd" : "phi"}
                          isChildGlyph={canonicalContext === "derivative"}
                          reflowKey={chartReflowKey}
                        />
                      </React.Suspense>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <nav className="tabs" role="tablist" aria-label="Views" style={S.stickyTabs}>
                <button role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>
                  Presence
                </button>
                <button role="tab" aria-selected={tab === "lineage"} className={tab === "lineage" ? "active" : ""} onClick={() => setTab("lineage")}>
                  Stewardship
                </button>
                <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>
                  Memory
                </button>

                <button className="secondary" onClick={openValuation} disabled={!meta}>
                  Resonance
                </button>
                <button className="secondary" onClick={openNote} disabled={!svgURL}>
                  Note
                </button>
              </nav>

              {/* Body */}
              <section className="modal-body" role="tabpanel" style={S.modalBody}>
                {tab === "summary" && (
                  <div className="summary-grid">
                    {canonicalContext === "derivative" && (
                      <>
                        <KV
                          k="Receive claim:"
                          v={
                            receiveStatus === "already" ? (
                              "Received"
                            ) : receiveStatus === "new" ? (
                              <>
                                New receive{" "}
                                <button className="secondary" onClick={() => void receive()} disabled={receiveBusy}>
                                  {receiveBusy ? "Claiming…" : "Inhale & Download"}
                                </button>
                              </>
                            ) : (
                              "—"
                            )
                          }
                        />
                        {receiveSig && <KV k="Receive credId:" v={receiveSig.credId} wide mono />}
                      </>
                    )}
                    {unlockState.isRequired && !unlockState.isUnlocked && unlockAvailable && (
                      <KV
                        k="Unlock gate:"
                        v={
                          <>
                            Unlock required{" "}
                            <button className="secondary" onClick={() => void attemptUnlock("manual")} disabled={unlockBusy}>
                              {unlockBusy ? "Unlocking…" : "Unlock"}
                            </button>
                          </>
                        }
                      />
                    )}
                    <KV k="Now" v={pulseNow} />

                    {meta.userPhiKey && (
                      <KV
                        k="Φ-Key:"
                        v={
                          <>
                            {meta.userPhiKey}
                            {phiKeyExpected && (phiKeyMatches ? <span className="chip ok">match</span> : <span className="chip err">mismatch</span>)}
                          </>
                        }
                        wide
                        mono
                      />
                    )}

                    {meta.kaiSignature && (
                      <KV
                        k="Kai-Signature (Σ):"
                        v={
                          <>
                            {meta.kaiSignature}
                            {contentSigMatches === true && <span className="chip ok">match</span>}
                            {contentSigMatches === false && <span className="chip err">mismatch</span>}
                          </>
                        }
                        wide
                        mono
                      />
                    )}

                    {authorSigDisplay && <KV k="Author Sig:" v={authorSigDisplay} wide mono />}
                    {frequencyHz && <KV k="Frequency (Hz):" v={frequencyHz} />}
                    {chakraGate && <KV k="Spiral Gate:" v={chakraGate} />}
                    {liveSig && <KV k="PROOF OF BREATH™:" v={liveSig} wide mono />}
                    <KV k="Stewardship Hash:" v={canonical ?? "—"} wide mono />
                    <KV k={canonicalContext === "derivative" ? "Derivative Resonance" : "Resonance "} v={` Φ${remainingPhiDisplay4}`} />
                    <KV k="Exhale key:" v={(meta as SigilMetadataWithOptionals)?.creatorPublicKey ?? "—"} wide mono />
                    <KV k="Exhale nonce:" v={meta.transferNonce ?? "—"} wide mono />
                    <KV k="Issued @ (derivative):" v={(meta as SigilMetadataWithOptionals)?.childIssuedPulse ?? "—"} />
                    <KV k="Derivative of (source):" v={(meta as SigilMetadataWithOptionals)?.childOfHash ?? "—"} wide mono />
                    {headProof && <KV k="Latest proof:" v={headProof.ok ? `#${headProof.index + 1} ✓` : `#${headProof.index} ×`} />}
                    {headProof !== null && <KV k="Head proof root:" v={headProof.root} wide mono />}
                    <KV k="Head proof root (v14):" v={(meta as SigilMetadataWithOptionals)?.transfersWindowRootV14 ?? "—"} wide mono />
                    {zkSummary && <KV k="ZK proofs:" v={zkSummary.label} />}

                    {canonicalContext === "derivative" && (meta as SigilMetadataWithOptionals)?.sendLock?.used && <KV k="One-time lock:" v="Used" />}
                    <KV k="Hardened transfers:" v={meta.hardenedTransfers?.length ?? 0} />
                    <KV k="Segments:" v={meta.segments?.length ?? 0} />
                    <KV k="Segment size:" v={meta.segmentSize ?? SEGMENT_SIZE} />
                    <KV k="Segment Depth:" v={meta.cumulativeTransfers ?? 0} />
                    <KV k="Segment Tree Root:" v={meta.segmentsMerkleRoot ?? "—"} wide mono />
                    {zkPoseidonHash && <KV k="ZK Poseidon hash:" v={zkPoseidonHash} wide mono />}
                    {zkPublicInputs && <KV k="ZK public inputs:" v={zkPublicInputs} wide mono />}
                    {zkProofDisplay && <KV k="ZK proof:" v={zkProofDisplay} wide mono />}
                    {rgbSeed && <KV k="RGB seed:" v={rgbSeed.join(", ")} />}
                  </div>
                )}

                {tab === "lineage" && (
                  <div className="lineage">
                    {meta.transfers?.length ? (
                      <ol className="transfers">
                        {meta.transfers.map((t, i) => {
                          const open = !t.receiverSignature;
                          const hardened = meta.hardenedTransfers?.[i];
                          let exhaleInfo:
                            | { unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
                            | null = null;

                          try {
                            if (t.payload?.mime?.startsWith("application/vnd.kairos-exhale")) {
                              const obj = JSON.parse(base64DecodeUtf8(t.payload.encoded)) as
                                | { kind?: string; unit?: "USD" | "PHI"; amountPhi?: string; amountUsd?: string; usdPerPhi?: number }
                                | null;
                              if (obj?.kind === "exhale")
                                exhaleInfo = { unit: obj.unit, amountPhi: obj.amountPhi, amountUsd: obj.amountUsd, usdPerPhi: obj.usdPerPhi };
                            }
                          } catch (err) {
                            logError("lineage.decodeExhalePayload", err);
                          }

                          let lineagePhi = "",
                            lineageUsd = "";
                          try {
                            if (exhaleInfo?.amountPhi) {
                              lineagePhi = fmtPhiFixed4(exhaleInfo.amountPhi);
                              lineageUsd =
                                typeof exhaleInfo.amountUsd === "string" && exhaleInfo.amountUsd
                                  ? exhaleInfo.amountUsd
                                  : typeof exhaleInfo.usdPerPhi === "number" && Number.isFinite(exhaleInfo.usdPerPhi)
                                    ? fmtUsdNoSym((Number(exhaleInfo.amountPhi) || 0) * exhaleInfo.usdPerPhi)
                                    : "0.00";
                            }
                          } catch (err) {
                            logError("lineage.computeDisplay", err);
                          }

                          return (
                            <li key={i} className={open ? "transfer open" : "transfer closed"}>
                              <header>
                                <span className="index">#{i + 1}</span>
                                <span className={`state ${open ? "open" : "closed"}`}>{open ? "Pending receive" : "Sealed"}</span>
                              </header>

                              <div className="row">
                                <span className="k">Exhaler Σ</span>
                                <span className="v mono" style={S.mono}>
                                  {t.senderSignature}
                                </span>
                              </div>

                              <div className="row">
                                <span className="k">Exhaler Seal:</span>
                                <span className="v mono" style={S.mono}>
                                  {t.senderStamp}
                                </span>
                              </div>

                              <div className="row">
                                <span className="k">Exhaler Pulse</span>
                                <span className="v">{t.senderKaiPulse}</span>
                              </div>

                              {exhaleInfo?.amountPhi && (
                                <div className="row">
                                  <span className="k">Exhaled</span>
                                  <span className="v">
                                    Φ {lineagePhi} · ${lineageUsd}
                                  </span>
                                </div>
                              )}

                              {hardened && (
                                <>
                                  <div className="row">
                                    <span className="k">Prev-Head</span>
                                    <span className="v mono" style={S.mono}>
                                      {hardened.previousHeadRoot}
                                    </span>
                                  </div>

                                  <div className="row">
                                    <span className="k">Exhale leaf</span>
                                    <span className="v mono" style={S.mono}>
                                      {hardened.transferLeafHashSend}
                                    </span>
                                  </div>

                                  {hardened.transferLeafHashReceive && (
                                    <div className="row">
                                      <span className="k">Inhale leaf</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.transferLeafHashReceive}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkSend && (
                                    <div className="row">
                                      <span className="k">ZK Exhale:</span>
                                      <span className="v">
                                        {hardened.zkSend.verified ? "✓" : "•"} {hardened.zkSend.scheme}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkSend?.proofHash && (
                                    <div className="row">
                                      <span className="k">ZK Exhale hash:</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.zkSend.proofHash}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkReceive && (
                                    <div className="row">
                                      <span className="k">ZK Inhale</span>
                                      <span className="v">
                                        {hardened.zkReceive.verified ? "✓" : "•"} {hardened.zkReceive.scheme}
                                      </span>
                                    </div>
                                  )}

                                  {hardened.zkReceive?.proofHash && (
                                    <div className="row">
                                      <span className="k">ZK Inhale hash</span>
                                      <span className="v mono" style={S.mono}>
                                        {hardened.zkReceive.proofHash}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )}

                              {t.receiverSignature && (
                                <>
                                  <div className="row">
                                    <span className="k">Inhaler Σ</span>
                                    <span className="v mono" style={S.mono}>
                                      {t.receiverSignature}
                                    </span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Inhaler Seal</span>
                                    <span className="v mono" style={S.mono}>
                                      {t.receiverStamp}
                                    </span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Inhaler Pulse</span>
                                    <span className="v">{t.receiverKaiPulse}</span>
                                  </div>
                                </>
                              )}

                              {t.payload && (
                                <details className="payload" open>
                                  <summary>Payload</summary>
                                  <div className="row">
                                    <span className="k">Name</span>
                                    <span className="v">{t.payload.name}</span>
                                  </div>
                                  <div className="row">
                                    <span className="k">MIME</span>
                                    <span className="v">{t.payload.mime}</span>
                                  </div>
                                  <div className="row">
                                    <span className="k">Size</span>
                                    <span className="v">{t.payload.size} bytes</span>
                                  </div>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="empty">No stewardship yet — ready to exhale from Sigil-Glyph.</p>
                    )}
                  </div>
                )}

                {tab === "data" && (
                  <>
                    <div className="json-toggle">
                      <label>
                        <input type="checkbox" checked={viewRaw} onChange={() => setViewRaw((v) => !v)} /> View raw JSON
                      </label>
                    </div>
                    {viewRaw ? (
                      <pre className="raw-json" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {rawMeta}
                      </pre>
                    ) : (
                      <div className="json-tree-wrap" style={{ overflowX: "hidden" }}>
                        <JsonTree data={meta} />
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Footer */}
              <footer className="modal-footer" style={{ position: "sticky", bottom: 0 }}>
                {error && (
                  <p className="status error" style={{ overflowWrap: "anywhere" }}>
                    {error}
                  </p>
                )}

                <div
                  className="footer-actions"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {uiState === "unsigned" && (
                    <button className="secondary" onClick={sealUnsigned}>
                      Seal content (Σ + Φ)
                    </button>
                  )}

                  {(uiState === "readySend" || uiState === "verified") && (
                    <div
                      className="send-row no-zoom-input"
                      data-nozoom="true"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flex: "1 1 auto",
                        minWidth: 0,
                        fontSize: 16, // iOS Safari: ≥16px prevents zoom-on-focus
                        WebkitTextSizeAdjust: "100%",
                      }}
                    >
                      <SendPhiAmountField
                        amountMode={amountMode}
                        setAmountMode={setAmountMode}
                        usdInput={usdInput}
                        phiInput={phiInput}
                        setUsdInput={setUsdInput}
                        setPhiInput={setPhiInput}
                        convDisplayRight={conv.displayRight}
                        remainingPhiDisplay4={remainingPhiDisplay4}
                        canonicalContext={canonicalContext}
                        phiFormatter={(s) => toStr6(toScaled6(fmtPhiCompact(s)))} // enforce 6dp in the input field
                      />
                      <IconBtn
                        className="primary"
                        onClick={send}
                        aria="Exhale (send)"
                        titleText={canShare ? "Exhale (seal & share)" : "Exhale (seal & copy link)"}
                        disabled={!canExhale}
                        small
                        path="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                      />
                      <IconBtn
                        onClick={() => fileInput.current?.click()}
                        aria="Attach a file"
                        titleText="Attach a file"
                        small
                        path="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.2a2 2 0 01-2.83-2.83l8.49-8.49"
                      />
                      <input ref={fileInput} type="file" hidden onChange={handleAttach} />
                    </div>
                  )}

                  {uiState === "readyReceive" && (
                    <IconBtn
                      className="primary"
                      onClick={receive}
                      aria="Inhale (receive)"
                      titleText={
                        canonicalContext === "derivative" && childUsed ? "Link already used" : "Inhale"
                      }
                      disabled={canonicalContext === "derivative" && childUsed}
                      path="M2 22l11-11M2 22l20-7-9-4-4-9-7 20z"
                    />
                  )}

                  {(meta?.transfers?.length ?? 0) > 0 && (
                    <IconBtn
                      className="secondary"
                      onClick={sealSegmentNow}
                      aria="Segment head window"
                      titleText="Roll current head-window into a segment (continuous)"
                      disabled={isSendFilename}
                      small
                      path="M12 3l9 4-9 4-9-4 9-4zm-9 8l9 4 9-4M3 19l9 4 9-4"
                    />
                  )}
                </div>
              </footer>
            </>
          )}
        </div>
      </dialog>

      {/* Seal moment dialog (share link after SEND) */}
      <SealMomentModal
        open={sealOpen}
        url={sealUrl}
        hash={sealHash}
        onClose={() => {
          setSealOpen(false);
          setRotateOut(false);
          openVerifier();
        }}
        onDownloadZip={downloadZip}
      />

      {/* Valuation */}
      {meta && metaLiteForNote && (
        <ValuationModal
          open={valuationOpen}
          onClose={closeValuation}
          meta={metaLiteForNote}
          nowPulse={pulseNow}
          initialGlyph={initialGlyph ?? undefined}
          onAttach={uiState === "verified" ? onAttachValuation : undefined}
        />
      )}

      {/* Note printer */}
      <dialog
        ref={noteDlgRef}
        className="glass-modal fullscreen"
        id="note-dialog"
        data-open={noteOpen ? "true" : "false"}
        aria-label="Note Exhaler"
        style={S.full}
      >
        <div className="modal-viewport" style={S.viewport}>
          <div className="modal-topbar" style={S.gridBar}>
            <div style={{ paddingInline: 12, fontSize: 12, color: "var(--dim)" }}>Kairos — Note Exhaler</div>
            <button
              className="close-btn holo"
              data-aurora="true"
              aria-label="Close"
              title="Close"
              onClick={closeNote}
              style={{ justifySelf: "end", marginRight: 8 }}
            >
              ×
            </button>
          </div>

          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            {sigilSvgRaw && metaLiteForNote ? (
              <NotePrinter meta={metaLiteForNote} initial={noteInitial} />
            ) : sigilSvgRaw ? (
              <div style={{ padding: 16, color: "var(--dim)" }}>Missing valuation metadata for Note — upload/parse a sigil first.</div>
            ) : (
              <div style={{ padding: 16, color: "var(--dim)" }}>Load a sigil to print a note.</div>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
};

export default function VerifierStamper() {
  return (
    <VerifierErrorBoundary onReset={() => {}}>
      <React.Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
        <VerifierStamperInner />
      </React.Suspense>
    </VerifierErrorBoundary>
  );
}
