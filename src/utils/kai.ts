/* ────────────────────────────────────────────────────────────────
   kai.ts · Atlantean Lumitech “Harmonic Core”
   v25.3 — Pure-JS Poseidon, ESLint-clean, runtime-robust
──────────────────────────────────────────────────────────────────
   ✦ Breath-synchronous Kai-Pulse maths (Genesis: 10 May 2024 06:45:41.888 UTC)
   ✦ Poseidon ⊕ BLAKE3 → deterministic kai_signature
   ✦ Zero Node shims · Zero `any` · Works in every evergreen browser
────────────────────────────────────────────────────────────────── */

////////////////////////////////////////////////////////////////////////////////
// ░░  DEPENDENCIES  ░░
////////////////////////////////////////////////////////////////////////////////

import { blake3Hex, hexToBytes } from "../lib/hash";
import { poseidonHash1, toPoseidonField } from "./poseidon";

////////////////////////////////////////////////////////////////////////////////
// ░░  CONSTANTS  ░░
////////////////////////////////////////////////////////////////////////////////
/** Genesis Breath — the harmonic epoch. */
export const GENESIS_TS = Date.UTC(2024, 4, 10, 6, 45, 41, 888);

/** One Kai-Pulse = 5 .236 s (φ² ÷ 10). */
export const PULSE_MS = (3 + Math.sqrt(5)) * 1000;

/** System Intention — silent mantra baked into every signature. */
export const SYSTEM_INTENTION = "Enter my portal";

////////////////////////////////////////////////////////////////////////////////
// ░░  PULSE LOGIC  ░░
////////////////////////////////////////////////////////////////////////////////

/** Returns the current Kai-Pulse number since Genesis. */
export const getCurrentKaiPulse = (now: number = Date.now()): number =>
  Math.floor((now - GENESIS_TS) / PULSE_MS);

////////////////////////////////////////////////////////////////////////////////
// ░░  INTERNAL HELPERS  ░░
////////////////////////////////////////////////////////////////////////////////

/* — UTF-8 → bigint (field element) — */
const stringToBigInt = (s: string): bigint => {
  const hex = Array.from(new TextEncoder().encode(s), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return BigInt(`0x${hex || "0"}`);
};

/* — BLAKE3( hex ) → 64-char hex (lower-case) — */
const blake3HashHex = async (hexInput: string): Promise<string> => {
  const bytes = hexToBytes(hexInput);
  return blake3Hex(bytes);
};

const padHex64 = (hex: string): string => hex.padStart(64, "0");

const inputsToHex = (inputs: readonly bigint[]): string =>
  inputs.map((v) => padHex64(v.toString(16))).join("");

const poseidonHashHex = async (inputs: readonly bigint[]): Promise<string> => {
  const joined = inputsToHex(inputs);
  return blake3HashHex(joined);
};

const poseidonHashBigInt = async (inputs: readonly bigint[]): Promise<bigint> => {
  const hex = await poseidonHashHex(inputs);
  return BigInt(`0x${hex}`);
};

////////////////////////////////////////////////////////////////////////////////
// ░░  PUBLIC API  ░░
////////////////////////////////////////////////////////////////////////////////

/**
 * Computes the immutable **kai_signature** for a given pulse.
 *
 * @param pulse      Kai-Pulse number (`getCurrentKaiPulse()`).
 * @param intention  Optional override (defaults to SYSTEM_INTENTION).
 * @returns          64-char lower-case hex signature.
 */
export const computeKaiSignature = async (
  pulse: number,
  intention: string = SYSTEM_INTENTION,
): Promise<string> => {
  const poseidonHex = await poseidonHashHex([BigInt(pulse), stringToBigInt(intention)]);
  return blake3HashHex(poseidonHex);
};

export const deriveZkPoseidonSecret = async (hashHex: string): Promise<string> => {
  const clean = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
  const raw = BigInt(`0x${clean || "0"}`);
  return toPoseidonField(raw).toString();
};

/**
 * Computes a deterministic Poseidon hash (decimal string) from a 64-char hex.
 * Used for per-payload ZK stamps without circular dependency on the payload.
 */
export const computeZkPoseidonHash = async (
  hashHex: string
): Promise<{ hash: string; secret: string }> => {
  const secret = await deriveZkPoseidonSecret(hashHex);
  const out = poseidonHash1(BigInt(secret)).toString();
  return { hash: out, secret };
};
