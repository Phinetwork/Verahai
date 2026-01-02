// src/verifier/canonical.ts
// Canonical verifier math shared across UI and validators.

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const bytesToHexCanon = (u8: Uint8Array) =>
  Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * WebCrypto in TS expects BufferSource backed by a *real* ArrayBuffer.
 * Some TypedArrays can be backed by SharedArrayBuffer (ArrayBufferLike),
 * which trips TS (and sometimes runtime invariants).
 *
 * This always returns a fresh ArrayBuffer containing exactly the bytes in `u8`.
 */
function toArrayBufferForCrypto(u8: Uint8Array): ArrayBuffer {
  const buf = u8.buffer;

  // If it's already a normal ArrayBuffer, we can slice precisely without copying twice.
  if (buf instanceof ArrayBuffer) {
    // If view spans whole buffer, return as-is
    if (u8.byteOffset === 0 && u8.byteLength === buf.byteLength) return buf;
    // Otherwise slice the relevant region
    return buf.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  // SharedArrayBuffer (or any other ArrayBufferLike): copy into a new ArrayBuffer.
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

export async function sha256HexCanon(
  msg: string | Uint8Array,
): Promise<string> {
  const bytes = typeof msg === "string" ? new TextEncoder().encode(msg) : msg;
  const buf = await crypto.subtle.digest("SHA-256", toArrayBufferForCrypto(bytes));
  return bytesToHexCanon(new Uint8Array(buf));
}

function base58EncodeCanon(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);

  let out = "";
  while (n > 0n) {
    const mod = Number(n % 58n);
    out = B58_ALPHABET[mod] + out;
    n /= 58n;
  }

  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = "1" + out;
  return out;
}

export async function base58CheckCanon(
  payload: Uint8Array,
  version = 0x00,
): Promise<string> {
  const v = new Uint8Array(1 + payload.length);
  v[0] = version;
  v.set(payload, 1);

  // First SHA-256
  const c1 = await crypto.subtle.digest("SHA-256", toArrayBufferForCrypto(v));
  // Second SHA-256 (c1 is an ArrayBuffer)
  const c2 = await crypto.subtle.digest("SHA-256", c1);

  const checksum = new Uint8Array(c2).slice(0, 4);
  const full = new Uint8Array(v.length + 4);
  full.set(v);
  full.set(checksum, v.length);

  return base58EncodeCanon(full);
}

export async function derivePhiKeyFromSigCanon(
  sigHex: string,
): Promise<string> {
  const s = await sha256HexCanon(sigHex + "φ");
  const raw = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    raw[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return base58CheckCanon(raw, 0x00);
}

/* Ensure canonical <metadata> first for Verifier */
export function ensureCanonicalMetadataFirst(svgEl: SVGSVGElement) {
  try {
    const metas = Array.from(svgEl.querySelectorAll("metadata"));
    if (!metas.length) return;

    const canon =
      metas.find((m) => m.getAttribute("data-noncanonical") !== "1") ?? metas[0];

    if (canon && svgEl.firstChild !== canon) {
      svgEl.insertBefore(canon, svgEl.firstChild);
    }
  } catch {
    /* noop: non-fatal */
  }
}

/* Σ builder */
export function verifierSigmaString(
  pulse: number,
  beat: number,
  stepIndex: number,
  chakraDay: string,
  intentionSigil?: string,
): string {
  return `${pulse}|${beat}|${stepIndex}|${chakraDay}|${intentionSigil ?? ""}`;
}

/* Read optional intentionSigil */
export function readIntentionSigil(obj: unknown): string | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const rec = obj as Record<string, unknown>;
  const v = rec["intentionSigil"];
  return typeof v === "string" ? v : undefined;
}
