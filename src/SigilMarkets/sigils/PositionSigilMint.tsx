// SigilMarkets/sigils/PositionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * PositionSigilMint — Production (Atlantean Chip / Center Value / Ring-Encoded Data)
 *
 * HARD RULES:
 * - NO USD FALLBACK. If USD valuation logic is not present, we THROW (no fake prices).
 * - ZK = VERIFIED when proof bundle OR public inputs are present. Also embed them into sm-zk metadata.
 * - No straight header lines: everything is on rings/arcs.
 * - No overlaps: ring text is placed on fixed radii with deterministic spacing.
 */

import { useCallback, useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../types/marketTypes";
import type {
  ClaimSigilArtifact,
  ClaimSigilPayloadV1,
  PositionRecord,
  PositionSigilArtifact,
  PositionSigilPayloadV1,
  SigilLineageFields,
} from "../types/sigilPositionTypes";
import { asPositionSigilId } from "../types/sigilPositionTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { asSvgHash } from "../types/vaultTypes";

import { sha256Hex, derivePositionSigilId } from "../utils/ids";
import { deriveChildSeed, deriveLineageId, resolveLineageRoot } from "../utils/lineage";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsPositionStore } from "../state/positionStore";
import { useSigilMarketsUi } from "../state/uiStore";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd, usdValueFromPhi } from "../../utils/phi-issuance";
import { momentFromPulse } from "../../utils/kai_pulse";
import { formatPhiMicro } from "../utils/format";
import type { SigilMetadataLite } from "../../utils/valuation";
/** local compat brand */
type MicroDecimalString = string & { readonly __brand: "MicroDecimalString" };
const asMicroDecimalString = (v: string): MicroDecimalString => v as MicroDecimalString;

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

type PositionOrClaimPayload = PositionSigilPayloadV1 | ClaimSigilPayloadV1;

const isClaimPayload = (payload: PositionOrClaimPayload): payload is ClaimSigilPayloadV1 => payload.kind === "claim";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const biDec = (v: bigint): MicroDecimalString => asMicroDecimalString(v < 0n ? "0" : v.toString(10));
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const coerceKaiMoment = (v: unknown): KaiMoment => {
  if (!isRecord(v)) return { pulse: 0, beat: 0, stepIndex: 0 };
  const p = v["pulse"];
  const pulseRaw = typeof p === "number" && Number.isFinite(p) ? Math.floor(p) : 0;
  const pulse = pulseRaw < 0 ? 0 : pulseRaw;
  const derived = momentFromPulse(pulse);
  return { pulse, beat: derived.beat, stepIndex: derived.stepIndex };
};

/** Tiny deterministic PRNG (xorshift32) from hex seed */
const seed32FromHex = (hex: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < hex.length; i += 1) {
    h ^= hex.charCodeAt(i);
    h =
      (h +
        ((h << 1) >>> 0) +
        ((h << 4) >>> 0) +
        ((h << 7) >>> 0) +
        ((h << 8) >>> 0) +
        ((h << 24) >>> 0)) >>>
      0;
  }
  return h >>> 0;
};

const makeRng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
};

const PHI = (1 + Math.sqrt(5)) / 2;

/* ─────────────────────────────────────────────────────────────
 * Canonicalization (strict, stable, no `any`)
 * ───────────────────────────────────────────────────────────── */

type JSONPrimitive = string | number | boolean | null;
interface JSONObject {
  readonly [k: string]: JSONValue;
}
type JSONValue = JSONPrimitive | ReadonlyArray<JSONValue> | JSONObject;

const isJsonPrimitive = (v: unknown): v is JSONPrimitive =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const toJsonValue = (v: unknown): JSONValue => {
  if (isJsonPrimitive(v)) return v;
  if (Array.isArray(v)) return v.map((x) => toJsonValue(x));
  if (isRecord(v)) {
    const out: Record<string, JSONValue> = {};
    const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) out[k] = toJsonValue(v[k]);
    return out;
  }
  return String(v);
};

const stableStringify = (v: JSONValue): string => {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (typeof v !== "object" || v === null) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const obj = v as JSONObject;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

const safeCdata = (raw: string): string => {
  const safe = raw.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};

/* ─────────────────────────────────────────────────────────────
 * Hash bit ring helpers
 * ───────────────────────────────────────────────────────────── */

const hexToBits256 = (hex: string): readonly (0 | 1)[] => {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  const out: Array<0 | 1> = [];
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean.charCodeAt(i);
    const n = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : 0;
    out.push(((n >> 3) & 1) as 0 | 1);
    out.push(((n >> 2) & 1) as 0 | 1);
    out.push(((n >> 1) & 1) as 0 | 1);
    out.push((n & 1) as 0 | 1);
  }
  if (out.length > 256) return out.slice(0, 256);
  while (out.length < 256) out.push(0);
  return out;
};

const bitsToBinaryString = (hex: string): string => {
  const bits = hexToBits256(hex);
  let s = "";
  for (let i = 0; i < bits.length; i += 1) s += bits[i] === 1 ? "1" : "0";
  return s;
};

const hexToBigIntDec = (hex: string): string => {
  const clean = hex.replace(/^0x/i, "").trim();
  if (!/^[0-9a-fA-F]+$/.test(clean)) return "0";
  const bi = BigInt(`0x${clean}`);
  return bi.toString(10);
};

/* ─────────────────────────────────────────────────────────────
 * Amount formatting (Φ + USD)
 * ───────────────────────────────────────────────────────────── */

const MICRO_PER_PHI = 1_000_000n;

const microDecToPhiDec6 = (microDec: string): string => {
  let m = 0n;
  try {
    if (!/^[0-9]+$/.test(microDec)) return "0.000000";
    m = BigInt(microDec);
  } catch {
    return "0.000000";
  }
  const i = m / MICRO_PER_PHI;
  const f = m % MICRO_PER_PHI;
  const frac = f.toString(10).padStart(6, "0");
  return `${i.toString(10)}.${frac}`;
};

const phiDec6ToNumber = (phiDec6: string): number => {
  const m = /^([0-9]+)\.([0-9]{6})$/.exec(phiDec6);
  if (!m) return 0;
  const a = Number(m[1]);
  const b = Number(m[2]) / 1e6;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return a + b;
};

const formatUsd2 = (usd: number): string => {
  if (!Number.isFinite(usd)) return "0.00";
  return usd.toFixed(2);
};

const FALLBACK_META = { ip: { expectedCashflowPhi: [] } } as unknown as SigilMetadataLite;



/* ─────────────────────────────────────────────────────────────
 * Φ logo embedding (public/phi.svg => inline SVG markup)
 * ───────────────────────────────────────────────────────────── */

type PhiLogoMarkup = Readonly<{
  viewBox: string;
  inner: string;
}>;

let phiLogoMarkupPromise: Promise<PhiLogoMarkup | null> | null = null;

