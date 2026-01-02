import { decodeCbor } from "./cbor";
import { base64UrlDecode, base64UrlEncode, sha256Bytes } from "./sha256";
import { jcsCanonicalize } from "./jcs";
import type { StoredPasskey } from "./webauthnKAS";

export type WebAuthnAssertionJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | null;
  };
};

export type ReceiveSig = {
  v: "KRS-1";
  alg: "webauthn-es256";
  nonce: string;
  binds: { bundleHash: string };
  credId: string;
  pubKeyJwk: { kty: "EC"; crv: "P-256"; x: string; y: string; ext?: boolean };
  assertion: WebAuthnAssertionJSON;
};

type ChallengePurpose = "unlock" | "receive";
type ChallengePayload = {
  v: "KAS-CH-1";
  purpose: ChallengePurpose;
  binds: { bundleHash: string };
  nonce: string;
};

const RECEIVE_PASSKEY_KEY = "kai:receive:passkey";
const KAS_PASSKEY_PREFIX = "kai:kas1:passkey:";

type AuthData = {
  credentialId: Uint8Array;
  credentialPublicKey: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isP256Jwk(value: unknown): value is ReceiveSig["pubKeyJwk"] {
  if (!isRecord(value)) return false;
  return value.kty === "EC" && value.crv === "P-256" && typeof value.x === "string" && typeof value.y === "string";
}

function isStoredPasskey(value: unknown): value is StoredPasskey {
  if (!isRecord(value)) return false;
  return typeof value.credId === "string" && isRecord(value.pubKeyJwk);
}

function randomNonceB64u(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export function isReceiveSig(value: unknown): value is ReceiveSig {
  if (!isRecord(value)) return false;
  return (
    value.v === "KRS-1" &&
    value.alg === "webauthn-es256" &&
    typeof value.nonce === "string" &&
    isRecord(value.binds) &&
    typeof value.binds.bundleHash === "string" &&
    typeof value.credId === "string" &&
    isP256Jwk(value.pubKeyJwk) &&
    isRecord(value.assertion)
  );
}

export async function buildKasChallenge(
  purpose: ChallengePurpose,
  bundleHash: string,
  nonce = randomNonceB64u()
): Promise<{ nonce: string; challengeBytes: Uint8Array; challengeB64: string }> {
  const payload: ChallengePayload = { v: "KAS-CH-1", purpose, binds: { bundleHash }, nonce };
  const canon = jcsCanonicalize(payload);
  const challengeBytes = await sha256Bytes(canon);
  return { nonce, challengeBytes, challengeB64: base64UrlEncode(challengeBytes) };
}

export async function getWebAuthnAssertionJson(args: {
  challenge: Uint8Array;
  allowCredIds?: string[];
  preferInternal?: boolean;
}): Promise<WebAuthnAssertionJSON> {
  if (typeof navigator === "undefined" || !navigator.credentials?.get) {
    throw new Error("WebAuthn is not available in this environment.");
  }

  const canUseInternal =
    Boolean(args.preferInternal) &&
    typeof PublicKeyCredential !== "undefined" &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      : false;

  const transports = canUseInternal ? (["internal"] as AuthenticatorTransport[]) : undefined;
  const allowCredentials = args.allowCredIds?.length
    ? args.allowCredIds.map((id) => ({
        id: toArrayBuffer(base64UrlDecode(id)),
        type: "public-key" as const,
        transports,
      }))
    : undefined;

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(args.challenge),
      allowCredentials,
      userVerification: "required",
    },
  })) as PublicKeyCredential | null;

  if (!assertion || assertion.type !== "public-key") {
    throw new Error("Signature request was canceled or failed.");
  }

  const response = assertion.response as AuthenticatorAssertionResponse;
  const rawIdBytes = new Uint8Array(assertion.rawId);
  const userHandleBytes = response.userHandle ? new Uint8Array(response.userHandle) : null;

  return {
    id: assertion.id,
    rawId: base64UrlEncode(rawIdBytes),
    type: "public-key",
    response: {
      authenticatorData: base64UrlEncode(new Uint8Array(response.authenticatorData)),
      clientDataJSON: base64UrlEncode(new Uint8Array(response.clientDataJSON)),
      signature: base64UrlEncode(new Uint8Array(response.signature)),
      userHandle: userHandleBytes ? base64UrlEncode(userHandleBytes) : null,
    },
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function derToRawSignature(signature: Uint8Array, size: number): Uint8Array | null {
  if (signature.length < 8 || signature[0] !== 0x30) return null;
  const totalLength = signature[1];
  if (totalLength + 2 !== signature.length) return null;
  let offset = 2;
  if (signature[offset] !== 0x02) return null;
  const rLen = signature[offset + 1];
  offset += 2;
  const r = signature.slice(offset, offset + rLen);
  offset += rLen;
  if (signature[offset] !== 0x02) return null;
  const sLen = signature[offset + 1];
  offset += 2;
  const s = signature.slice(offset, offset + sLen);

  const rTrim = r[0] === 0x00 ? r.slice(1) : r;
  const sTrim = s[0] === 0x00 ? s.slice(1) : s;
  if (rTrim.length > size || sTrim.length > size) return null;

  const raw = new Uint8Array(size * 2);
  raw.set(rTrim, size - rTrim.length);
  raw.set(sTrim, size * 2 - sTrim.length);
  return raw;
}

async function importP256Jwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function verifyWebAuthnAssertion(args: {
  assertion: WebAuthnAssertionJSON;
  expectedChallenge: Uint8Array;
  pubKeyJwk: JsonWebKey;
  expectedCredId?: string;
}): Promise<boolean> {
  try {
    if (args.expectedCredId && args.assertion.rawId !== args.expectedCredId) return false;

    const expectedChallengeB64 = base64UrlEncode(args.expectedChallenge);
    const clientDataBytes = base64UrlDecode(args.assertion.response.clientDataJSON);
    const clientDataText = new TextDecoder().decode(clientDataBytes);
    const parsed = JSON.parse(clientDataText) as { challenge?: string };
    if (parsed.challenge !== expectedChallengeB64) return false;

    const authenticatorData = base64UrlDecode(args.assertion.response.authenticatorData);
    const clientDataHash = await sha256Bytes(clientDataBytes);
    const signedPayload = concatBytes(authenticatorData, clientDataHash);
    const signatureBytes = base64UrlDecode(args.assertion.response.signature);

    const pubKey = await importP256Jwk(args.pubKeyJwk);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(signedPayload)
    );
    if (verified) return true;

    const rawSig = derToRawSignature(signatureBytes, 32);
    if (!rawSig) return false;
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      toArrayBuffer(rawSig),
      toArrayBuffer(signedPayload)
    );
  } catch {
    return false;
  }
}

