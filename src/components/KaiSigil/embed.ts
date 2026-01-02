import { canonicalize } from "../../lib/sigil/canonicalize";
import { blake3Hex } from "../../lib/sigil/hash";
import { gzipB64 } from "../../lib/sigil/codec";
import {
  getSigner,
  signHash as signWithProvider,
  type HarmonicSig,
} from "../../lib/sigil/signature";
import { generateKeyPair, signCanonicalMessage } from "../../lib/sigil/breathProof";

import { createLedger, packLedger } from "../../lib/ledger/log";
import type { MintEntry } from "../../lib/ledger/types";
import { buildDhtBlock } from "../../lib/sync/dht";
import { NoopIpfs } from "../../lib/sync/nopAdapter";

import {
  base58Encode,
  b64ToUint8,
  crc32,
  hexToBytes,
  sha256,
  toBufferSource,
} from "./crypto";
import { clean, type JSONDict } from "./utils";
import { jwkToJSONLike } from "./identity";
import type { Built, SigilPayloadExtended, ChakraDayKey, ZkProof } from "./types";
import type { SigilMetadataLite } from "../../utils/valuation";
import { makeSigilUrl, type SigilSharePayload } from "../../utils/sigilUrl";
import { computeZkPoseidonHash } from "../../utils/kai";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../../utils/zkProof";

/* ─────────────────────────────────────────────────────────────
 * STRICT CONVERSION: guarantee ArrayBuffer (not SharedArrayBuffer)
 * for anything we pass into WebCrypto (BufferSource).
 * ───────────────────────────────────────────────────────────── */
type AnyView = ArrayBufferView & {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
};

function toStrictArrayBuffer(src: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (src instanceof ArrayBuffer) {
    // Return a cloned AB to avoid SAB-taint and detachment issues
    return src.slice(0);
  }
  const view = src as AnyView;
  const out = new Uint8Array(view.byteLength);
  out.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return out.buffer; // definite ArrayBuffer
}

/* ─────────────────────────────────────────────────────────────
 * WebCrypto sign params helper (no `any`):
 *  - ECDSA → { name:'ECDSA', hash:{name:'SHA-256'} }
 *  - Ed25519/Ed448 → { name:'Ed25519' | 'Ed448' }
 *  - RSA-PSS → { name:'RSA-PSS', saltLength:n }
 *  - Fallback → { name: <algo-name> } as AlgorithmIdentifier
 * ───────────────────────────────────────────────────────────── */
type SignParams = AlgorithmIdentifier | EcdsaParams | RsaPssParams;

function getSignParamsForKey(key: CryptoKey): SignParams {
  const algoName = (key.algorithm?.name || "").toUpperCase();

  if (algoName === "ECDSA") {
    const p: EcdsaParams = { name: "ECDSA", hash: { name: "SHA-256" } };
    return p;
  }
  if (algoName === "ED25519") {
    const p: AlgorithmIdentifier = { name: "Ed25519" };
    return p;
  }
  if (algoName === "ED448") {
    const p: AlgorithmIdentifier = { name: "Ed448" };
    return p;
  }
  if (algoName === "RSA-PSS") {
    const p: RsaPssParams = { name: "RSA-PSS", saltLength: 32 };
    return p;
  }
  // Best-effort generic
  const generic: AlgorithmIdentifier = { name: key.algorithm.name };
  return generic;
}

/* ─────────────────────────────────────────────────────────────
 * Return type
 * ───────────────────────────────────────────────────────────── */
export type EmbeddedBundleResult = Pick<
  Built,
  "payloadHashHex" | "sigilUrl" | "hashB58" | "innerRingText" | "zkPoseidonHash" | "zkPoseidonSecret"
> & {
  parityUrl: string;
  embeddedBase: unknown;
};

/* ─────────────────────────────────────────────────────────────
 * Chakra label normalization
 * ───────────────────────────────────────────────────────────── */
const chakraFromKey = (k: string): SigilSharePayload["chakraDay"] => {
  const s = (k || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "root") return "Root";
  if (s === "sacral") return "Sacral";
  if (s === "solar plexus" || s === "solarplexus") return "Solar Plexus";
  if (s === "heart") return "Heart";
  if (s === "throat") return "Throat";
  if (s === "third eye" || s === "thirdeye" || s === "third-eye") return "Third Eye";
  return "Crown";
};

