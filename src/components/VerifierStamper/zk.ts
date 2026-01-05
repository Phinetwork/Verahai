// /components/VerifierStamper/zk.ts

import type { SigilMetadata, SigilZkBridge } from "./types";
import { hashAny } from "./sigilUtils";
import { logError } from "../verifier/utils/log";

declare global {
  interface Window {
    SIGIL_ZK_VKEY?: unknown;
    SIGIL_ZK?: SigilZkBridge;
    snarkjs?: { groth16?: Groth16 };
  }
}

/* ─────────── Groth16 minimal structural types ─────────── */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

export type Groth16VerifyingKey = { protocol?: "groth16"; curve?: string } & Record<
  string,
  JsonValue
>;
export type Groth16Proof = Record<string, JsonValue>;
export type Groth16PublicSignals =
  | readonly (string | number | bigint)[]
  | Record<string, string | number | bigint>;

/* Narrowing helpers */
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isScalar = (v: unknown): v is string | number | bigint =>
  typeof v === "string" || typeof v === "number" || typeof v === "bigint";

function isVerifyingKey(v: unknown): v is Groth16VerifyingKey {
  return isObject(v); // permissive; we only need object shape
}
function isProof(v: unknown): v is Groth16Proof {
  return isObject(v);
}
function isPublicSignals(v: unknown): v is Groth16PublicSignals {
  if (Array.isArray(v)) return v.every(isScalar);
  if (!isObject(v)) return false;
  return Object.values(v).every((x) => isScalar(x));
}

export interface Groth16 {
  verify: (...args: unknown[]) => Promise<boolean> | boolean;
}

function isGroth16(x: unknown): x is Groth16 {
  return (
    typeof x === "object" &&
    x !== null &&
    "verify" in x &&
    typeof (x as { verify?: unknown }).verify === "function"
  );
}

/* ─────────── loader cache (avoid repeated imports/log spam) ─────────── */
let groth16Promise: Promise<Groth16 | null> | null = null;
let loggedImportError = false;

async function loadGroth16(): Promise<Groth16 | null> {
  if (groth16Promise) return groth16Promise;

  groth16Promise = (async () => {
    // 1) try global (CDN/script-injected)
    if (
      typeof window !== "undefined" &&
      window.snarkjs?.groth16 &&
      isGroth16(window.snarkjs.groth16)
    ) {
      return window.snarkjs.groth16;
    }

    // 2) try dynamic import (Vite-friendly: literal string, not import(spec))
    try {
      type SnarkjsDynamic = { groth16?: unknown; default?: { groth16?: unknown } };
      const mod = (await import("snarkjs")) as unknown as SnarkjsDynamic;
      const candidate = mod.groth16 ?? mod.default?.groth16;
      if (isGroth16(candidate)) return candidate;
    } catch (err) {
      // optional dep path; don’t spam logs on every verify
      if (!loggedImportError) {
        loggedImportError = true;
        logError("loadGroth16", err);
      }
    }

    return null;
  })();

  return groth16Promise;
}

/** Best-effort Groth16 verifier. Returns null if snarkjs is not available. */
export async function tryVerifyGroth16(args: {
  proof: unknown;
  publicSignals: unknown;
  vkey?: unknown;
  fallbackVkey?: unknown;
}): Promise<boolean | null> {
  const groth16 = await loadGroth16();
  if (!groth16) return null;

  const vkeyCandidate = args.vkey ?? args.fallbackVkey;
  if (!isVerifyingKey(vkeyCandidate)) return false;
  if (!isPublicSignals(args.publicSignals)) return false;
  if (!isProof(args.proof)) return false;

  try {
    const ok = await groth16.verify(
      vkeyCandidate as Groth16VerifyingKey,
      args.publicSignals as Groth16PublicSignals,
      args.proof as Groth16Proof
    );
    return !!ok;
  } catch (err) {
    logError("tryVerifyGroth16.verify", err);
    return false;
  }
}

/** Eagerly verify any ZK bundles on the head (best-effort, offline) */
export async function verifyZkOnHead(m: SigilMetadata): Promise<void> {
  const vkeyInline = m.zkVerifyingKey;
  const vkeyWindow = typeof window !== "undefined" ? window.SIGIL_ZK_VKEY : undefined;
  const fallbackVkey = vkeyInline ?? vkeyWindow;

  const hs = m.hardenedTransfers ?? [];
  for (let i = 0; i < hs.length; i++) {
    const t = hs[i];

    if (t.zkSendBundle) {
      const res = await tryVerifyGroth16({
        proof: t.zkSendBundle.proof,
        publicSignals: t.zkSendBundle.publicSignals,
        vkey: t.zkSendBundle.vkey,
        fallbackVkey,
      });
      if (t.zkSend) t.zkSend.verified = res === true;
    }

    if (t.zkReceiveBundle) {
      const res = await tryVerifyGroth16({
        proof: t.zkReceiveBundle.proof,
        publicSignals: t.zkReceiveBundle.publicSignals,
        vkey: t.zkReceiveBundle.vkey,
        fallbackVkey,
      });
      if (t.zkReceive) t.zkReceive.verified = res === true;
    }
  }
}

export { hashAny as __keep_hashAny };
