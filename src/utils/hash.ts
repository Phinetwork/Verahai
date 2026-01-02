// src/utils/hash.ts
// STRICT: no any, uses Web Crypto. Throws with a clear message if unavailable.

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute SHA-256 as lowercase hex using Web Crypto.
 * Accepts a UTF-8 string or raw bytes.
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const cryptoObj = globalThis.crypto;

  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error("Web Crypto not available for sha256Hex");
  }

  const dataBytes: Uint8Array =
    typeof input === "string" ? new TextEncoder().encode(input) : input;

  // TS’s DOM types expect BufferSource with ArrayBuffer, but our Uint8Array
  // is parameterized on ArrayBufferLike. At runtime this is fine, so we
  // narrow through `unknown` → BufferSource without using `any`.
  const digest = await cryptoObj.subtle.digest(
    "SHA-256",
    dataBytes as unknown as BufferSource
  );

  return toHex(new Uint8Array(digest));
}
