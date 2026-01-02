// /components/KaiVoh/verifierProof.ts
"use client";

/**
 * verifierProof — shared helpers for VerifierFrame + KaiVoh embedding
 * v3.0 — Proof Capsule Hash (KPV-1) + deterministic canonicalization
 *
 * What’s new:
 * ✅ Adds KPV-1 proof capsule + sha256 proofHash helpers
 * ✅ Hash binds: pulse + chakraDay + kaiSignature + phiKey + verifierSlug (domain-stable)
 * ✅ verifierUrl is still produced, but NOT part of the hash (so localhost vs kai.ac doesn’t break proof)
 * ✅ Keeps all prior exports stable
 */

import type { ChakraDay } from "../../utils/kai_pulse";
import { jcsCanonicalize } from "../../utils/jcs";
import { sha256Hex } from "../../utils/sha256";
import { svgCanonicalForHash } from "../../utils/svgProof";
import type { AuthorSig } from "../../utils/authorSig";

export const PROOF_HASH_ALG = "sha256" as const;
export const PROOF_CANON = "JCS" as const;
export const PROOF_METADATA_ID = "kai-voh-proof" as const;

/* -------------------------------------------------------------------------- */
/*                                 Base URL                                   */
/* -------------------------------------------------------------------------- */

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

type ViteImportMeta = { env?: { BASE_URL?: unknown } };

function safeBasePath(): string {
  try {
    const baseUrl = (import.meta as unknown as ViteImportMeta).env?.BASE_URL;
    if (typeof baseUrl === "string" && baseUrl.trim().length > 0) return baseUrl;
  } catch {
    // ignore
  }
  return "/";
}

/** Default verifier base is ALWAYS current app origin (+ Vite BASE_URL) + "/verify" */
export function defaultHostedVerifierBaseUrl(): string {
  if (typeof window === "undefined") return "/verify";

  const origin = window.location.origin;
  const base = safeBasePath(); // "/" or "/subpath/"
  const baseClean = trimSlashes(base);
  const prefix = baseClean.length > 0 ? `/${baseClean}` : "";

  return `${origin}${prefix}/verify`;
}

/* -------------------------------------------------------------------------- */
/*                                Slug helpers                                */
/* -------------------------------------------------------------------------- */

/** Shorten signature to a stable slug fragment (no hashing; deterministic + human-readable). */
export function shortKaiSig10(sig: string): string {
  const s = typeof sig === "string" ? sig.trim() : "";
  const safe = s.length > 0 ? s : "unknown-signature";
  return safe.length > 10 ? safe.slice(0, 10) : safe;
}

export function buildVerifierSlug(pulse: number, kaiSignature: string): string {
  const shortSig = shortKaiSig10(kaiSignature);
  return `${pulse}-${shortSig}`;
}

export function buildVerifierUrl(
  pulse: number,
  kaiSignature: string,
  verifierBaseUrl?: string,
): string {
  const base = (verifierBaseUrl ?? defaultHostedVerifierBaseUrl()).replace(/\/+$/, "");
  const slug = encodeURIComponent(buildVerifierSlug(pulse, kaiSignature));
  return `${base}/${slug}`;
}

/* -------------------------------------------------------------------------- */
/*                           Chakra day normalization                          */
/* -------------------------------------------------------------------------- */

/**
 * ChakraDay normalizer → returns exact ChakraDay literals (from utils/kai_pulse)
 * Expected canon:
 * - "Third Eye" (not "ThirdEye")
 * - "Solar Plexus" (not "Solar")
 */
const CHAKRA_MAP: Readonly<Partial<Record<string, ChakraDay>>> = {
  root: "Root",
  sacral: "Sacral",

  // Solar variants
  solar: "Solar Plexus",
  solarp: "Solar Plexus",
  solarplexus: "Solar Plexus",

  heart: "Heart",
  throat: "Throat",

  // Third Eye variants
  thirdeye: "Third Eye",

  crown: "Crown",
  krown: "Crown",
};

export function normalizeChakraDay(v?: string): ChakraDay | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (!raw) return undefined;

  // normalize incoming forms: "Third Eye", "third_eye", "third-eye" -> "thirdeye"
  const k = raw.toLowerCase().replace(/[\s_-]/g, "");
  return CHAKRA_MAP[k];
}

/* -------------------------------------------------------------------------- */
/*                        Proof Capsule Hash (KPV-1)                           */
/* -------------------------------------------------------------------------- */

/**
 * KPV-1: Canonical proof capsule (domain-stable).
 * NOTE: verifierUrl is intentionally excluded (host can change).
 * We bind verifierSlug instead.
 */
export type ProofCapsuleV1 = Readonly<{
  v: "KPV-1";
  pulse: number;
  chakraDay: ChakraDay;
  kaiSignature: string;
  phiKey: string;
  verifierSlug: string;
}>;

/**
 * Deterministic canonical JSON (sorted keys; UTF-8; no whitespace).
 * This prevents “same data, different JSON order” from changing the hash.
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function canonicalizeProofCapsuleV1(c: ProofCapsuleV1): string {
  return jcsCanonicalize({
    v: c.v,
    pulse: c.pulse,
    chakraDay: c.chakraDay,
    kaiSignature: c.kaiSignature,
    phiKey: c.phiKey,
    verifierSlug: c.verifierSlug,
  });
}

/** Compute the integrity hash for the proof capsule. */
export async function hashProofCapsuleV1(c: ProofCapsuleV1): Promise<string> {
  return await sha256Hex(canonicalizeProofCapsuleV1(c));
}

export async function hashSvgText(svgText: string): Promise<string> {
  return await sha256Hex(svgCanonicalForHash(svgText));
}

export type ProofBundleLike = {
  hashAlg?: string;
  canon?: string;
  proofCapsule?: ProofCapsuleV1;
  capsuleHash?: string;
  svgHash?: string;
  shareUrl?: string;
  verifierUrl?: string;
  zkPoseidonHash?: string;
  zkProof?: unknown;
  proofHints?: unknown;
  zkPublicInputs?: unknown;
  authorSig?: AuthorSig | null;
  bundleHash?: string;
  v?: string;
  [key: string]: unknown;
};

type JcsValue = string | number | boolean | null | JcsValue[] | { [k: string]: JcsValue };

export function buildBundleUnsigned(bundle: ProofBundleLike): Record<string, unknown> {
  const { bundleHash: _bundleHash, authorSig: _authorSig, receiveSig: _receiveSig, ...rest } = bundle;
  return { ...rest, authorSig: null };
}

export async function hashBundle(bundleUnsigned: Record<string, unknown>): Promise<string> {
  return await sha256Hex(jcsCanonicalize(bundleUnsigned as JcsValue));
}

/** Convenience short display for hashes. */
export function shortHash10(h: string): string {
  const s = typeof h === "string" ? h.trim() : "";
  return s.length > 10 ? s.slice(0, 10) : s;
}