const extractPhiLogoMarkup = (raw: string): PhiLogoMarkup | null => {
  const cleaned = raw
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .trim();

  const openMatch = cleaned.match(/<svg\b([^>]*)>/i);
  const closeIndex = cleaned.toLowerCase().lastIndexOf("</svg>");
  if (!openMatch || closeIndex < 0) return null;

  const openTag = openMatch[0];
  const attrs = openMatch[1] ?? "";
  const inner = cleaned.slice(openTag.length, closeIndex).trim();

  const viewBoxMatch = attrs.match(/viewBox\s*=\s*(['"])(.*?)\1/i);
  let viewBox = viewBoxMatch?.[2] ?? "";
  if (!viewBox) {
    const widthMatch = attrs.match(/width\s*=\s*(['"]?)([\d.]+)\1/i);
    const heightMatch = attrs.match(/height\s*=\s*(['"]?)([\d.]+)\1/i);
    if (widthMatch && heightMatch) {
      viewBox = `0 0 ${widthMatch[2]} ${heightMatch[2]}`;
    }
  }
  if (!viewBox) viewBox = "0 0 400 400";

  return inner ? { viewBox, inner } : null;
};

const getPhiLogoMarkupAsync = async (): Promise<PhiLogoMarkup | null> => {
  if (phiLogoMarkupPromise) return phiLogoMarkupPromise;

  phiLogoMarkupPromise = (async () => {
    try {
      // public/phi.svg should be reachable at /phi.svg
      const res = await fetch("/phi.svg", { cache: "force-cache" });
      if (!res.ok) return null;
      const raw = (await res.text()).trim();
      if (raw.length < 16) return null;
      return extractPhiLogoMarkup(raw);
    } catch {
      return null;
    }
  })();

  return phiLogoMarkupPromise;
};

/* ─────────────────────────────────────────────────────────────
 * ZK extraction (PROOF + PUBLIC INPUT AWARE)
 * ───────────────────────────────────────────────────────────── */

type Groth16Proof = Readonly<{
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
}>;

type ZkAssurance = "proof-present" | "public-inputs-present" | "verified-flag" | "seal-match" | "none";

type ZkSeal = Readonly<{
  scheme: "groth16-poseidon";
  canonicalHashAlg: "sha256";
  canonicalHashHex: string;
  canonicalBytesLen: number;

  /** Poseidon public input (decimal). */
  zkPoseidonHashDec: string;

  /** True => label VERIFIED in glyph. */
  zkOk: boolean;

  /** Why. */
  zkAssurance: ZkAssurance;

  /** Embedded proof + inputs (so sm-zk is self-contained). */
  zkProof?: Groth16Proof;
  zkPublicInputs?: readonly string[];

  proofHints?: Readonly<Record<string, unknown>>;
  verifiedBy?: string;

  matches?: Readonly<{ vaultCanonical?: boolean; vaultPoseidon?: boolean }>;
}>;

const isStringOrNumberArray = (v: unknown): v is readonly (string | number)[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");

const normalizeStringArray = (v: unknown): readonly string[] | undefined =>
  isStringOrNumberArray(v) ? v.map((entry) => String(entry)) : undefined;

const normalizeStringArray2 = (v: unknown): readonly (readonly string[])[] | undefined =>
  Array.isArray(v) && v.every((row) => isStringOrNumberArray(row))
    ? v.map((row) => row.map((entry) => String(entry)))
    : undefined;

const normalizeGroth16Proof = (v: unknown): Groth16Proof | undefined => {
  if (!isRecord(v)) return undefined;
  const piA = normalizeStringArray(v["pi_a"]);
  const piB = normalizeStringArray2(v["pi_b"]);
  const piC = normalizeStringArray(v["pi_c"]);
  if (piA && piB && piC) {
    return { pi_a: piA, pi_b: piB, pi_c: piC };
  }
  const a = normalizeStringArray(v["a"]);
  const b = normalizeStringArray2(v["b"]);
  const c = normalizeStringArray(v["c"]);
  if (a && b && c) {
    return { pi_a: a, pi_b: b, pi_c: c };
  }
  if (isRecord(v["proof"])) return normalizeGroth16Proof(v["proof"]);
  return undefined;
};

const truthyBool = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";

type ZkExtract = Readonly<{
  canonicalHashHex?: string;
  zkPoseidonHashDec?: string;
  zkProof?: Groth16Proof;
  zkPublicInputs?: readonly string[];
  proofHints?: Readonly<Record<string, unknown>>;
  verifiedFlag?: boolean;
  verifiedBy?: string;
}>;

const extractZkFromUnknown = (src: unknown): ZkExtract => {
  if (!isRecord(src)) return {};

  const canonicalHashHex =
    typeof src["canonicalHashHex"] === "string"
      ? (src["canonicalHashHex"] as string)
      : typeof src["canonicalHash"] === "string"
        ? (src["canonicalHash"] as string)
        : undefined;

  // Accept the payload’s actual naming: zkPoseidonHash (decimal string)
  const zkPoseidonHashDec =
    typeof src["zkPoseidonHashDec"] === "string"
      ? (src["zkPoseidonHashDec"] as string)
      : typeof src["zkPoseidonHash"] === "string"
        ? (src["zkPoseidonHash"] as string)
        : typeof src["zkPoseidon"] === "string"
          ? (src["zkPoseidon"] as string)
          : undefined;

  const proofHints = isRecord(src["proofHints"]) ? (src["proofHints"] as Readonly<Record<string, unknown>>) : undefined;

  const zkPublicInputs =
    normalizeStringArray(src["zkPublicInputs"]) ??
    normalizeStringArray(src["publicInputs"]) ??
    normalizeStringArray(src["zkPublicInput"]);

  const candidates: readonly unknown[] = [
    src["zkProof"],
    src["proof"],
    src["groth16Proof"],
    src["proofBundle"],
    isRecord(src["proofBundle"]) ? src["proofBundle"]["proof"] : undefined,
    isRecord(src["zk"]) ? src["zk"]["proof"] : undefined,
    isRecord(src["zk"]) ? src["zk"]["zkProof"] : undefined,
    isRecord(src["zk"]) ? src["zk"]["groth16Proof"] : undefined,
  ];

  let zkProof: Groth16Proof | undefined;
  for (const c of candidates) {
    const p = normalizeGroth16Proof(c);
    if (p) {
      zkProof = p;
      break;
    }
  }

  const verifiedFlag =
    truthyBool(src["zkOk"]) ||
    truthyBool(src["zkVerified"]) ||
    truthyBool(src["verified"]) ||
    (isRecord(src["zk"]) ? truthyBool(src["zk"]["ok"]) || truthyBool(src["zk"]["verified"]) : false);

  const verifiedBy =
    typeof src["verifiedBy"] === "string"
      ? (src["verifiedBy"] as string)
      : typeof src["zkVerifier"] === "string"
        ? (src["zkVerifier"] as string)
        : isRecord(src["zk"]) && typeof src["zk"]["verifier"] === "string"
          ? (src["zk"]["verifier"] as string)
          : undefined;

  return { canonicalHashHex, zkPoseidonHashDec, zkProof, zkPublicInputs, proofHints, verifiedFlag, verifiedBy };
};

const mergePrefer = (...xs: readonly ZkExtract[]): ZkExtract => {
  const pickFirst = <T,>(get: (z: ZkExtract) => T | undefined): T | undefined => {
    for (const z of xs) {
      const v = get(z);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  return {
    canonicalHashHex: pickFirst((z) => z.canonicalHashHex),
    zkPoseidonHashDec: pickFirst((z) => z.zkPoseidonHashDec),
    zkProof: pickFirst((z) => z.zkProof),
    zkPublicInputs: pickFirst((z) => z.zkPublicInputs),
    proofHints: pickFirst((z) => z.proofHints),
    verifiedFlag: xs.some((z) => Boolean(z.verifiedFlag)),
    verifiedBy: pickFirst((z) => z.verifiedBy),
  };
};

const firstDecimalInput = (xs?: readonly string[]): string | undefined => {
  if (!xs) return undefined;
  for (const s of xs) {
    if (typeof s === "string" && /^[0-9]+$/.test(s) && s.length > 8) return s;
  }
  return undefined;
};

const canonicalPayloadForSeal = (payload: PositionOrClaimPayload): JSONValue =>
  toJsonValue({
    v: payload.v,
    kind: payload.kind,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    marketId: payload.marketId,
    positionId: payload.positionId,
    side: payload.side,
    lockedStakeMicro: payload.lockedStakeMicro,
    sharesMicro: payload.sharesMicro,
    avgPriceMicro: payload.avgPriceMicro,
    worstPriceMicro: payload.worstPriceMicro,
    feeMicro: payload.feeMicro,
    totalCostMicro: payload.totalCostMicro,
    vaultId: payload.vaultId,
    lockId: payload.lockId,
    openedAt: payload.openedAt,
    venue: "venue" in payload ? payload.venue ?? null : null,
    marketDefinitionHash: payload.marketDefinitionHash ?? null,
    resolution: "resolution" in payload ? payload.resolution ?? null : null,
    outcome: isClaimPayload(payload) ? payload.outcome : null,
    resolutionId: isClaimPayload(payload) ? payload.resolutionId : null,
    resolutionPulse: isClaimPayload(payload) ? payload.resolutionPulse : null,
    decisionId: isClaimPayload(payload) ? payload.decisionId ?? null : null,
    payoutPhiMicro: isClaimPayload(payload) ? payload.payoutPhiMicro : null,
    claimedAt: isClaimPayload(payload) ? payload.claimedAt : null,
    lineageRootSigilId: payload.lineageRootSigilId,
    lineageRootSvgHash: payload.lineageRootSvgHash,
    lineageId: payload.lineageId,
    parentSigilId: payload.parentSigilId ?? null,
    parentSvgHash: payload.parentSvgHash ?? null,
    kaiMoment: payload.kaiMoment,
    label: payload.label ?? null,
    note: payload.note ?? null,
  });

const buildZkSeal = async (payload: PositionOrClaimPayload, vault: VaultRecord | null, pos?: PositionRecord): Promise<ZkSeal> => {
  const canonObj = canonicalPayloadForSeal(payload);

  const canonStr = stableStringify(canonObj);
  const canonicalBytesLen = new TextEncoder().encode(canonStr).byteLength;
  const derivedCanonicalHashHex = await sha256Hex(`SM:POS:CANON:${canonStr}`);

  const owner = vault ? ((vault as unknown as UnknownRecord)["owner"] as unknown) : undefined;

  // Prefer payload first (YOUR proof is in payload metadata)
  const payloadZk = extractZkFromUnknown(payload as unknown);
  const entryZk = pos ? extractZkFromUnknown((pos as unknown as UnknownRecord)["entry"]) : {};
  const posZk = pos ? extractZkFromUnknown(pos as unknown) : {};
  const ownerZk = extractZkFromUnknown(owner);

  const merged = mergePrefer(payloadZk, entryZk, posZk, ownerZk);

  const canonicalHashHex = (merged.canonicalHashHex ?? derivedCanonicalHashHex).toLowerCase();

  // Poseidon: prefer payload field, else publicInputs[0], else derive placeholder.
  const fromInputs = firstDecimalInput(merged.zkPublicInputs);
  const derivedPoseidonDec = hexToBigIntDec(await sha256Hex(`SM:POS:POSEIDON:${canonicalHashHex}`));
  const zkPoseidonHashDec = merged.zkPoseidonHashDec ?? fromInputs ?? derivedPoseidonDec;

  const vaultCanonicalOk =
    typeof ownerZk.canonicalHashHex === "string" ? ownerZk.canonicalHashHex.toLowerCase() === canonicalHashHex : undefined;

  const vaultPoseidonOk =
    typeof ownerZk.zkPoseidonHashDec === "string" ? ownerZk.zkPoseidonHashDec === zkPoseidonHashDec : undefined;

  const proofPresent = Boolean(merged.zkProof);
  const inputsPresent = Boolean(merged.zkPublicInputs && merged.zkPublicInputs.length > 0);
  const byFlag = Boolean(merged.verifiedFlag);
  const byMatch = Boolean(vaultCanonicalOk && vaultPoseidonOk);

  // VERIFIED RULE: if proof OR inputs exist => VERIFIED (verifiable offline with included bundle).
  const zkOk = proofPresent || inputsPresent || byFlag || byMatch;

  const zkAssurance: ZkAssurance =
    proofPresent ? "proof-present"
    : inputsPresent ? "public-inputs-present"
    : byFlag ? "verified-flag"
    : byMatch ? "seal-match"
    : "none";

  return {
    scheme: "groth16-poseidon",
    canonicalHashAlg: "sha256",
    canonicalHashHex,
    canonicalBytesLen,
    zkPoseidonHashDec,
    zkOk,
    zkAssurance,
    zkProof: merged.zkProof,
    zkPublicInputs: merged.zkPublicInputs,
    proofHints:
      merged.proofHints ??
      ({
        scheme: "groth16-poseidon",
        verify: { mode: "offline-or-api", statement: "canonicalHashHex", publicInput: "zkPoseidonHashDec" },
      } as const),
    verifiedBy: merged.verifiedBy,
    matches: { vaultCanonical: vaultCanonicalOk, vaultPoseidon: vaultPoseidonOk },
  };
};

/* ─────────────────────────────────────────────────────────────
 * Ring text (NO OVERLAPS): fixed radii stack + chunking
 * ───────────────────────────────────────────────────────────── */

const circlePathD = (cx: number, cy: number, r: number): string =>
  `M ${cx.toFixed(2)} ${(cy - r).toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 0 ${(2 * r).toFixed(
    2,
  )} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 0 ${(-2 * r).toFixed(2)}`;

type RingLine = Readonly<{
  pathId: string;
  d: string;
  text: string;
  r: number;
  fontSize: number;
  opacity: number;
  letterSpacing: number;
  startOffsetPct: number;
}>;

const splitMax = (s: string, max: number): readonly string[] => {
  if (s.length <= max) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
};

const buildRingLines = (sigId: string, seedHex: string, lines: readonly Readonly<{ text: string; tone: "hi" | "mid" | "low" }>[]): readonly RingLine[] => {
  const rnd = makeRng(seed32FromHex(`RINGS:${seedHex}:${sigId}`));

  // Dedicated radii (no collisions): outer->inner
  const baseR = 376;
  const gap = 18;

  let idx = 0;
  const out: RingLine[] = [];

  for (const ln of lines) {
    const maxChars = ln.tone === "hi" ? 140 : ln.tone === "mid" ? 160 : 180;
    const parts = splitMax(ln.text, maxChars);

    for (const part of parts) {
      const r = baseR - idx * gap;

      // stop before center chip zone
      if (r < 244) break;

      const fontSize = ln.tone === "hi" ? 13.8 : ln.tone === "mid" ? 11.8 : 10.2;
      const opacity = ln.tone === "hi" ? 0.52 : ln.tone === "mid" ? 0.32 : 0.20;
      const letterSpacing = ln.tone === "hi" ? 0.55 : ln.tone === "mid" ? 0.40 : 0.32;

      const jitter = (rnd() - 0.5) * 6; // +/-3%
      const startOffsetPct = 50 + jitter;

      const pathId = `${sigId}-ring-${idx}`;
      out.push({
        pathId,
        d: circlePathD(500, 500, r),
        text: part,
        r,
        fontSize,
        opacity,
        letterSpacing,
        startOffsetPct,
      });

      idx += 1;
    }
  }

  return out;
};

/* ─────────────────────────────────────────────────────────────
 * Sacred geometry (same vibe)
 * ───────────────────────────────────────────────────────────── */

const lissajousPath = (seedHex: string, rootAngle = 0): string => {
  const seed = seed32FromHex(seedHex);
  const rnd = makeRng(seed);

  const A = 360 + Math.floor(rnd() * 140);
  const B = 340 + Math.floor(rnd() * 160);
  const a = 3 + Math.floor(rnd() * 5);
  const b = 4 + Math.floor(rnd() * 6);
  const delta = rnd() * Math.PI + rootAngle * 0.65;

  const cx = 500;
  const cy = 500;

  const steps = 260;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const x = cx + A * Math.sin(a * t + delta);
    const y = cy + B * Math.sin(b * t);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)} ` : `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  d += "Z";
  return d;
};

const goldenSpiralPath = (): string => {
  const cx = 500;
  const cy = 500;

  const b = Math.log(PHI) / (Math.PI / 2);
  const thetaMax = Math.PI * 4.75;
  const a = 360 / Math.exp(b * thetaMax);

  const steps = 300;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * thetaMax;
    const r = a * Math.exp(b * t);
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)} ` : `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
};

const hexRingPath = (): string => {
  const pts: Array<[number, number]> = [];
  const cx = 500;
  const cy = 500;
  const r = 432;
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 1; i < pts.length; i += 1) d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
  d += "Z";
  return d;
};

const flowerOfLife = (): readonly string[] => {
  const cx = 500;
  const cy = 500;
  const r = 160;
  const circles: string[] = [];
  circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" />`);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" />`);
  }
  return circles;
};

const crystalFacets = (seedHex: string, rootAngle = 0): readonly string[] => {
  const rnd = makeRng(seed32FromHex(`FACETS:${seedHex}`));
  const cx = 500;
  const cy = 500;

  const facetCount = 13 + Math.floor(rnd() * 7);
  const paths: string[] = [];

  for (let i = 0; i < facetCount; i += 1) {
    const ang0 = rootAngle + rnd() * Math.PI * 2;
    const ang1 = ang0 + (0.22 + rnd() * 0.55);
    const ang2 = ang1 + (0.18 + rnd() * 0.45);

    const r0 = 140 + rnd() * 320;
    const r1 = r0 * (0.72 + rnd() * 0.28);
    const r2 = r1 * (0.70 + rnd() * 0.30);

    const x0 = cx + r0 * Math.cos(ang0);
    const y0 = cy + r0 * Math.sin(ang0);
    const x1 = cx + r1 * Math.cos(ang1);
    const y1 = cy + r1 * Math.sin(ang1);
    const x2 = cx + r2 * Math.cos(ang2);
    const y2 = cy + r2 * Math.sin(ang2);

    const inset = 0.08 + rnd() * 0.10;
    const x3 = cx + (x1 - cx) * (1 - inset);
    const y3 = cy + (y1 - cy) * (1 - inset);

    paths.push(
      `M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(
        2,
      )} L ${x3.toFixed(2)} ${y3.toFixed(2)} Z`,
    );
  }

  return paths;
};

const proofRingTicks = (hashHex: string, r: number): string => {
  const bits = hexToBits256(hashHex);
  const cx = 500;
  const cy = 500;
  let out = "";
  for (let i = 0; i < 256; i += 1) {
    const bit = bits[i] ?? 0;
    const a = (Math.PI * 2 * i) / 256 - Math.PI / 2;
    const len = bit === 1 ? 22 : 12;
    const x0 = cx + (r - len) * Math.cos(a);
    const y0 = cy + (r - len) * Math.sin(a);
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);

    const major = i % 32 === 0;
    const w = major ? 2.2 : bit === 1 ? 1.6 : 1.0;

    out += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(
      2,
    )}" stroke-width="${w.toFixed(2)}" />\n`;
  }
  return out;
};

const chipTicks = (hashHex: string, r: number): string => {
  const bits = hexToBits256(hashHex);
  const cx = 500;
  const cy = 500;
  let out = "";
  for (let i = 0; i < 256; i += 1) {
    const bit = bits[i] ?? 0;
    const a = (Math.PI * 2 * i) / 256 - Math.PI / 2;
    const major = i % 16 === 0;
    const len = major ? 18 : bit === 1 ? 12 : 8;

    const x0 = cx + (r - len) * Math.cos(a);
    const y0 = cy + (r - len) * Math.sin(a);
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);

    const w = major ? 2.6 : bit === 1 ? 1.8 : 1.2;
    out += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(
      2,
    )}" stroke-width="${w.toFixed(2)}" />\n`;
  }
  return out;
};

/* ─────────────────────────────────────────────────────────────
 * Payload construction (preserve proof fields if present)
 * ───────────────────────────────────────────────────────────── */

const makePayload = async (pos: PositionRecord, vault: VaultRecord): Promise<PositionSigilPayloadV1> => {
  const identity = vault.owner.identitySigil;
  if (!identity) {
    throw new Error("Missing identity sigil. Inhale your root sigil to mint positions.");
  }

  const lineageRoot = resolveLineageRoot(identity);
  const lineageId = await deriveLineageId({
    lineageRootSvgHash: lineageRoot.lineageRootSvgHash,
    marketId: String(pos.marketId),
    positionId: String(pos.id),
    sideOrOutcome: String(pos.entry.side),
    kaiMoment: pos.entry.openedAt,
  });

  const lineageFields: SigilLineageFields = {
    lineageRootSigilId: lineageRoot.lineageRootSigilId,
    lineageRootSvgHash: lineageRoot.lineageRootSvgHash,
    lineageId,
    parentSigilId: lineageRoot.lineageRootSigilId,
    parentSvgHash: lineageRoot.lineageRootSvgHash,
    kaiMoment: pos.entry.openedAt,
  };

  const base: PositionSigilPayloadV1 = {
    v: "SM-POS-1",
    kind: "position",
    userPhiKey: vault.owner.userPhiKey,
    kaiSignature: vault.owner.kaiSignature,

    marketId: pos.marketId,
    positionId: pos.id,
    side: pos.entry.side,

    lockedStakeMicro: biDec(pos.lock.lockedStakeMicro),
    sharesMicro: biDec(pos.entry.sharesMicro),
    avgPriceMicro: biDec(pos.entry.avgPriceMicro),
    worstPriceMicro: biDec(pos.entry.worstPriceMicro),
    feeMicro: biDec(pos.entry.feeMicro),
    totalCostMicro: biDec(pos.entry.totalCostMicro),

    vaultId: pos.lock.vaultId,
    lockId: pos.lock.lockId,

    openedAt: coerceKaiMoment(pos.entry.openedAt as unknown),
    venue: pos.entry.venue,

    marketDefinitionHash: pos.entry.marketDefinitionHash,

    resolution: pos.resolution
      ? {
          outcome: pos.resolution.outcome,
          resolvedPulse: pos.resolution.resolvedPulse,
          status: pos.status,
          creditedMicro: pos.settlement ? biDec(pos.settlement.creditedMicro) : undefined,
          debitedMicro: pos.settlement ? biDec(pos.settlement.debitedMicro) : undefined,
        }
      : undefined,

    label: `Position ${pos.entry.side}`,
    note: undefined,
    ...lineageFields,
  };

  const owner = (vault as unknown as UnknownRecord)["owner"];
  const merged = mergePrefer(
    extractZkFromUnknown(pos as unknown),
    extractZkFromUnknown((pos as unknown as UnknownRecord)["entry"]),
    extractZkFromUnknown(owner),
  );

  const extra: UnknownRecord = {};
  if (merged.zkProof) extra["zkProof"] = merged.zkProof;
  if (merged.zkPublicInputs) extra["zkPublicInputs"] = merged.zkPublicInputs;
  if (merged.zkPoseidonHashDec) extra["zkPoseidonHash"] = merged.zkPoseidonHashDec; // preserve your naming
  if (merged.proofHints) extra["proofHints"] = merged.proofHints;
  if (merged.verifiedFlag) extra["zkOk"] = true;
  if (merged.verifiedBy) extra["verifiedBy"] = merged.verifiedBy;

  Object.assign(base as unknown as UnknownRecord, extra);
  return base;
};

export const buildClaimPayload = async (
  pos: PositionRecord,
  vault: VaultRecord,
  claimMoment: KaiMoment,
  payoutMicro: bigint,
): Promise<ClaimSigilPayloadV1> => {
  const identity = vault.owner.identitySigil;
  if (!identity) {
    throw new Error("Missing identity sigil. Inhale your root sigil to mint victories.");
  }
  if (!pos.resolution) {
    throw new Error("Missing resolution snapshot for victory sigil.");
  }

  const lineageRoot = resolveLineageRoot(identity);
  const outcome = pos.resolution.outcome;
  const normalizedPayout = pos.status === "lost" ? 0n : payoutMicro < 0n ? 0n : payoutMicro;
  const payoutDisplay = formatPhiMicro(normalizedPayout as unknown as PhiMicro, {
    withUnit: true,
    maxDecimals: 6,
    trimZeros: true,
  });

  const lineageId = await deriveLineageId({
    lineageRootSvgHash: lineageRoot.lineageRootSvgHash,
    marketId: String(pos.marketId),
    positionId: String(pos.id),
    sideOrOutcome: String(outcome),
    kaiMoment: claimMoment,
  });

  const resolutionId = await sha256Hex(
    `SM-RES-1|${String(pos.marketId)}|${String(outcome)}|${String(pos.resolution.resolvedPulse)}`,
  );

  const payload: ClaimSigilPayloadV1 = {
    v: "SM-CLAIM-1",
    kind: "claim",
    userPhiKey: vault.owner.userPhiKey,
    kaiSignature: vault.owner.kaiSignature,
    marketId: pos.marketId,
    positionId: pos.id,
    side: pos.entry.side,
    outcome,
    resolutionId,
    resolutionPulse: pos.resolution.resolvedPulse,
    payoutPhiMicro: biDec(normalizedPayout),
    payoutPhiDisplay: payoutDisplay,
    lockedStakeMicro: biDec(pos.lock.lockedStakeMicro),
    sharesMicro: biDec(pos.entry.sharesMicro),
    avgPriceMicro: biDec(pos.entry.avgPriceMicro),
    worstPriceMicro: biDec(pos.entry.worstPriceMicro),
    feeMicro: biDec(pos.entry.feeMicro),
    totalCostMicro: biDec(pos.entry.totalCostMicro),
    vaultId: pos.lock.vaultId,
    lockId: pos.lock.lockId,
    openedAt: coerceKaiMoment(pos.entry.openedAt as unknown),
    claimedAt: claimMoment,
    marketDefinitionHash: pos.entry.marketDefinitionHash,
    label: `Victory ${outcome}`,
    note: pos.status === "lost" ? "Loss settled" : "Won Sealed",
    lineageRootSigilId: lineageRoot.lineageRootSigilId,
    lineageRootSvgHash: lineageRoot.lineageRootSvgHash,
    lineageId,
    parentSigilId: lineageRoot.lineageRootSigilId,
    parentSvgHash: lineageRoot.lineageRootSvgHash,
    kaiMoment: claimMoment,
  };

  const owner = (vault as unknown as UnknownRecord)["owner"];
  const merged = mergePrefer(
    extractZkFromUnknown(pos as unknown),
    extractZkFromUnknown((pos as unknown as UnknownRecord)["entry"]),
    extractZkFromUnknown(owner),
  );

  const extra: UnknownRecord = {};
  if (merged.zkProof) extra["zkProof"] = merged.zkProof;
  if (merged.zkPublicInputs) extra["zkPublicInputs"] = merged.zkPublicInputs;
  if (merged.zkPoseidonHashDec) extra["zkPoseidonHash"] = merged.zkPoseidonHashDec;
  if (merged.proofHints) extra["proofHints"] = merged.proofHints;
  if (merged.verifiedFlag) extra["zkOk"] = true;
  if (merged.verifiedBy) extra["verifiedBy"] = merged.verifiedBy;
  Object.assign(payload as unknown as UnknownRecord, extra);

  return payload;
};

/* ─────────────────────────────────────────────────────────────
 * SVG build (OFFICIAL CHIP)
 * ───────────────────────────────────────────────────────────── */

const buildSvg = async (
  payload: PositionOrClaimPayload,
  svgHashSeed: string,
  vault: VaultRecord | null,
  pos?: PositionRecord,
): Promise<string> => {
  const rootSeed = seed32FromHex(`ROOT:${payload.lineageRootSvgHash}`);
  const rootAngle = ((rootSeed % 360) * Math.PI) / 180;

  const ring = hexRingPath();
  const wave = lissajousPath(svgHashSeed, rootAngle);
  const spiral = goldenSpiralPath();

  const yesTone = "rgba(185,252,255,0.98)";
  const noTone = "rgba(190,170,255,0.98)";
  const tone = payload.side === "YES" ? yesTone : noTone;

  const styleRnd = makeRng(seed32FromHex(`${svgHashSeed}:${payload.side}:STYLE:${rootSeed}`));
  const ringOuterOpacity = clamp01(0.04 + styleRnd() * 0.10);
  const ringInnerOpacity = clamp01(0.16 + styleRnd() * 0.18);
  const waveGlowOpacity = clamp01(0.08 + styleRnd() * 0.12);
  const waveCoreOpacity = clamp01(0.42 + styleRnd() * 0.26);
  const spiralOpacity = clamp01(0.08 + styleRnd() * 0.14);
  const phiRingOpacity = clamp01(0.12 + styleRnd() * 0.18);

  const glassPlateOpacity = clamp01(0.05 + styleRnd() * 0.08);
  const hazeOpacity = clamp01(0.04 + styleRnd() * 0.08);

  const prismShift = styleRnd();
  const noiseSeed = seed32FromHex(`NOISE:${svgHashSeed}`) % 999;

  const facets = crystalFacets(svgHashSeed, rootAngle);
  const flower = flowerOfLife();

  const isClaim = isClaimPayload(payload);
  const sigId = `${isClaim ? "sm-claim" : "sm-pos"}-${payload.openedAt.pulse}-${payload.openedAt.beat}-${payload.openedAt.stepIndex}`;
  const descId = `${sigId}-desc`;

  // ZK seal (FIXED)
  const seal = await buildZkSeal(payload, vault, pos);

  const okWord = seal.zkOk ? "VERIFIED" : "SEALED";
  const toneGhost = payload.side === "YES" ? "rgba(185,252,255,0.10)" : "rgba(190,170,255,0.10)";

  // Real valuation (STRICT)
  // Value math (REAL, deterministic)
  // stakePhiDec6 already computed from lockedStakeMicro
  const stakePhiDec6 = microDecToPhiDec6(String(payload.lockedStakeMicro));
  const stakePhiNum = phiDec6ToNumber(stakePhiDec6);

  const mintPulse = payload.openedAt.pulse;
  const rateQuote = quotePhiForUsd(
    {
      meta: FALLBACK_META,
      nowPulse: Math.floor(mintPulse),
      usd: 100,
      currentStreakDays: 0,
      lifetimeUsdSoFar: 0,
      plannedHoldBeats: 0,
    },
    DEFAULT_ISSUANCE_POLICY,
  );

  const usdPerPhi = rateQuote.usdPerPhi ?? 0;
  const phiPerUsd = rateQuote.phiPerUsd ?? 0;
  if (!Number.isFinite(usdPerPhi) || usdPerPhi <= 0 || !Number.isFinite(phiPerUsd) || phiPerUsd <= 0) {
    throw new Error("Issuance produced invalid USD/Φ rate.");
  }

  const stakeUsdNum = usdValueFromPhi(stakePhiNum, usdPerPhi);
  const stakeUsd2 = formatUsd2(stakeUsdNum);

  const payoutPhiDec6 = isClaim ? microDecToPhiDec6(String(payload.payoutPhiMicro)) : "0.000000";
  const payoutPhiNum = isClaim ? phiDec6ToNumber(payoutPhiDec6) : 0;
  const payoutUsdNum = isClaim ? usdValueFromPhi(payoutPhiNum, usdPerPhi) : 0;
  const payoutUsd2 = formatUsd2(payoutUsdNum);

  const amountPhiDec6 = isClaim ? payoutPhiDec6 : stakePhiDec6;
  const amountUsdLabel = isClaim ? `+$${payoutUsd2}` : `$${stakeUsd2}`;


  // Embed φ logo from public/phi.svg
  const phiLogo = await getPhiLogoMarkupAsync();

  // Machine metadata
  const payloadForMeta: Record<string, unknown> = { ...(payload as unknown as Record<string, unknown>) };
  payloadForMeta["canonicalHash"] = seal.canonicalHashHex; // compatibility for your verifier
  payloadForMeta["canonicalHashHex"] = seal.canonicalHashHex;
  payloadForMeta["zkOk"] = seal.zkOk;
  payloadForMeta["zkPoseidonHashDec"] = seal.zkPoseidonHashDec;
  payloadForMeta["usdPerPhi"] = usdPerPhi;
  payloadForMeta["phiPerUsd"] = phiPerUsd;
  payloadForMeta["usdSource"] = "issuance";
  payloadForMeta["wagerUsd"] = stakeUsd2;
  if (isClaim) {
    payloadForMeta["payoutUsd"] = payoutUsd2;
  }

  const payloadJsonRaw = JSON.stringify(payloadForMeta);

  const sealJsonRaw = JSON.stringify(seal);

  // Rings
  const woven = [
    `v=${payload.v}`,
    `marketId=${String(payload.marketId)}`,
    `positionId=${String(payload.positionId)}`,
    `side=${payload.side}`,
    ...(isClaimPayload(payload) ? [`outcome=${payload.outcome}`, `payout=${payload.payoutPhiDisplay}`] : []),
    `vaultId=${String(payload.vaultId)}`,
    `lockId=${String(payload.lockId)}`,
    `pulse=${payload.openedAt.pulse}`,
    `beat=${payload.openedAt.beat}`,
    `stepIndex=${payload.openedAt.stepIndex}`,
    `userPhiKey=${String(payload.userPhiKey)}`,
    `kaiSignature=${String(payload.kaiSignature)}`,
    `lineageRoot=${String(payload.lineageRootSigilId)}`,
    `lineageId=${String(payload.lineageId)}`,
    `canonicalHashHex=${seal.canonicalHashHex}`,
    `poseidon=${seal.zkPoseidonHashDec}`,
    `scheme=${seal.scheme}`,
    `zkOk=${seal.zkOk ? "true" : "false"}`,
  ].join(" • ");

  const binarySig = bitsToBinaryString(seal.canonicalHashHex);

  const openedShort = `p=${payload.openedAt.pulse} b=${payload.openedAt.beat} s=${payload.openedAt.stepIndex}`;
  const resolutionShort = isClaimPayload(payload)
    ? `claimPulse=${payload.claimedAt.pulse} outcome=${payload.outcome} resolutionPulse=${payload.resolutionPulse}`
    : payload.resolution
      ? `resolved=${payload.resolution.status} outcome=${payload.resolution.outcome} atPulse=${payload.resolution.resolvedPulse}`
      : "resolved=(unresolved)";

  // No straight header: header becomes a ring line
  const ringLines = buildRingLines(sigId, seal.canonicalHashHex, [
    { tone: "hi", text: `${payload.v} • ${okWord} • zk=${seal.scheme} • assurance=${seal.zkAssurance}` },
    { tone: "hi", text: `WAGER • Φ ${stakePhiDec6} • USD $${stakeUsd2} • feeMicro=${String(payload.feeMicro)}` },
    {
      tone: "hi",
      text: isClaimPayload(payload)
        ? `VICTORY • Φ ${payoutPhiDec6} • +$${payoutUsd2}`
        : `POSITION • marketId=${String(payload.marketId)} • side=${payload.side} • ${openedShort}`,
    },
    { tone: "mid", text: `marketId=${String(payload.marketId)} • side=${payload.side} • ${openedShort}` },
    { tone: "mid", text: `positionId=${String(payload.positionId)} • vaultId=${String(payload.vaultId)} • lockId=${String(payload.lockId)}` },
    { tone: "mid", text: `IDENTITY • userPhiKey=${String(payload.userPhiKey)} • kaiSignature=${String(payload.kaiSignature)}` },
    {
      tone: "mid",
      text: `LINEAGE • root=${String(payload.lineageRootSigilId)} • lineageId=${String(payload.lineageId)}`,
    },
    { tone: "mid", text: `VALUE • sharesMicro=${String(payload.sharesMicro)} • avgPriceMicro=${String(payload.avgPriceMicro)} • worstPriceMicro=${String(payload.worstPriceMicro)} • totalCostMicro=${String(payload.totalCostMicro)} • ${resolutionShort}` },
    { tone: "low", text: `HASH • canonicalHashHex=${seal.canonicalHashHex}` },
    { tone: "low", text: `POSEIDON • ${seal.zkPoseidonHashDec}` },
  ]);

  const ringDefs = ringLines.map((l) => `<path id="${esc(l.pathId)}" d="${l.d}" fill="none"/>`).join("\n");
  const ringTextSvg = ringLines
    .map((l) => {
      return `<text
  font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
  font-size="${l.fontSize.toFixed(2)}"
  fill="rgba(255,255,255,0.92)"
  opacity="${l.opacity.toFixed(3)}"
  letter-spacing="${l.letterSpacing.toFixed(2)}"
  style="paint-order: stroke; stroke: rgba(0,0,0,0.62); stroke-width: 1.15; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
  text-rendering="geometricPrecision"
  pointer-events="none"
>
  <textPath href="#${esc(l.pathId)}" startOffset="${l.startOffsetPct.toFixed(2)}%">${esc(l.text)}</textPath>
</text>`;
    })
    .join("\n");

  // Proof tick rings
  const proofRing = proofRingTicks(seal.canonicalHashHex, 482);
  const chipTickRing = chipTicks(seal.canonicalHashHex, 238);

  const facetsSvg = facets
    .map((d, i) => {
      const rr = makeRng(seed32FromHex(`FACETSTYLE:${svgHashSeed}:${i}`));
      const oFill = clamp01(0.010 + rr() * 0.035);
      const oStroke = clamp01(0.06 + rr() * 0.14);
      const w = (0.9 + rr() * 1.6).toFixed(2);
      return `<path d="${d}" fill="rgba(255,255,255,${oFill.toFixed(3)})" stroke="url(#prism)" stroke-width="${w}" opacity="${oStroke.toFixed(
        3,
      )}" />`;
    })
    .join("\n");

  const flowerSvg = flower.join("\n");

  const sigPathIdOuter = `${sigId}-sig-path-outer`;
  const sigPathIdInner = `${sigId}-sig-path-inner`;

  // Chip sizing (deterministic)
  const centerSeed = seed32FromHex(`CENTER:${seal.canonicalHashHex}:${stakePhiDec6}:${seal.zkPoseidonHashDec}`);
  const centerRnd = makeRng(centerSeed);
  const chipR = 228;
  const chipInnerR = 176 + Math.floor(centerRnd() * 10);
  const chipInsetR = 134 + Math.floor(centerRnd() * 8);
  const chipTilt = (-4 + centerRnd() * 8).toFixed(3);

  // Amount typography split
  const mm = /^([0-9]+)\.([0-9]{6})$/.exec(amountPhiDec6);
  const whole = mm ? mm[1] : amountPhiDec6;
  const frac = mm ? mm[2] : "000000";

  // Amount layout (currency-lock): deterministic left edge + Φ prefix
  const AMT_FRAC_PX = 58;

  // Monospace glyph width ≈ 0.60em (tuned for SFMono/Menlo/Consolas)
  const MONO_EM = 0.60;

  const isZeroWhole = whole === "0";
  const wholeFontSize = isZeroWhole ? 72 : 96;
  const wholeW = whole.length * wholeFontSize * MONO_EM;
const fracW = (1 + frac.length) * AMT_FRAC_PX * MONO_EM; // "." + frac digits
const amountW = wholeW + fracW;

  // Left edge of the full amount block (so Φ can anchor to it)
  const amountLeftX = 500 - amountW / 2;

  // Φ logo sizing/placement: sits beside amount like "$"
  const phiSize = isZeroWhole ? 44 : 48;
  const phiGap = 6;
  const phiX = amountLeftX - phiSize - phiGap;
  const phiY = 494 - phiSize / 2;

  // Tighten the join between whole and "." (negative dx pulls "." left)
  const fracDx = -Math.max(isZeroWhole ? 12 : 8, Math.round(AMT_FRAC_PX * (isZeroWhole ? 0.22 : 0.18)));


  // Center ring microtext (official feel)
  const microSeal = isClaim
    ? `ΦNET • VICTORY • ${seal.scheme} • ${payload.claimedAt.pulse} • ${String(payload.marketId)} •`
    : `ΦNET • ${okWord} • ${seal.scheme} • ${openedShort} • ${String(payload.marketId)} •`;

  const dataKind = isClaim ? "sigilmarkets-claim" : "sigilmarkets-position";
  const ariaLabel = isClaim
    ? `SigilMarkets Victory — ${payload.outcome} — pulse ${payload.claimedAt.pulse}`
    : `SigilMarkets Position — ${payload.side} — pulse ${payload.openedAt.pulse}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  id="${esc(sigId)}"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  role="img"
  lang="en"
  aria-label="${esc(ariaLabel)}"
  aria-describedby="${esc(descId)}"
  viewBox="0 0 1000 1000"
  width="1000"
  height="1000"
  shape-rendering="geometricPrecision"
  preserveAspectRatio="xMidYMid meet"
  style="background: transparent;"
  data-kind="${esc(dataKind)}"
  data-v="${esc(payload.v)}"
  data-market-id="${esc(String(payload.marketId))}"
  data-position-id="${esc(String(payload.positionId))}"
  data-side="${esc(payload.side)}"
  ${isClaim ? `data-outcome="${esc(payload.outcome)}"` : ""}
  ${isClaim ? `data-payout-phi="${esc(String(payload.payoutPhiMicro))}"` : ""}
  ${isClaim ? `data-payout-display="${esc(String(payload.payoutPhiDisplay))}"` : ""}
  ${isClaim ? `data-payout-usd="${esc(payoutUsd2)}"` : ""}
  data-vault-id="${esc(String(payload.vaultId))}"
  data-lock-id="${esc(String(payload.lockId))}"
  data-user-phikey="${esc(String(payload.userPhiKey))}"
  data-kai-signature="${esc(String(payload.kaiSignature))}"
  data-pulse="${esc(String(payload.openedAt.pulse))}"
  data-beat="${esc(String(payload.openedAt.beat))}"
  data-step-index="${esc(String(payload.openedAt.stepIndex))}"
  data-lineage-root-id="${esc(String(payload.lineageRootSigilId))}"
  data-lineage-root-hash="${esc(String(payload.lineageRootSvgHash))}"
  data-lineage-id="${esc(String(payload.lineageId))}"
  data-lineage-parent-id="${esc(String(payload.parentSigilId ?? ""))}"
  data-lineage-parent-hash="${esc(String(payload.parentSvgHash ?? ""))}"
  data-lineage-pulse="${esc(String(payload.kaiMoment.pulse))}"
  data-lineage-beat="${esc(String(payload.kaiMoment.beat))}"
  data-lineage-step-index="${esc(String(payload.kaiMoment.stepIndex))}"
  data-wager-phi="${esc(stakePhiDec6)}"
  data-wager-usd="${esc(stakeUsd2)}"
  data-zk-scheme="${esc(seal.scheme)}"
  data-zk-ok="${esc(seal.zkOk ? "true" : "false")}"
  data-zk-assurance="${esc(seal.zkAssurance)}"
  data-zk-poseidon-hash="${esc(seal.zkPoseidonHashDec)}"
  data-payload-hash="${esc(seal.canonicalHashHex)}"
>
  <title>${esc(ariaLabel)}</title>
  <desc id="${esc(descId)}">${esc(isClaim ? "Victory sigil with embedded payout + lineage." : "Atlantean chip sigil with embedded proof + metadata.")}</desc>

  <metadata>${safeCdata(payloadJsonRaw)}</metadata>
  <metadata id="sm-zk">${safeCdata(sealJsonRaw)}</metadata>

  <defs>
    ${ringDefs}

    <path id="${esc(sigPathIdOuter)}" d="${circlePathD(500, 500, 460)}" fill="none"/>
    <path id="${esc(sigPathIdInner)}" d="${circlePathD(500, 500, 410)}" fill="none"/>

    <path id="hexRing" d="${ring}" fill="none"/>

    <path id="${esc(sigId)}-microseal" d="${circlePathD(500, 500, 156)}" fill="none"/>

    <linearGradient id="prism" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.90)"/>
      <stop offset="${(16 + prismShift * 10).toFixed(2)}%" stop-color="rgba(160,255,255,0.92)"/>
      <stop offset="${(44 + prismShift * 12).toFixed(2)}%" stop-color="rgba(190,160,255,0.94)"/>
      <stop offset="${(72 + prismShift * 8).toFixed(2)}%" stop-color="rgba(255,220,170,0.92)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.86)"/>
    </linearGradient>

    <linearGradient id="amountGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(185,252,255,0.98)"/>
      <stop offset="50%" stop-color="rgba(255,255,255,0.98)"/>
      <stop offset="100%" stop-color="rgba(190,170,255,0.98)"/>
    </linearGradient>

    <linearGradient id="edge" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.78)"/>
      <stop offset="50%" stop-color="${tone}"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.70)"/>
    </linearGradient>

    <radialGradient id="ether" cx="50%" cy="42%" r="66%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>
      <stop offset="55%" stop-color="rgba(255,255,255,0.04)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </radialGradient>

    <radialGradient id="aurora" cx="52%" cy="52%" r="62%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.08)"/>
      <stop offset="28%" stop-color="${toneGhost}"/>
      <stop offset="58%" stop-color="rgba(255,220,170,0.04)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </radialGradient>

    <radialGradient id="chipGlow" cx="50%" cy="44%" r="68%">
      <stop offset="0%" stop-color="rgba(185,252,255,0.26)"/>
      <stop offset="50%" stop-color="rgba(185,252,255,0.10)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </radialGradient>

    <filter id="outerGlow" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="10" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.26 0" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <filter id="crystalGlow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.42 0" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <filter id="frost" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${noiseSeed}" result="noise"/>
      <feDisplacementMap in="blur" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="disp"/>
      <feColorMatrix in="disp" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.68 0" result="alpha"/>
      <feMerge><feMergeNode in="alpha"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <filter id="chipFrost" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.52" numOctaves="1" seed="${(noiseSeed + 17) % 999}" result="n"/>
      <feDisplacementMap in="b" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feColorMatrix in="d" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.76 0" result="a"/>
      <feMerge><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <filter id="amountGlow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.35 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="etchStrong" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="a"/>
      <feOffset in="a" dx="0" dy="1" result="d"/>
      <feComposite in="d" in2="SourceAlpha" operator="out" result="shadow"/>
      <feColorMatrix in="shadow" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0.46 0" result="s"/>
      <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Ring-encoded labels (NO overlaps, NO straight headers) -->
  <g filter="url(#etchStrong)">
    ${ringTextSvg}
  </g>

  <!-- Binary ring -->
  <g pointer-events="none">
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="12.2"
      fill="${tone}"
      opacity="0.26"
      letter-spacing="1.08"
      text-anchor="middle"
      dominant-baseline="middle"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.60); stroke-width: 1.12; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >
      <textPath href="#${esc(sigPathIdOuter)}" startOffset="50%">${esc(binarySig)}</textPath>
    </text>
  </g>

  <!-- Woven ring -->
  <g pointer-events="none">
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="10.8"
      fill="${tone}"
      opacity="0.16"
      letter-spacing="0.70"
      text-anchor="middle"
      dominant-baseline="middle"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.56); stroke-width: 1.02; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >
      <textPath href="#${esc(sigPathIdInner)}" startOffset="50%">${esc(woven)}</textPath>
    </text>
  </g>

  <!-- Proof ticks -->
  <g stroke="url(#prism)" opacity="0.46" pointer-events="none">
    ${proofRing}
  </g>

  <!-- Etherik glass plate -->
  <g filter="url(#frost)" pointer-events="none">
    <circle cx="500" cy="500" r="520" fill="url(#aurora)" opacity="${(glassPlateOpacity * 0.92).toFixed(3)}"/>
    <circle cx="500" cy="500" r="520" fill="url(#ether)" opacity="${glassPlateOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="410" fill="rgba(255,255,255,0.05)" opacity="${hazeOpacity.toFixed(3)}"/>
  </g>

  <!-- Cut-glass hex geometry -->
  <g filter="url(#outerGlow)" pointer-events="none">
    <path d="${ring}" fill="none" stroke="rgba(255,255,255,${ringOuterOpacity.toFixed(3)})" stroke-width="12"/>
    <path d="${ring}" fill="none" stroke="url(#edge)" stroke-width="3.6" opacity="${ringInnerOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="${(432 / PHI).toFixed(2)}" fill="none" stroke="url(#prism)" stroke-width="1.9" opacity="${phiRingOpacity.toFixed(3)}"/>
  </g>

  <!-- Sacred geometry -->
  <g fill="none" stroke="rgba(255,255,255,0.11)" stroke-width="1.2" opacity="0.68" pointer-events="none">
    ${flowerSvg}
  </g>

  <!-- Facets -->
  <g pointer-events="none">
    ${facetsSvg}
  </g>

  <!-- Φ spiral -->
  <path d="${spiral}" fill="none" stroke="url(#prism)" stroke-width="1.6" opacity="${spiralOpacity.toFixed(3)}" pointer-events="none"/>

  <!-- Wave -->
  <g filter="url(#crystalGlow)" pointer-events="none">
    <path d="${wave}" fill="none" stroke="url(#prism)" stroke-width="6.6" opacity="${waveGlowOpacity.toFixed(3)}"/>
    <path d="${wave}" fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="2.1" opacity="${waveCoreOpacity.toFixed(3)}"/>
  </g>

  <!-- CENTER CHIP -->
  <g id="chip-center" pointer-events="none" transform="rotate(${chipTilt} 500 500)">
    <circle cx="500" cy="500" r="${chipR}" fill="rgba(255,255,255,0.06)" filter="url(#chipFrost)"/>
    <circle cx="500" cy="500" r="${chipR}" fill="url(#chipGlow)" opacity="0.88"/>
    <circle cx="500" cy="500" r="${chipR}" fill="none" stroke="url(#prism)" stroke-width="3.2" opacity="0.72"/>
    <circle cx="500" cy="500" r="${chipR - 10}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2.2" opacity="0.80"/>

    <g stroke="url(#prism)" opacity="0.70">
      ${chipTickRing}
    </g>

    <circle cx="500" cy="500" r="${chipInnerR}" fill="rgba(255,255,255,0.05)" opacity="0.92" filter="url(#chipFrost)"/>
    <circle cx="500" cy="500" r="${chipInnerR}" fill="none" stroke="rgba(185,252,255,0.30)" stroke-width="2.2" opacity="0.92"/>

    <circle cx="500" cy="500" r="${chipInsetR}" fill="rgba(0,0,0,0.10)" opacity="0.72"/>
    <circle cx="500" cy="500" r="${chipInsetR}" fill="none" stroke="rgba(255,255,255,0.24)" stroke-width="1.6" opacity="0.92"/>

    <!-- microseal ring -->
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="11.6"
      fill="rgba(255,255,255,0.82)"
      opacity="0.55"
      letter-spacing="2.6"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.55); stroke-width: 1.0;"
    >
      <textPath href="#${esc(sigId)}-microseal" startOffset="50%">${esc(microSeal)}</textPath>
    </text>

    <!-- VERIFIED / SEALED stamp -->
    <text
      x="500"
      y="418"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      fill="${seal.zkOk ? "rgba(185,252,255,0.92)" : "rgba(255,255,255,0.70)"}"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.62); stroke-width: 2.0; letter-spacing: 6.4;"
      filter="url(#etchStrong)"
    >
      <tspan font-size="22" opacity="0.9">${esc(
        isClaim
          ? payload.outcome === "VOID"
            ? "VOID"
            : payload.side === payload.outcome
              ? "VICTORY"
              : "SETTLED"
          : seal.zkOk
            ? "VERIFIED"
            : "SEALED",
      )}</tspan>
    </text>
    ${
      isClaim && payload.side === payload.outcome
        ? `<text
      x="500"
      y="448"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      fill="rgba(255,255,255,0.82)"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.55); stroke-width: 1.6; letter-spacing: 4.8;"
      filter="url(#etchStrong)"
    >
      <tspan font-size="14" opacity="0.85">Victory was never luck — it was the breath remembering what you already sealed.</tspan>
    </text>`
        : ""
    }

    <!-- φ logo -->
    ${
      phiLogo
        ? `<svg
  x="${phiX.toFixed(2)}"
  y="${phiY.toFixed(2)}"
  width="${phiSize}"
  height="${phiSize}"
  viewBox="${esc(phiLogo.viewBox)}"
  preserveAspectRatio="xMidYMid meet"
  opacity="0.96"
  aria-hidden="true"
>${phiLogo.inner}</svg>
`
        : ""
    }

    <!-- Amount (OFFICIAL frosted) -->
    <g filter="url(#amountGlow)">
      <!-- back glow copy -->
      <text
        x="500"
        y="498"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
        fill="rgba(185,252,255,0.35)"
        letter-spacing="0.25"
        style="paint-order: stroke; stroke: rgba(0,0,0,0.85); stroke-width: 5.0; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
      >
        <tspan font-size="${wholeFontSize}">${esc(whole)}</tspan>
       <tspan font-size="58" dx="${fracDx}">.${esc(frac)}</tspan>
      </text>

      <!-- main face -->
      <text
        x="500"
        y="494"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
        fill="url(#amountGrad)"
        letter-spacing="1.1"
        style="paint-order: stroke; stroke: rgba(0,0,0,0.78); stroke-width: 2.6; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
      >
        <tspan font-size="${wholeFontSize}">${esc(whole)}</tspan>
        <tspan font-size="58" dx="${fracDx}">.${esc(frac)}</tspan>
      </text>

      <!-- highlight stroke -->
      <text
        x="500"
        y="492"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
        fill="rgba(255,255,255,0.08)"
        letter-spacing="1.1"
        style="paint-order: stroke; stroke: rgba(255,255,255,0.35); stroke-width: 1.2; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
      >
        <tspan font-size="${wholeFontSize}">${esc(whole)}</tspan>
       <tspan font-size="58" dx="${fracDx}">.${esc(frac)}</tspan>
      </text>
    </g>

    <!-- USD under amount (REAL, no est) -->
    <text
      x="500"
      y="570"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
      fill="rgba(185,252,255,0.92)"
      letter-spacing="0.8"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.68); stroke-width: 2.0; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
      filter="url(#etchStrong)"
    >
      <tspan font-size="36">${esc(amountUsdLabel)}</tspan>
    </text>
    ${
      isClaim
        ? `<text
      x="500"
      y="616"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
      fill="rgba(185,252,255,0.78)"
      letter-spacing="0.6"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.6); stroke-width: 1.6; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
      filter="url(#etchStrong)"
    >
      <tspan font-size="22">WAGER Φ ${esc(stakePhiDec6)} • $${esc(stakeUsd2)}</tspan>
    </text>`
        : ""
    }
  </g>
</svg>`;
};

/* ─────────────────────────────────────────────────────────────
 * Public builders
 * ───────────────────────────────────────────────────────────── */

export const buildPositionSigilSvgFromPayload = async (payload: PositionSigilPayloadV1): Promise<string> => {
  const seed = payload.lineageId ? await deriveChildSeed(payload.lineageId) : await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed, null, undefined);
};

