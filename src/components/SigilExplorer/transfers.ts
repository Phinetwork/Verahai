// src/components/SigilExplorer/transfers.ts
"use client";

import { extractPayloadFromUrl } from "./url";
import {
  readSigilTransferRegistry,
  SIGIL_TRANSFER_CHANNEL_NAME,
  SIGIL_TRANSFER_EVENT,
  SIGIL_TRANSFER_LS_KEY,
  type SigilTransferRecord,
} from "../../utils/sigilTransferRegistry";
import type { SigilSharePayloadLoose } from "./types";

export { readSigilTransferRegistry, SIGIL_TRANSFER_CHANNEL_NAME, SIGIL_TRANSFER_EVENT, SIGIL_TRANSFER_LS_KEY };
export type { SigilTransferRecord };

export type TransferMove = {
  direction: "send" | "receive";
  amount: number;
  amountUsd?: number;
  sentPulse?: number;
  source: "registry" | "payload";
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readPhiAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    if (Math.abs(raw) < 1e-12) return undefined;
    return Math.abs(raw);
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) return Math.abs(n);
  }
  return undefined;
}

function readTransferDirection(raw: unknown): "send" | "receive" | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("receive") || t.includes("received") || t.includes("inhale")) return "receive";
  if (t.includes("send") || t.includes("sent") || t.includes("exhale")) return "send";
  return null;
}

function readUsdAmount(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return undefined;
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

function readSentPulse(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

export function getTransferMoveFromPayload(payload: SigilSharePayloadLoose): TransferMove | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const feedRecord = isRecord(record.feed) ? (record.feed as Record<string, unknown>) : null;

  const readDir = (src: Record<string, unknown> | null) =>
    src
      ? readTransferDirection(src.phiDirection) ||
        readTransferDirection(src.transferDirection) ||
        readTransferDirection(src.transferMode) ||
        readTransferDirection(src.transferKind)
      : null;

  const readDelta = (src: Record<string, unknown> | null) => {
    if (!src) return undefined;
    return src.phiDelta ?? src.phiSigned ?? src.phiChange;
  };

  const readAmount = (src: Record<string, unknown> | null) =>
    src
      ? readPhiAmount(src.transferAmountPhi) ??
        readPhiAmount(src.transferPhi) ??
        readPhiAmount(src.amountPhi) ??
        readPhiAmount(src.phiAmount) ??
        readPhiAmount(src.childAllocationPhi) ??
        readPhiAmount(src.branchBasePhi)
      : undefined;

  const readUsd = (src: Record<string, unknown> | null) =>
    src
      ? readUsdAmount(src.amountUsd) ??
        readUsdAmount(src.usdAmount) ??
        readUsdAmount(src.usdValue) ??
        readUsdAmount(src.valueUsd) ??
        readUsdAmount(src.usd)
      : undefined;

  const readUsdPerPhi = (src: Record<string, unknown> | null) =>
    src ? readUsdAmount(src.usdPerPhi) ?? readUsdAmount(src.fxUsdPerPhi) ?? readUsdAmount(src.usd_per_phi) : undefined;

  const readPulse = (src: Record<string, unknown> | null) =>
    src
      ? readSentPulse(src.atPulse) ??
        readSentPulse(src.sentPulse) ??
        readSentPulse(src.senderKaiPulse) ??
        readSentPulse(src.transferPulse)
      : undefined;

  const dir = readDir(record) ?? readDir(feedRecord);
  const signedDelta = readDelta(record) ?? readDelta(feedRecord);
  let deltaNumber = typeof signedDelta === "number" ? signedDelta : undefined;
  if (deltaNumber === undefined && typeof signedDelta === "string") deltaNumber = Number(signedDelta);

  const inferred =
    dir ??
    (typeof deltaNumber === "number" && Number.isFinite(deltaNumber)
      ? deltaNumber >= 0
        ? "receive"
        : "send"
      : null);

  if (!inferred) return undefined;

  const amount =
    readAmount(record) ??
    readAmount(feedRecord) ??
    (isRecord(record.preview) ? readPhiAmount((record.preview as Record<string, unknown>).amountPhi) : undefined) ??
    (isRecord(feedRecord?.preview) ? readPhiAmount((feedRecord.preview as Record<string, unknown>).amountPhi) : undefined) ??
    (typeof deltaNumber === "number" && Number.isFinite(deltaNumber) ? Math.abs(deltaNumber) : undefined);

  if (amount === undefined) return undefined;

  const amountUsd =
    readUsd(record) ??
    readUsd(feedRecord) ??
    (isRecord(record.preview) ? readUsdAmount((record.preview as Record<string, unknown>).amountUsd) : undefined) ??
    (isRecord(feedRecord?.preview) ? readUsdAmount((feedRecord.preview as Record<string, unknown>).amountUsd) : undefined);

  const usdPerPhi =
    readUsdPerPhi(record) ??
    readUsdPerPhi(feedRecord) ??
    (isRecord(record.preview) ? readUsdAmount((record.preview as Record<string, unknown>).usdPerPhi) : undefined) ??
    (isRecord(feedRecord?.preview) ? readUsdAmount((feedRecord.preview as Record<string, unknown>).usdPerPhi) : undefined);

  const sentPulse =
    readPulse(record) ??
    readPulse(feedRecord) ??
    (isRecord(record.preview) ? readSentPulse((record.preview as Record<string, unknown>).atPulse) : undefined) ??
    (isRecord(feedRecord?.preview) ? readSentPulse((feedRecord.preview as Record<string, unknown>).atPulse) : undefined);

  return {
    direction: inferred,
    amount,
    amountUsd: amountUsd ?? (usdPerPhi !== undefined ? amount * usdPerPhi : undefined),
    sentPulse,
    source: "payload",
  };
}

export function getTransferMoveFromTransferUrl(record: Record<string, unknown>): TransferMove | undefined {
  const urlKeys = [
    "transferUrl",
    "transferURL",
    "transferLink",
    "transfer_link",
    "sealUrl",
    "sealURL",
    "sigilTransferUrl",
  ];

  for (const key of urlKeys) {
    const raw = record[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const payload = extractPayloadFromUrl(raw.trim());
    if (!payload) continue;
    const move = getTransferMoveFromPayload(payload);
    if (move) return move;
  }

  return undefined;
}

export function getTransferMoveFromRegistry(
  hash: string | undefined,
  registry: ReadonlyMap<string, SigilTransferRecord>,
): TransferMove | undefined {
  if (!hash) return undefined;
  const entry = registry.get(hash.toLowerCase());
  if (!entry) return undefined;
  const amount = readPhiAmount(entry.amountPhi);
  if (amount === undefined) return undefined;
  return {
    direction: entry.direction,
    amount,
    amountUsd: readUsdAmount(entry.amountUsd),
    sentPulse: readSentPulse(entry.sentPulse),
    source: "registry",
  };
}
