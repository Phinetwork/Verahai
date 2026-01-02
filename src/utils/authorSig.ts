import type { HarmonicSig } from "../lib/sigil/signature";

export type KASAuthorSig = {
  v: "KAS-1";
  alg: "webauthn-es256";
  credId: string;
  pubKeyJwk: JsonWebKey;
  challenge: string;
  signature: string;
  authenticatorData: string;
  clientDataJSON: string;
};

export type AuthorSig = HarmonicSig | KASAuthorSig;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHarmonicSig(value: unknown): value is HarmonicSig {
  if (!isRecord(value)) return false;
  return (
    value.alg === "harmonic-sig" &&
    typeof value.public === "string" &&
    typeof value.value === "string"
  );
}

export function isKASAuthorSig(value: unknown): value is KASAuthorSig {
  if (!isRecord(value)) return false;
  return (
    value.v === "KAS-1" &&
    value.alg === "webauthn-es256" &&
    typeof value.credId === "string" &&
    isRecord(value.pubKeyJwk) &&
    typeof value.challenge === "string" &&
    typeof value.signature === "string" &&
    typeof value.authenticatorData === "string" &&
    typeof value.clientDataJSON === "string"
  );
}

export function parseAuthorSig(value: unknown): AuthorSig | null {
  if (isHarmonicSig(value)) return value;
  if (isKASAuthorSig(value)) return value;
  return null;
}