const isZkProof = (value: unknown): value is ZkProof => {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.pi_a) && Array.isArray(rec.pi_b) && Array.isArray(rec.pi_c);
};

/* ─────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────── */
export async function buildEmbeddedBundle(args: {
  canon: {
    pulse: number;
    beat: number;
    stepIndex: number; // 0..43
    chakraDayKey: ChakraDayKey;
    stepsPerBeat: number; // 44
  };
  hashMode: "moment" | "deterministic";
  chakraGate: string;
  kaiSignature?: string | undefined;
  userPhiKey?: string | undefined;
  intentionSigil?: string | undefined; // kept for compatibility
  origin?: string | undefined;
  title: string;
  klockSnapshot?: Record<string, unknown> | null; // kept for compatibility
  kaiApiSnapshot?: Record<string, unknown> | null; // kept for compatibility
  weekdayResolved?: string | null;
  valuationSource: SigilMetadataLite;
  mintSeal: SigilMetadataLite | null;
  frequencyHzCurrent: number;
  qrHref?: string | undefined; // kept for compatibility
  canonicalUrlFromContext: (hashHex: string, base: string) => string; // kept
  creatorResolved: { creator: string; creatorAlg: string; creatorId: string };
}): Promise<EmbeddedBundleResult> {
  const {
    canon,
    hashMode,
    chakraGate,
    kaiSignature,
    userPhiKey,
    origin,
    title,
    weekdayResolved,
    valuationSource,
    mintSeal,
    frequencyHzCurrent,
    // qrHref, canonicalUrlFromContext, intentionSigil, klockSnapshot, kaiApiSnapshot — intentionally unused
    creatorResolved,
  } = args;

  const nowIso = new Date().toISOString();
  const includeTimestamp = (hashMode ?? "moment") === "moment";

  const headerBase = {
    v: "1.0",
    title,
    creator: creatorResolved.creator,
    creatorAlg: creatorResolved.creatorAlg,
    creatorId: creatorResolved.creatorId,
    pulse: canon.pulse,
    ...(includeTimestamp ? { timestamp: nowIso } : {}),
  } as const;

  const eternalRecord =
    clean(title, 300) ??
    `Day Seal: ${canon.beat}:${canon.stepIndex} • Kai-Pulse ${canon.pulse}`;

  let zkPoseidonHash = "0x";
  let zkPoseidonSecret = "";
  let zkProof: ZkProof | null | undefined;
  let zkPublicInputs: string[] | undefined;
  let payloadObj: SigilPayloadExtended = {
    v: "1.0",
    kaiSignature: kaiSignature ?? "",
    phikey: userPhiKey ?? "",
    pulse: canon.pulse,
    beat: canon.beat,
    stepIndex: canon.stepIndex,
    chakraDay: canon.chakraDayKey,
    chakraGate,
    kaiPulse: canon.pulse,
    stepsPerBeat: canon.stepsPerBeat,
    ...(includeTimestamp ? { timestamp: nowIso } : {}),
    eternalRecord,
    creatorResolved: headerBase.creator,
    origin: origin ?? (typeof window !== "undefined" ? window.location.origin : ""),
    proofHints: {
      scheme: "groth16-poseidon",
      api: "/api/proof/sigil",
      explorer: `/keystream/hash/<hash>`,
    },
    zkPoseidonHash,
  };

  let proofHints = payloadObj.proofHints;

  const canonicalPayloadBase: JSONDict = {
    v: payloadObj.v,
    kaiSignature: payloadObj.kaiSignature,
    phikey: payloadObj.phikey,
    pulse: payloadObj.pulse,
    beat: payloadObj.beat,
    stepIndex: payloadObj.stepIndex,
    chakraDay: payloadObj.chakraDay,
    chakraGate: payloadObj.chakraGate,
    kaiPulse: payloadObj.kaiPulse,
    stepsPerBeat: payloadObj.stepsPerBeat,
    timestamp: payloadObj.timestamp,
    eternalRecord: payloadObj.eternalRecord,
    creatorResolved: payloadObj.creatorResolved,
    origin: payloadObj.origin,
    proofHints: payloadObj.proofHints,
    zkPoseidonHash,
    zkProof: payloadObj.zkProof,
    ownerPubKey: payloadObj.ownerPubKey
      ? jwkToJSONLike(payloadObj.ownerPubKey)
      : undefined,
    ownerSig: payloadObj.ownerSig,
  };

  const canonicalBaseBytes = canonicalize(canonicalPayloadBase);
  const payloadHashHex = await blake3Hex(canonicalBaseBytes);
  const poseidonResult = await computeZkPoseidonHash(payloadHashHex);
  zkPoseidonHash = poseidonResult.hash;
  zkPoseidonSecret = poseidonResult.secret;
  payloadObj = { ...payloadObj, zkPoseidonHash };
  proofHints = buildProofHints(zkPoseidonHash, proofHints);

  if (typeof window !== "undefined") {
    const generated = await generateZkProofFromPoseidonHash({
      poseidonHash: zkPoseidonHash,
      secret: zkPoseidonSecret,
      proofHints,
    });
    if (generated) {
      zkProof = isZkProof(generated.proof) ? generated.proof : null;
      zkPublicInputs = generated.zkPublicInputs;
      proofHints = generated.proofHints;
      payloadObj = { ...payloadObj, zkProof, proofHints };
    }
  }

  const canonicalPayload: JSONDict = {
    v: payloadObj.v,
    kaiSignature: payloadObj.kaiSignature,
    phikey: payloadObj.phikey,
    pulse: payloadObj.pulse,
    beat: payloadObj.beat,
    stepIndex: payloadObj.stepIndex,
    chakraDay: payloadObj.chakraDay,
    chakraGate: payloadObj.chakraGate,
    kaiPulse: payloadObj.kaiPulse,
    stepsPerBeat: payloadObj.stepsPerBeat,
    timestamp: payloadObj.timestamp,
    eternalRecord: payloadObj.eternalRecord,
    creatorResolved: payloadObj.creatorResolved,
    origin: payloadObj.origin,
    proofHints: payloadObj.proofHints,
    zkPoseidonHash: payloadObj.zkPoseidonHash,
    zkProof: payloadObj.zkProof,
    ownerPubKey: payloadObj.ownerPubKey
      ? jwkToJSONLike(payloadObj.ownerPubKey)
      : undefined,
    ownerSig: payloadObj.ownerSig,
  };

  const canonicalBytes = canonicalize(canonicalPayload);

  const hashSha256Hex = Array.from(await sha256(canonicalBaseBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const payloadB64 = gzipB64(canonicalBytes);

  let payloadSignature: HarmonicSig | undefined;
  const signer = getSigner();
  if (signer) payloadSignature = await signWithProvider(payloadHashHex);

  const integrity = {
    payloadEncoding: "gzip+base64",
    payloadHash: { alg: "blake3", value: payloadHashHex },
    payloadHashSecondary: { alg: "sha256", value: hashSha256Hex },
    payloadSignature:
      payloadSignature ?? {
        alg: "harmonic-sig",
        public: userPhiKey ?? creatorResolved.creatorId,
        value: "",
      },
  } as const;

  /* ── Owner signature over canonical ledger event ─────────── */
  const canonicalMsg = canonicalize({
    parentCanonical: "optional-parent-ref",
    parentStateRoot: "optional-state-root",
    eventKind: "mint",
    pulse: canon.pulse,
    beat: canon.beat,
    stepIndex: canon.stepIndex,
    chakraDay: canon.chakraDayKey,
    childNonce: `${canon.beat}-${canon.stepIndex}`,
    amount: "1.000",
    expiresAtPulse: canon.pulse + 12,
    lineageCommitment: "optional-hash-of-lineage",
  });

  const canonicalMsgBuf = toBufferSource(canonicalMsg);
  const canonicalMsgAB = toStrictArrayBuffer(
    canonicalMsgBuf as ArrayBuffer | ArrayBufferView
  );

  const { publicKeyJwk, privateKey } = await generateKeyPair();
  const ownerSig = await signCanonicalMessage(privateKey, canonicalMsgAB);
  payloadObj.ownerPubKey = publicKeyJwk;
  payloadObj.ownerSig = ownerSig;

  /* ── Manifest URL ─────────────────────────────────────────── */
  const manifestPayload: SigilSharePayload & {
    canonicalHash: string;
    exportedAt: string;
    expiresAtPulse: number;
  } = {
    pulse: canon.pulse,
    beat: canon.beat,
    stepIndex: canon.stepIndex,
    chakraDay: chakraFromKey(String(canon.chakraDayKey)),
    stepsPerBeat: canon.stepsPerBeat,
    canonicalHash: payloadHashHex,
    exportedAt: nowIso,
    expiresAtPulse: canon.pulse + 11,
    kaiSignature: kaiSignature ?? undefined,
    userPhiKey: userPhiKey ?? undefined,
  };

  const manifestUrl = makeSigilUrl(payloadHashHex, manifestPayload);

  /* ── Ledger + DHT ─────────────────────────────────────────── */
  const mintEntry: MintEntry = {
    v: 1,
    pulse: canon.pulse,
    beat: canon.beat,
    stepIndex: canon.stepIndex,
    chakraDay: canon.chakraDayKey,
    stepsPerBeat: canon.stepsPerBeat,
    kaiSignature: kaiSignature ?? undefined,
    userPhiKey: userPhiKey ?? undefined,
    ts: nowIso,
  };

  const ledger = await createLedger([mintEntry]);
  const packed = await packLedger(ledger);
  const packedBytes = b64ToUint8(packed.payload);

  const dhtBlock = await buildDhtBlock({
    ipfs: NoopIpfs,
    packedLedgerBytes: packedBytes,
    prevCid: undefined,
    pubKeyJwk: payloadObj.ownerPubKey,
    merkleRoot: ledger.root,
    pulse: canon.pulse,
    sign: async (msg: Uint8Array) => {
      // Convert to guaranteed ArrayBuffer before WebCrypto:
      const safeAB = toStrictArrayBuffer(msg);

      // Supply correct params for the key algorithm (fixes ECDSA `hash` error)
      const params = getSignParamsForKey(privateKey as CryptoKey);

      const sigBuf = await crypto.subtle.sign(params, privateKey as CryptoKey, safeAB);
      return new Uint8Array(sigBuf);
    },
  });

  /* ── Header + Embedded Base ───────────────────────────────── */
  const header = { ...headerBase, shareUrl: manifestUrl };

  const embeddedBase = {
    $schema: "https://atlantean.lumitech/schemas/kai-sigil/1.0.json",
    contentType: "application/vnd.kai-sigil+json;v=1",
    header,
    payload: payloadB64,
    integrity,
    frequencyHzAtMint: frequencyHzCurrent,
    zkPoseidonHash: payloadObj.zkPoseidonHash,
    zkProof,
    zkPublicInputs,
    proofHints,
    valuationSource: valuationSource ?? null,
    valuationSeal: mintSeal ?? null,
  };

  /* ── Diagnostics / inner ring ─────────────────────────────── */
  const len = canonicalBytes.length;
  const crcHex = crc32(canonicalBytes).toString(16).padStart(8, "0");
  const hashB58 = base58Encode(hexToBytes(payloadHashHex));
  const creatorShort = creatorResolved.creatorId.slice(0, 12);
  const zkShort = String(payloadObj.zkPoseidonHash).slice(0, 12);

  const inner = [
    `u=${manifestUrl}`,
    `b58=${hashB58}`,
    `len=${len}`,
    `crc32=${crcHex}`,
    `creator=${creatorShort}`,
    `zk=${zkShort}`,
    `alg=${creatorResolved.creatorAlg}`,
  ].join(" · ");

  const meta = {
    ...embeddedBase,
    ledger: packed,
    dht: dhtBlock,
    weekdayResolved: weekdayResolved ?? null,
  };

  return {
    parityUrl: manifestUrl,
    payloadHashHex,
    innerRingText: inner,
    sigilUrl: manifestUrl,
    hashB58,
    zkPoseidonHash: payloadObj.zkPoseidonHash,
    zkPoseidonSecret,
    embeddedBase: meta,
  };
}

export function stringifyEmbeddedMeta(embedded: unknown): string {
  return JSON.stringify(embedded);
}
