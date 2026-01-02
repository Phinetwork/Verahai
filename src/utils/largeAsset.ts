// src/utils/largeAsset.ts
// Large Asset Glyphs — Root + Derivative Chunk Scheme (no DB)
// Kai-native: deterministically reconstructable + self-verifying.

export type KaiMoment = {
  pulse: number;
  beat: number;
  stepIndex: number;
};

export type LargeAssetRoot = {
  kind: "large_asset_root";
  version: 1;

  rootHash: string; // "kaihash_v1:<b64u>"

  mime: string;
  bytes: number;
  name?: string;

  chunkBytes: number;
  partsTotal: number;

  posterB64u?: string;

  kai: KaiMoment;
};

export type LargeAssetPart = {
  kind: "large_asset_part";
  version: 1;

  rootHash: string;
  partIndex: number;
  partsTotal: number;

  partHash: string; // "sha256:<b64u>" (or raw b64u if you prefer)
  bytesB64u: string;

  kai: KaiMoment;
};

export type LargeAssetAny = LargeAssetRoot | LargeAssetPart;

/**
 * Convert any Uint8Array (even if backed by SharedArrayBuffer) into a real ArrayBuffer
 * that matches the strict DOM typings expected by crypto.subtle and Blob.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer;

  // If already ArrayBuffer, slice to the view range if needed
  if (buf instanceof ArrayBuffer) {
    if (bytes.byteOffset === 0 && bytes.byteLength === buf.byteLength) return buf;
    return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  // SharedArrayBuffer (or other ArrayBufferLike): copy into a fresh ArrayBuffer
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  // Avoid huge argument lists / stack issues
  const CHUNK = 0x8000; // 32KB
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    out += String.fromCharCode.apply(null, Array.from(slice));
  }
  return out;
}

export function b64uEncodeBytes(bytes: Uint8Array): string {
  const b64 = btoa(bytesToBinaryString(bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64uDecodeToBytes(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256B64u(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return b64uEncodeBytes(new Uint8Array(digest));
}

// "kaihash_v1" scales to any size without needing the whole file in RAM.
// It binds: mime|bytes|chunkBytes|partsTotal|ordered(partHashB64u...)
export async function computeRootKaiHashV1(args: {
  mime: string;
  bytes: number;
  chunkBytes: number;
  partsTotal: number;
  orderedPartHashB64u: string[];
}): Promise<string> {
  const { mime, bytes, chunkBytes, partsTotal, orderedPartHashB64u } = args;

  const canon =
    `v=1\nmime=${mime}\nbytes=${bytes}\nchunkBytes=${chunkBytes}\npartsTotal=${partsTotal}\n` +
    orderedPartHashB64u.map((h, i) => `${i}:${h}`).join("\n");

  const enc = new TextEncoder().encode(canon);
  const rootB64u = await sha256B64u(enc);
  return `kaihash_v1:${rootB64u}`;
}

// Slice a File without loading all bytes at once
export async function readFileChunk(file: File, start: number, end: number): Promise<Uint8Array> {
  const buf = await file.slice(start, end).arrayBuffer();
  return new Uint8Array(buf);
}

export function computePartsTotal(bytes: number, chunkBytes: number): number {
  return Math.max(1, Math.ceil(bytes / chunkBytes));
}

export function toPartKey(rootHash: string, partIndex: number): string {
  return `kai:largeAsset:part:v1:${rootHash}:${partIndex}`;
}

export function toRootKey(rootHash: string): string {
  return `kai:largeAsset:root:v1:${rootHash}`;
}

export function makeBlobUrl(mime: string, bytes: Uint8Array): string {
  const blob = new Blob([toArrayBuffer(bytes)], { type: mime });
  return URL.createObjectURL(blob);
}