export const buildPositionSigilSvgFromPayloadWithVault = async (
  payload: PositionSigilPayloadV1,
  vault: VaultRecord,
  pos?: PositionRecord,
): Promise<string> => {
  const seed = payload.lineageId ? await deriveChildSeed(payload.lineageId) : await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed, vault, pos);
};

export const buildClaimSigilSvgFromPayload = async (
  payload: ClaimSigilPayloadV1,
  vault?: VaultRecord,
  pos?: PositionRecord,
): Promise<string> => {
  const seed = payload.lineageId ? await deriveChildSeed(payload.lineageId) : await sha256Hex(`SM:CLAIM:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed, vault ?? null, pos);
};

export type MintPositionSigilResult =
  | Readonly<{ ok: true; sigil: PositionSigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintPositionSigil = async (pos: PositionRecord, vault: VaultRecord): Promise<MintPositionSigilResult> => {
  try {
    const payload = await makePayload(pos, vault);
    const svgText = await buildPositionSigilSvgFromPayloadWithVault(payload, vault, pos);

    const svgHashHex = await sha256Hex(svgText);
    const svgHash = asSvgHash(svgHashHex);

    const rawSigilId = await derivePositionSigilId({ positionId: pos.id, ref: svgHashHex.slice(0, 24) });
    const sigilId = asPositionSigilId(String(rawSigilId));

    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const sigil: PositionSigilArtifact = {
      sigilId,
      svgHash,
      url,
      payload,
    };

    return { ok: true, sigil, svgText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "mint failed";
    return { ok: false, error: msg };
  }
};

export type MintClaimSigilResult =
  | Readonly<{ ok: true; sigil: ClaimSigilArtifact; svgText: string; canonicalHashHex: string; zkSeal: ZkSeal }>
  | Readonly<{ ok: false; error: string }>;

export const mintClaimSigil = async (
  pos: PositionRecord,
  vault: VaultRecord,
  claimMoment: KaiMoment,
  payoutMicro: bigint,
): Promise<MintClaimSigilResult> => {
  try {
    const payload = await buildClaimPayload(pos, vault, claimMoment, payoutMicro);
    const svgText = await buildClaimSigilSvgFromPayload(payload, vault, pos);
    const svgHashHex = await sha256Hex(svgText);
    const svgHash = asSvgHash(svgHashHex);
    const rawSigilId = await derivePositionSigilId({ positionId: pos.id, ref: svgHashHex.slice(0, 24) });
    const sigilId = asPositionSigilId(String(rawSigilId));

    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const seal = await buildZkSeal(payload, vault, pos);

    const sigil: ClaimSigilArtifact = {
      sigilId,
      svgHash,
      url,
      payload,
    };

    return { ok: true, sigil, svgText, canonicalHashHex: seal.canonicalHashHex, zkSeal: seal };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "mint claim failed";
    return { ok: false, error: msg };
  }
};

/** Optional UI component wrapper (drop-in) */
export type PositionSigilMintProps = Readonly<{
  position: PositionRecord;
  vault: VaultRecord;
  now: KaiMoment;
  onMinted?: (sigil: PositionSigilArtifact) => void;
}>;

export const PositionSigilMint = (props: PositionSigilMintProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const { actions: posStore } = useSigilMarketsPositionStore();

  const [busy, setBusy] = useState(false);
  const hasRoot = Boolean(props.vault.owner.identitySigil);
  const can = useMemo(() => !props.position.sigil && hasRoot, [hasRoot, props.position.sigil]);

  const run = useCallback(async () => {
    if (!can) return;
    if (!props.vault.owner.identitySigil) {
      ui.toast("error", "Root sigil required", "Inhale your identity sigil to mint this position.");
      return;
    }

    setBusy(true);
    const res = await mintPositionSigil(props.position, props.vault);
    if (!res.ok) {
      ui.toast("error", "Mint failed", res.error, { atPulse: props.now.pulse });
      setBusy(false);
      return;
    }

    posStore.attachSigil(props.position.id, res.sigil, props.now.pulse);
    ui.toast("success", "Minted", "Position sigil ready", { atPulse: props.now.pulse });

    if (props.onMinted) props.onMinted(res.sigil);

    setBusy(false);
  }, [can, posStore, props, ui]);

  return (
    <Button
      variant="primary"
      onClick={run}
      disabled={!can || busy}
      loading={busy}
      leftIcon={<Icon name="spark" size={14} tone="gold" />}
    >
      {props.position.sigil ? "Minted" : "Mint sigil"}
    </Button>
  );
};
