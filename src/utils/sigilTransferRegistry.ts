// src/utils/sigilTransferRegistry.ts
// Local registry for sigil transfer direction/amount (Explorer display aid).

export type SigilTransferDirection = "send" | "receive";

export type SigilTransferRecord = {
  hash: string;
  direction: SigilTransferDirection;
  amountPhi: string;
  amountUsd?: string;
  sentPulse?: number;
  updatedAt: number;
};

export const SIGIL_TRANSFER_LS_KEY = "kai:sigil-transfer:v1";
export const SIGIL_TRANSFER_CHANNEL_NAME = "kai-sigil-transfer";
export const SIGIL_TRANSFER_EVENT = "sigil:transfer:recorded";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

function normalizeHash(hash: string): string {
  return hash.trim().toLowerCase();
}

function normalizePhiAmount(raw: unknown): string | null {
  if (raw == null) return null;
  const text = typeof raw === "number" ? raw.toString() : String(raw).trim();
  if (!text) return null;

  const cleaned = text.replace(/^[+-]/u, "").trim();
  if (!cleaned) return null;

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 1e-12) return null;

  return cleaned;
}

function normalizeUsdAmount(raw: unknown): string | null {
  if (raw == null) return null;
  const num = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toFixed(2);
}

function readRawRegistry(): Record<string, SigilTransferRecord> {
  if (!canStorage) return {};
  try {
    const raw = window.localStorage.getItem(SIGIL_TRANSFER_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    if (Array.isArray(parsed)) {
      const out: Record<string, SigilTransferRecord> = {};
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as SigilTransferRecord;
        if (!rec.hash || !rec.direction || !rec.amountPhi) continue;
        out[normalizeHash(rec.hash)] = {
          hash: normalizeHash(rec.hash),
          direction: rec.direction,
          amountPhi: String(rec.amountPhi),
          amountUsd: typeof rec.amountUsd === "string" ? rec.amountUsd : undefined,
          sentPulse: Number.isFinite(rec.sentPulse) ? Number(rec.sentPulse) : undefined,
          updatedAt: Number(rec.updatedAt) || Date.now(),
        };
      }
      return out;
    }

    const out: Record<string, SigilTransferRecord> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const rec = value as SigilTransferRecord;
      if (!rec.hash || !rec.direction || !rec.amountPhi) continue;
      out[normalizeHash(key)] = {
        hash: normalizeHash(rec.hash),
        direction: rec.direction,
        amountPhi: String(rec.amountPhi),
        amountUsd: typeof rec.amountUsd === "string" ? rec.amountUsd : undefined,
        sentPulse: Number.isFinite(rec.sentPulse) ? Number(rec.sentPulse) : undefined,
        updatedAt: Number(rec.updatedAt) || Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function readSigilTransferRegistry(): Map<string, SigilTransferRecord> {
  const raw = readRawRegistry();
  return new Map(Object.entries(raw));
}

export function recordSigilTransferMovement(args: {
  hash: string;
  direction: SigilTransferDirection;
  amountPhi: string | number;
  amountUsd?: string | number;
  sentPulse?: number;
}): SigilTransferRecord | null {
  if (!hasWindow) return null;
  const hash = normalizeHash(args.hash || "");
  if (!hash) return null;
  const amountPhi = normalizePhiAmount(args.amountPhi);
  if (!amountPhi) return null;
  const amountUsd = normalizeUsdAmount(args.amountUsd);
  const sentPulse = Number.isFinite(args.sentPulse) ? Number(args.sentPulse) : undefined;

  const next: SigilTransferRecord = {
    hash,
    direction: args.direction,
    amountPhi,
    amountUsd: amountUsd ?? undefined,
    sentPulse,
    updatedAt: Date.now(),
  };

  const registry = readRawRegistry();
  registry[hash] = next;

  if (canStorage) {
    try {
      window.localStorage.setItem(SIGIL_TRANSFER_LS_KEY, JSON.stringify(registry));
    } catch {
      // ignore quota failures
    }
  }

  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(SIGIL_TRANSFER_CHANNEL_NAME);
      bc.postMessage({
        type: "transfer:update",
        hash,
        direction: args.direction,
        amountPhi,
        amountUsd: amountUsd ?? undefined,
        sentPulse,
      });
      bc.close();
    }
  } catch {
    // ignore broadcast failures
  }

  try {
    window.dispatchEvent(new CustomEvent(SIGIL_TRANSFER_EVENT, { detail: next }));
  } catch {
    // ignore event failures
  }

  return next;
}
