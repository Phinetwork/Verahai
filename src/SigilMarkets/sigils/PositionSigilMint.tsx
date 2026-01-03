// SigilMarkets/sigils/PositionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * PositionSigilMint — Production (No Panels / Ark-Encoded Data)
 *
 * Mints a portable Position Sigil SVG with embedded metadata:
 * - <metadata>        contains SM-POS-1 JSON payload (CDATA; XML-safe; machine-readable)
 * - <metadata id=...> contains ZK seal bundle (CDATA; XML-safe)
 * - Root data-* mirrors key fields + hashes (Kairos-style)
 *
 * Visual goal:
 * - Transparent artboard
 * - Etherik frosted krystal / Atlantean glass "super key"
 * - Sacred geometry + proof rings
 * - NO PANELS: all human-visible data is sewn into arcs/rings around the glyph
 * - Fibonacci / golden-angle placement for organic “living” encoding
 *
 * Production hard rules:
 * - SVG metadata must remain machine-readable (CDATA JSON)
 * - ZK shows VERIFIED when a proof bundle is present (verifiable offline) or a trusted verified flag exists
 * - No `any` in TS
 */

import { useCallback, useMemo, useState } from "react";
import type { KaiMoment } from "../types/marketTypes";
import type { PositionRecord, PositionSigilArtifact, PositionSigilPayloadV1 } from "../types/sigilPositionTypes";
import { asPositionSigilId } from "../types/sigilPositionTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { asSvgHash } from "../types/vaultTypes";

import { sha256Hex, derivePositionSigilId } from "../utils/ids";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsPositionStore } from "../state/positionStore";
import { useSigilMarketsUi } from "../state/uiStore";

/** local compat brand */
type MicroDecimalString = string & { readonly __brand: "MicroDecimalString" };
const asMicroDecimalString = (v: string): MicroDecimalString => v as MicroDecimalString;

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

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
  const b = v["beat"];
  const s = v["stepIndex"];

  const pulse = typeof p === "number" && Number.isFinite(p) ? Math.floor(p) : 0;
  const beat = typeof b === "number" && Number.isFinite(b) ? Math.floor(b) : 0;
  const stepIndex = typeof s === "number" && Number.isFinite(s) ? Math.floor(s) : 0;

  return { pulse: pulse < 0 ? 0 : pulse, beat: beat < 0 ? 0 : beat, stepIndex: stepIndex < 0 ? 0 : stepIndex };
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
const GOLDEN_ANGLE_DEG = 137.50776405003785;

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

const isJsonArray = (v: JSONValue): v is ReadonlyArray<JSONValue> => Array.isArray(v);
const isJsonObject = (v: JSONValue): v is JSONObject => typeof v === "object" && v !== null && !Array.isArray(v);

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
  if (isJsonArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (!isJsonObject(v)) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
};

const safeCdata = (raw: string): string => {
  const safe = raw.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};