export function loadStoredReceiverPasskey(): StoredPasskey | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(RECEIVE_PASSKEY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStoredPasskey(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function findStoredKasPasskeyByCredId(credId: string): StoredPasskey | null {
  if (typeof window === "undefined") return null;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(KAS_PASSKEY_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isStoredPasskey(parsed) && parsed.credId === credId) return parsed;
    } catch {
      // ignore invalid entry
    }
  }
  return null;
}

function saveStoredReceiverPasskey(record: StoredPasskey): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECEIVE_PASSKEY_KEY, JSON.stringify(record));
}

export function listStoredKasPasskeys(): StoredPasskey[] {
  if (typeof window === "undefined") return [];
  const keys: StoredPasskey[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(KAS_PASSKEY_PREFIX)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isStoredPasskey(parsed)) keys.push(parsed);
    } catch {
      // ignore invalid entry
    }
  }
  return keys;
}

function parseAuthData(authData: Uint8Array): AuthData {
  if (authData.length < 37) {
    throw new Error("AuthData too short to contain attested credential data.");
  }
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const flags = authData[32];
  const hasAttestedCredData = (flags & 0x40) !== 0;
  if (!hasAttestedCredData) {
    throw new Error("Attestation missing credential data (AT flag not set).");
  }

  let offset = 37;
  offset += 16;
  const credIdLen = view.getUint16(offset, false);
  offset += 2;
  const credentialId = authData.slice(offset, offset + credIdLen);
  offset += credIdLen;
  const credentialPublicKey = authData.slice(offset);
  if (!credentialPublicKey.length) {
    throw new Error("Credential public key missing from attestation data.");
  }
  return { credentialId, credentialPublicKey };
}

function getCoseValue(key: unknown, label: number): unknown {
  if (key instanceof Map) return key.get(label);
  if (typeof key === "object" && key !== null) {
    const obj = key as Record<string, unknown>;
    return obj[label] ?? obj[String(label)];
  }
  return undefined;
}

function bytesFromCose(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error("Invalid COSE coordinate data.");
}

function coseEc2ToJwk(coseKey: unknown): JsonWebKey {
  const x = bytesFromCose(getCoseValue(coseKey, -2));
  const y = bytesFromCose(getCoseValue(coseKey, -3));
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    ext: true,
  };
}

export async function ensureReceiverPasskey(): Promise<StoredPasskey> {
  const existing = loadStoredReceiverPasskey();
  if (existing) return existing;
  if (typeof navigator === "undefined" || !navigator.credentials?.create) {
    throw new Error("WebAuthn is not available in this browser.");
  }

  const userIdFull = await sha256Bytes("KRS-1|receiver");
  const userId = userIdFull.slice(0, 16);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: "Kai-Voh",
        id: typeof window !== "undefined" ? window.location.hostname : "localhost",
      },
      user: {
        id: userId,
        name: "receiver",
        displayName: "receiver",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
        requireResidentKey: true,
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey creation was canceled or failed.");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const attestationObject = new Uint8Array(response.attestationObject);
  const decoded = decodeCbor(attestationObject);
  const authDataRaw = decoded instanceof Map ? decoded.get("authData") : null;
  if (!authDataRaw) {
    throw new Error("Attestation missing authData.");
  }
  const authData =
    authDataRaw instanceof Uint8Array
      ? authDataRaw
      : authDataRaw instanceof ArrayBuffer
        ? new Uint8Array(authDataRaw)
        : (() => {
            throw new Error("Attestation authData is not a byte array.");
          })();
  const parsed = parseAuthData(authData);
  const coseKey = decodeCbor(parsed.credentialPublicKey);
  const pubKeyJwk = coseEc2ToJwk(coseKey);

  const record: StoredPasskey = {
    credId: base64UrlEncode(new Uint8Array(credential.rawId)),
    pubKeyJwk,
  };
  saveStoredReceiverPasskey(record);
  return record;
}