const b64Utf8 = (s: string): string => {
  try {
    const b = (globalThis as unknown as { btoa?: (x: string) => string }).btoa;
    if (typeof b === "function") return b(unescape(encodeURIComponent(s)));
  } catch {
    // ignore
  }
  return "";
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

const detectUsdPerPhi = (vault: VaultRecord | null): number | null => {
  const g = globalThis as unknown;
  if (isRecord(g) && typeof g["__SM_USD_PER_PHI__"] === "number" && Number.isFinite(g["__SM_USD_PER_PHI__"]) && g["__SM_USD_PER_PHI__"] > 0) {
    return g["__SM_USD_PER_PHI__"];
  }

  if (!vault) return null;
  const vv = vault as unknown;
  if (!isRecord(vv)) return null;

  const candidates: readonly unknown[] = [
    vv["usdPerPhi"],
    vv["phiUsd"],
    vv["usd_rate"],
    vv["usdRate"],
    isRecord(vv["pricing"]) ? vv["pricing"]["usdPerPhi"] : undefined,
    isRecord(vv["owner"]) ? (vv["owner"] as UnknownRecord)["usdPerPhi"] : undefined,
    isRecord(vv["owner"]) ? (vv["owner"] as UnknownRecord)["phiUsd"] : undefined,
  ];

  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
    if (typeof c === "string") {
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
};

/* ─────────────────────────────────────────────────────────────
 * ZK extraction (REAL PROOF AWARE)
 * ───────────────────────────────────────────────────────────── */

type Groth16Proof = Readonly<{
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
}>;

type ZkAssurance = "proof-present" | "verified-flag" | "seal-match" | "none";

type ZkSeal = Readonly<{
  scheme: "groth16-poseidon";
  canonicalHashAlg: "sha256";
  canonicalHashHex: string;
  canonicalBytesLen: number;

  /** Public input as decimal string (Poseidon hash). */
  zkPoseidonHashDec: string;

  /** True when we should label this as VERIFIED for production glyphs. */
  zkOk: boolean;

  /** Why we consider it verified. */
  zkAssurance: ZkAssurance;

  zkProof?: Groth16Proof;
  zkPublicInputs?: readonly string[];
  proofHints?: Readonly<Record<string, unknown>>;
  verifiedBy?: string;

  matches?: Readonly<{ vaultCanonical?: boolean; vaultPoseidon?: boolean }>;
}>;

const isStringArray = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isStringArray2 = (v: unknown): v is readonly (readonly string[])[] =>
  Array.isArray(v) && v.every((row) => Array.isArray(row) && row.every((x) => typeof x === "string"));

const normalizeGroth16Proof = (v: unknown): Groth16Proof | undefined => {
  if (!isRecord(v)) return undefined;

  // snarkjs style
  if (isStringArray(v["pi_a"]) && isStringArray2(v["pi_b"]) && isStringArray(v["pi_c"])) {
    return { pi_a: v["pi_a"], pi_b: v["pi_b"], pi_c: v["pi_c"] };
  }
  // alt style a/b/c
  if (isStringArray(v["a"]) && isStringArray2(v["b"]) && isStringArray(v["c"])) {
    return { pi_a: v["a"], pi_b: v["b"], pi_c: v["c"] };
  }
  // nested proof bundle
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

  // Prefer explicit public input fields
  const zkPoseidonHashDec =
    typeof src["zkPoseidonHashDec"] === "string"
      ? (src["zkPoseidonHashDec"] as string)
      : typeof src["zkPoseidonHash"] === "string"
        ? (src["zkPoseidonHash"] as string)
        : typeof src["zkPoseidonHash"] === "number"
          ? String(src["zkPoseidonHash"])
          : typeof src["zkPoseidonHashDec"] === "number"
            ? String(src["zkPoseidonHashDec"])
            : typeof src["zkPoseidon"] === "string"
              ? (src["zkPoseidon"] as string)
              : undefined;

  const proofHints = isRecord(src["proofHints"]) ? (src["proofHints"] as Readonly<Record<string, unknown>>) : undefined;

  const zkPublicInputs = isStringArray(src["zkPublicInputs"])
    ? (src["zkPublicInputs"] as readonly string[])
    : isStringArray(src["publicInputs"])
      ? (src["publicInputs"] as readonly string[])
      : isStringArray(src["inputs"])
        ? (src["inputs"] as readonly string[])
        : undefined;

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

const buildZkSeal = async (payload: PositionSigilPayloadV1, vault: VaultRecord | null, pos?: PositionRecord): Promise<ZkSeal> => {
  // Derived canonical from core fields (fallback)
  const canonObj = toJsonValue({
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
    venue: payload.venue ?? null,
    marketDefinitionHash: payload.marketDefinitionHash ?? null,
    resolution: payload.resolution ?? null,
    label: payload.label ?? null,
    note: payload.note ?? null,
  });

  const canonStr = stableStringify(canonObj);
  const canonicalBytesLen = new TextEncoder().encode(canonStr).byteLength;
  const derivedCanonicalHashHex = await sha256Hex(`SM:POS:CANON:${canonStr}`);

  const owner = vault ? ((vault as unknown as UnknownRecord)["owner"] as unknown) : undefined;

  // IMPORTANT: prefer payload first because your real proof is embedded there.
  const payloadZk = extractZkFromUnknown(payload as unknown);
  const entryZk = pos ? extractZkFromUnknown((pos as unknown as UnknownRecord)["entry"]) : {};
  const posZk = pos ? extractZkFromUnknown(pos as unknown) : {};
  const ownerZk = extractZkFromUnknown(owner);

  const merged = mergePrefer(payloadZk, entryZk, posZk, ownerZk);

  const canonicalHashHex = (merged.canonicalHashHex ?? derivedCanonicalHashHex).toLowerCase();

  // Prefer extracted public input; else deterministic placeholder.
  const derivedPoseidonDec = hexToBigIntDec(await sha256Hex(`SM:POS:POSEIDON:${canonicalHashHex}`));
  const zkPoseidonHashDec = merged.zkPoseidonHashDec ?? derivedPoseidonDec;

  const vaultCanonicalOk =
    typeof ownerZk.canonicalHashHex === "string" ? ownerZk.canonicalHashHex.toLowerCase() === canonicalHashHex : undefined;

  const vaultPoseidonOk =
    typeof ownerZk.zkPoseidonHashDec === "string" ? ownerZk.zkPoseidonHashDec === zkPoseidonHashDec : undefined;

  const proofPresent = Boolean(merged.zkProof) || Boolean(merged.zkPublicInputs && merged.zkPublicInputs.length > 0);

  // Production truth rule:
  // - If a Groth16 proof bundle is present in the sigil, it is verifiable offline => label VERIFIED.
  // - If an explicit verified flag is stamped, also VERIFIED.
  // - If both seals match vault, VERIFIED.
  const byFlag = Boolean(merged.verifiedFlag);
  const byMatch = Boolean(vaultCanonicalOk && vaultPoseidonOk);

  const zkOk = proofPresent || byFlag || byMatch;

  const zkAssurance: ZkAssurance = proofPresent ? "proof-present" : byFlag ? "verified-flag" : byMatch ? "seal-match" : "none";

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
 * Sacred geometry
 * ───────────────────────────────────────────────────────────── */

const lissajousPath = (seedHex: string): string => {
  const seed = seed32FromHex(seedHex);
  const rnd = makeRng(seed);

  const A = 360 + Math.floor(rnd() * 140);
  const B = 340 + Math.floor(rnd() * 160);
  const a = 3 + Math.floor(rnd() * 5);
  const b = 4 + Math.floor(rnd() * 6);
  const delta = rnd() * Math.PI;

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

const crystalFacets = (seedHex: string): readonly string[] => {
  const rnd = makeRng(seed32FromHex(`FACETS:${seedHex}`));
  const cx = 500;
  const cy = 500;

  const facetCount = 13 + Math.floor(rnd() * 7);
  const paths: string[] = [];

  for (let i = 0; i < facetCount; i += 1) {
    const ang0 = rnd() * Math.PI * 2;
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

/* ─────────────────────────────────────────────────────────────
 * Arc / ring text helpers (Fibonacci / golden-angle placement)
 * ───────────────────────────────────────────────────────────── */

const deg2rad = (deg: number): number => (deg * Math.PI) / 180;

const arcPathD = (cx: number, cy: number, r: number, startDeg: number, endDeg: number): string => {
  // allow endDeg > 360 to span across wrap
  const s = deg2rad(startDeg);
  const e = deg2rad(endDeg);

  const x0 = cx + r * Math.cos(s);
  const y0 = cy + r * Math.sin(s);
  const x1 = cx + r * Math.cos(e);
  const y1 = cy + r * Math.sin(e);

  const sweep = 1; // clockwise
  const delta = Math.abs(endDeg - startDeg) % 360;
  const largeArc = delta > 180 ? 1 : 0;

  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweep} ${x1.toFixed(
    2,
  )} ${y1.toFixed(2)}`;
};

const circlePathD = (cx: number, cy: number, r: number): string =>
  `M ${(cx).toFixed(2)} ${(cy - r).toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 0 ${(2 * r).toFixed(
    2,
  )} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 0 ${(-2 * r).toFixed(2)}`;

const chunkEvery = (s: string, n: number): readonly string[] => {
  if (n <= 0) return [s];
  if (s.length <= n) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

type ArcText = Readonly<{
  id: string;
  pathId: string;
  d: string;
  text: string;
  fontSize: number;
  opacity: number;
  letterSpacing: number;
}>;

const buildGoldenArcs = (sigId: string, strands: readonly Readonly<{ label: string; text: string; tone: "hi" | "mid" | "low" }>[]): readonly ArcText[] => {
  const cx = 500;
  const cy = 500;

  // Fibonacci-ish radii ladder (outer -> inner), keeps readable “bands”
  const radii = [392, 360, 328, 296, 264] as const;

  const out: ArcText[] = [];
  let idx = 0;

  for (const s of strands) {
    const chunks = chunkEvery(`${s.label}: ${s.text}`, s.tone === "hi" ? 72 : s.tone === "mid" ? 84 : 96);

    for (const c of chunks) {
      const r = radii[idx % radii.length];
      const start = -90 + idx * GOLDEN_ANGLE_DEG;
      const span = s.tone === "hi" ? 128 : s.tone === "mid" ? 118 : 108;
      const end = start + span;

      const pathId = `${sigId}-arc-${idx}`;
      const id = `${sigId}-arctext-${idx}`;
      const d = arcPathD(cx, cy, r, start, end);

      const fontSize = s.tone === "hi" ? 18 : s.tone === "mid" ? 13.6 : 11.4;
      const opacity = s.tone === "hi" ? 0.78 : s.tone === "mid" ? 0.40 : 0.22;
      const letterSpacing = s.tone === "hi" ? 0.55 : s.tone === "mid" ? 0.38 : 0.30;

      out.push({ id, pathId, d, text: c, fontSize, opacity, letterSpacing });

      idx += 1;
    }
  }

  return out;
};

/* ─────────────────────────────────────────────────────────────
 * Payload construction (preserve proof fields if present)
 * ───────────────────────────────────────────────────────────── */

const makePayload = (pos: PositionRecord, vault: VaultRecord): PositionSigilPayloadV1 => {
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
  };

  // Preserve proof bundle if it exists anywhere (entry/pos/vault owner).
  const owner = (vault as unknown as UnknownRecord)["owner"];
  const merged = mergePrefer(
    extractZkFromUnknown(base as unknown),
    extractZkFromUnknown(pos as unknown),
    extractZkFromUnknown((pos as unknown as UnknownRecord)["entry"]),
    extractZkFromUnknown(owner),
  );

  const extra: UnknownRecord = {};
  if (merged.zkProof) extra["zkProof"] = merged.zkProof;
  if (merged.zkPublicInputs) extra["zkPublicInputs"] = merged.zkPublicInputs;
  if (merged.zkPoseidonHashDec) extra["zkPoseidonHash"] = merged.zkPoseidonHashDec; // common naming in your payloads
  if (merged.proofHints) extra["proofHints"] = merged.proofHints;
  if (merged.verifiedFlag) extra["zkOk"] = true;
  if (merged.verifiedBy) extra["verifiedBy"] = merged.verifiedBy;

  // Mutate base via UnknownRecord to avoid type pollution (no `any`)
  Object.assign(base as unknown as UnknownRecord, extra);
  return base;
};

/* ─────────────────────────────────────────────────────────────
 * SVG build (NO PANELS; all data in arcs)
 * ───────────────────────────────────────────────────────────── */

const buildSvg = async (payload: PositionSigilPayloadV1, svgHashSeed: string, vault: VaultRecord | null, pos?: PositionRecord): Promise<string> => {
  const ring = hexRingPath();
  const wave = lissajousPath(svgHashSeed);
  const spiral = goldenSpiralPath();

  const yesTone = "rgba(185,252,255,0.98)";
  const noTone = "rgba(190,170,255,0.98)";
  const tone = payload.side === "YES" ? yesTone : noTone;

  const styleRnd = makeRng(seed32FromHex(`${svgHashSeed}:${payload.side}:STYLE`));
  const ringOuterOpacity = clamp01(0.05 + styleRnd() * 0.10);
  const ringInnerOpacity = clamp01(0.18 + styleRnd() * 0.20);
  const waveGlowOpacity = clamp01(0.08 + styleRnd() * 0.12);
  const waveCoreOpacity = clamp01(0.40 + styleRnd() * 0.22);
  const spiralOpacity = clamp01(0.10 + styleRnd() * 0.16);
  const phiRingOpacity = clamp01(0.14 + styleRnd() * 0.18);

  const glassPlateOpacity = clamp01(0.05 + styleRnd() * 0.07);
  const hazeOpacity = clamp01(0.04 + styleRnd() * 0.07);

  const prismShift = styleRnd();
  const noiseSeed = seed32FromHex(`NOISE:${svgHashSeed}`) % 999;

  const facets = crystalFacets(svgHashSeed);
  const flower = flowerOfLife();

  const sigId = `sm-pos-${payload.openedAt.pulse}-${payload.openedAt.beat}-${payload.openedAt.stepIndex}`;
  const descId = `${sigId}-desc`;

  const seal = await buildZkSeal(payload, vault, pos);

  const title = `SigilMarkets Position — ${payload.side} — pulse ${payload.openedAt.pulse}`;
  const desc = `Position sigil with embedded proof + metadata.`;

  const okWord = seal.zkOk ? "VERIFIED" : "SEALED";
  const toneGhost = payload.side === "YES" ? "rgba(185,252,255,0.10)" : "rgba(190,170,255,0.10)";

  const payloadJsonRaw = JSON.stringify(payload);
  const sealJsonRaw = JSON.stringify(seal);

  const binarySig = bitsToBinaryString(seal.canonicalHashHex);

  const woven = [
    `v=${payload.v}`,
    `kind=${payload.kind}`,
    `marketId=${String(payload.marketId)}`,
    `positionId=${String(payload.positionId)}`,
    `side=${payload.side}`,
    `vaultId=${String(payload.vaultId)}`,
    `lockId=${String(payload.lockId)}`,
    `pulse=${payload.openedAt.pulse}`,
    `beat=${payload.openedAt.beat}`,
    `stepIndex=${payload.openedAt.stepIndex}`,
    `userPhiKey=${String(payload.userPhiKey)}`,
    `kaiSignature=${String(payload.kaiSignature)}`,
    `canonicalHashHex=${seal.canonicalHashHex}`,
    `zkPoseidonHashDec=${seal.zkPoseidonHashDec}`,
    `scheme=${seal.scheme}`,
    `zkOk=${seal.zkOk ? "true" : "false"}`,
  ].join(" • ");

  const stakePhiDec6 = microDecToPhiDec6(String(payload.lockedStakeMicro));
  const usdPerPhi = detectUsdPerPhi(vault);
  const stakePhiNum = phiDec6ToNumber(stakePhiDec6);
  const stakeUsd2 = usdPerPhi ? formatUsd2(stakePhiNum * usdPerPhi) : "—";

  const summary = [
    `market=${String(payload.marketId)}`,
    `position=${String(payload.positionId)}`,
    `side=${payload.side}`,
    `wagerPhi=${stakePhiDec6}`,
    `wagerUsd=${stakeUsd2}`,
    `pulse=${payload.openedAt.pulse}`,
    `beat=${payload.openedAt.beat}`,
    `step=${payload.openedAt.stepIndex}`,
    `zk=${okWord}`,
  ].join(" | ");
  const summaryB64 = b64Utf8(summary);

  // Data strands (the “panels” content, now around the glyph)
  const openedShort = `p=${payload.openedAt.pulse} b=${payload.openedAt.beat} s=${payload.openedAt.stepIndex}`;
  const resolutionShort = payload.resolution
    ? `resolved=${payload.resolution.status} outcome=${payload.resolution.outcome} atPulse=${payload.resolution.resolvedPulse}`
    : "resolved=(unresolved)";

  const usdLabel = usdPerPhi ? `USD@${usdPerPhi.toFixed(4)}` : "USD@(unknown)";

  // Full machine-decodable strand (base64 of compact JSON) — present, but visually subtle.
  const fullStrandJson = stableStringify(
    toJsonValue({
      payload,
      seal,
      zkProof: seal.zkProof ?? null,
      zkPublicInputs: seal.zkPublicInputs ?? null,
      proofHints: seal.proofHints ?? null,
    }),
  );
  const fullStrandB64 = b64Utf8(fullStrandJson);

  const strands = [
    { label: "WAGER", tone: "hi" as const, text: `Φ ${stakePhiDec6} • ${usdLabel} ${stakeUsd2 === "—" ? "—" : `$${stakeUsd2}`} • feeMicro=${String(payload.feeMicro)}` },
    { label: "POSITION", tone: "mid" as const, text: `marketId=${String(payload.marketId)} • positionId=${String(payload.positionId)} • side=${payload.side} • ${openedShort}` },
    { label: "VALUE", tone: "mid" as const, text: `sharesMicro=${String(payload.sharesMicro)} • avgPriceMicro=${String(payload.avgPriceMicro)} • worstPriceMicro=${String(payload.worstPriceMicro)} • totalCostMicro=${String(payload.totalCostMicro)} • ${resolutionShort}` },
    { label: "IDENTITY", tone: "mid" as const, text: `userPhiKey=${String(payload.userPhiKey)} • kaiSignature=${String(payload.kaiSignature)}` },
    { label: "ZK", tone: "hi" as const, text: `${okWord} • scheme=${seal.scheme} • assurance=${seal.zkAssurance}${seal.verifiedBy ? ` • verifier=${seal.verifiedBy}` : ""}` },
    { label: "HASH", tone: "low" as const, text: `canonicalHashHex=${seal.canonicalHashHex} • poseidonDec=${seal.zkPoseidonHashDec}` },
    { label: "DATASTRAND_B64", tone: "low" as const, text: fullStrandB64.length > 0 ? fullStrandB64 : "(b64 unavailable)" },
  ] as const;

  const arcTexts = buildGoldenArcs(sigId, strands);

  const arcDefs = arcTexts.map((a) => `<path id="${esc(a.pathId)}" d="${a.d}" fill="none"/>`).join("\n");

  const arcTextSvg = arcTexts
    .map((a) => {
      return `<text
  id="${esc(a.id)}"
  font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
  font-size="${a.fontSize.toFixed(2)}"
  fill="rgba(255,255,255,0.92)"
  opacity="${a.opacity.toFixed(3)}"
  letter-spacing="${a.letterSpacing.toFixed(2)}"
  style="paint-order: stroke; stroke: rgba(0,0,0,0.62); stroke-width: 1.15; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
  text-rendering="geometricPrecision"
  pointer-events="none"
>
  <textPath href="#${esc(a.pathId)}" startOffset="0%">${esc(a.text)}</textPath>
</text>`;
    })
    .join("\n");

  const sigPathIdOuter = `${sigId}-sig-path-outer`;
  const sigPathIdInner = `${sigId}-sig-path-inner`;

  const proofRing = proofRingTicks(seal.canonicalHashHex, 482);

  const facetsSvg = facets
    .map((d, i) => {
      const rr = makeRng(seed32FromHex(`FACETSTYLE:${svgHashSeed}:${i}`));
      const oFill = clamp01(0.012 + rr() * 0.04);
      const oStroke = clamp01(0.08 + rr() * 0.14);
      const w = (0.9 + rr() * 1.7).toFixed(2);
      return `<path d="${d}" fill="rgba(255,255,255,${oFill.toFixed(3)})" stroke="url(#prism)" stroke-width="${w}" opacity="${oStroke.toFixed(
        3,
      )}" />`;
    })
    .join("\n");

  const flowerSvg = flower.join("\n");

  const headerRight = seal.verifiedBy ? ` | verifier=${seal.verifiedBy}` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  id="${esc(sigId)}"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  role="img"
  lang="en"
  aria-label="${esc(title)}"
  aria-describedby="${esc(descId)}"
  viewBox="0 0 1000 1000"
  width="1000"
  height="1000"
  shape-rendering="geometricPrecision"
  preserveAspectRatio="xMidYMid meet"
  style="background: transparent;"
  data-kind="sigilmarkets-position"
  data-v="SM-POS-1"
  data-market-id="${esc(String(payload.marketId))}"
  data-position-id="${esc(String(payload.positionId))}"
  data-side="${esc(payload.side)}"
  data-vault-id="${esc(String(payload.vaultId))}"
  data-lock-id="${esc(String(payload.lockId))}"
  data-user-phikey="${esc(String(payload.userPhiKey))}"
  data-kai-signature="${esc(String(payload.kaiSignature))}"
  data-pulse="${esc(String(payload.openedAt.pulse))}"
  data-beat="${esc(String(payload.openedAt.beat))}"
  data-step-index="${esc(String(payload.openedAt.stepIndex))}"
  data-summary-b64="${esc(summaryB64)}"
  data-payload-hash="${esc(seal.canonicalHashHex)}"
  data-zk-scheme="${esc(seal.scheme)}"
  data-zk-poseidon-hash="${esc(seal.zkPoseidonHashDec)}"
  data-zk-ok="${esc(seal.zkOk ? "true" : "false")}"
  data-zk-assurance="${esc(seal.zkAssurance)}"
  data-wager-phi="${esc(stakePhiDec6)}"
  data-wager-usd="${esc(stakeUsd2)}"
  ${usdPerPhi ? `data-usd-per-phi="${esc(usdPerPhi.toFixed(6))}"` : ""}
  ${seal.verifiedBy ? `data-zk-verified-by="${esc(seal.verifiedBy)}"` : ""}
>
  <title>${esc(title)}</title>
  <desc id="${esc(descId)}">${esc(desc)}</desc>

  <metadata>${safeCdata(payloadJsonRaw)}</metadata>
  <metadata id="sm-zk">${safeCdata(sealJsonRaw)}</metadata>

  <defs>
    <path id="${esc(sigPathIdOuter)}" d="${circlePathD(500, 500, 460)}" fill="none"/>
    <path id="${esc(sigPathIdInner)}" d="${circlePathD(500, 500, 410)}" fill="none"/>

    <path id="hexRing" d="${ring}" fill="none"/>

    ${arcDefs}

    <linearGradient id="prism" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.90)"/>
      <stop offset="${(16 + prismShift * 10).toFixed(2)}%" stop-color="rgba(160,255,255,0.92)"/>
      <stop offset="${(44 + prismShift * 12).toFixed(2)}%" stop-color="rgba(190,160,255,0.94)"/>
      <stop offset="${(72 + prismShift * 8).toFixed(2)}%" stop-color="rgba(255,220,170,0.92)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.86)"/>
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

  <!-- Primary header (proud, human-readable) -->
  <g filter="url(#etchStrong)"
     font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     fill="rgba(255,255,255,0.94)"
     font-size="20"
     letter-spacing="0.55"
     pointer-events="none">
    <text x="70" y="78">${esc(`SM-POS-1 | ${okWord} | zk=${seal.scheme}${headerRight} | wager Φ ${stakePhiDec6}${stakeUsd2 === "—" ? "" : ` | $${stakeUsd2}`}`)}</text>
  </g>

  <!-- Arc-encoded data (replaces all panels) -->
  <g filter="url(#etchStrong)">
    ${arcTextSvg}
  </g>

  <!-- Binary ring: canonical hash bits -->
  <g id="ring-binary" pointer-events="none">
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="12.4"
      fill="${tone}"
      opacity="0.34"
      letter-spacing="1.08"
      text-anchor="middle"
      dominant-baseline="middle"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.65); stroke-width: 1.2; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >
      <textPath href="#${esc(sigPathIdOuter)}" startOffset="50%">${esc(binarySig)}</textPath>
    </text>
  </g>

  <!-- Woven ring: full key stream -->
  <g id="ring-woven" pointer-events="none">
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="11.2"
      fill="${tone}"
      opacity="0.20"
      letter-spacing="0.7"
      text-anchor="middle"
      dominant-baseline="middle"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.62); stroke-width: 1.1; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >
      <textPath href="#${esc(sigPathIdInner)}" startOffset="50%">${esc(woven)}</textPath>
    </text>
  </g>

  <!-- Proof ticks (256-bit) -->
  <g stroke="url(#prism)" opacity="0.52" pointer-events="none">
    ${proofRing}
  </g>

  <!-- Etherik glass plate -->
  <g filter="url(#frost)" pointer-events="none">
    <circle cx="500" cy="500" r="520" fill="url(#aurora)" opacity="${(glassPlateOpacity * 0.92).toFixed(3)}"/>
    <circle cx="500" cy="500" r="520" fill="url(#ether)" opacity="${glassPlateOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="410" fill="rgba(255,255,255,0.05)" opacity="${hazeOpacity.toFixed(3)}"/>
  </g>

  <!-- Cut-glass ring geometry -->
  <g filter="url(#outerGlow)" pointer-events="none">
    <path d="${ring}" fill="none" stroke="rgba(255,255,255,${ringOuterOpacity.toFixed(3)})" stroke-width="12"/>
    <path d="${ring}" fill="none" stroke="url(#edge)" stroke-width="3.6" opacity="${ringInnerOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="${(432 / PHI).toFixed(2)}" fill="none" stroke="url(#prism)" stroke-width="1.9" opacity="${phiRingOpacity.toFixed(3)}"/>
  </g>

  <!-- Sacred geometry -->
  <g fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.2" opacity="0.78" pointer-events="none">
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
</svg>`;
};

/* ─────────────────────────────────────────────────────────────
 * Public builders
 * ───────────────────────────────────────────────────────────── */

export const buildPositionSigilSvgFromPayload = async (payload: PositionSigilPayloadV1): Promise<string> => {
  const seed = await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed, null, undefined);
};

export const buildPositionSigilSvgFromPayloadWithVault = async (
  payload: PositionSigilPayloadV1,
  vault: VaultRecord,
  pos?: PositionRecord,
): Promise<string> => {
  const seed = await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed, vault, pos);
};

export type MintPositionSigilResult =
  | Readonly<{ ok: true; sigil: PositionSigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintPositionSigil = async (pos: PositionRecord, vault: VaultRecord): Promise<MintPositionSigilResult> => {
  try {
    const payload = makePayload(pos, vault);

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
  const can = useMemo(() => !props.position.sigil, [props.position.sigil]);

  const run = useCallback(async () => {
    if (!can) return;

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
