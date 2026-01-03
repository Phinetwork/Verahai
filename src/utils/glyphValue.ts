// src/utils/glyphValue.ts
export type EmbeddedPhiSource = "balance" | "embedded" | "live";

type DebitLoose = {
  amount?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function readLedgerBalance(raw: unknown): { originalAmount: number; remaining: number } | null {
  if (!isRecord(raw)) return null;
  const originalAmount = typeof raw.originalAmount === "number" && Number.isFinite(raw.originalAmount) ? raw.originalAmount : null;
  if (originalAmount == null) return null;
  const debits = Array.isArray(raw.debits) ? raw.debits : [];
  const totalDebited = debits.reduce((sum, entry) => {
    if (!isRecord(entry)) return sum;
    const amount = (entry as DebitLoose).amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return sum;
    return sum + amount;
  }, 0);
  return { originalAmount, remaining: Math.max(0, originalAmount - totalDebited) };
}

export function readPhiAmount(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (Math.abs(raw) < 1e-12) return null;
    return Math.abs(raw);
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) return Math.abs(n);
  }
  return null;
}

export function readEmbeddedPhiAmount(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const candidates: Array<Record<string, unknown>> = [raw];
  const maybeFeed = raw.feed;
  const maybePreview = raw.preview;
  const maybeMeta = raw.meta;

  if (isRecord(maybeFeed)) candidates.push(maybeFeed);
  if (isRecord(maybePreview)) candidates.push(maybePreview);
  if (isRecord(maybeMeta)) candidates.push(maybeMeta);

  for (const source of candidates) {
    const amount =
      readPhiAmount(source.transferAmountPhi) ??
      readPhiAmount(source.transferPhi) ??
      readPhiAmount(source.amountPhi) ??
      readPhiAmount(source.phiAmount) ??
      readPhiAmount(source.childAllocationPhi) ??
      readPhiAmount(source.branchBasePhi) ??
      readPhiAmount(source.valuePhi) ??
      readPhiAmount(source.value);
    if (amount != null) return amount;
  }

  return null;
}

export function resolveGlyphPhi(
  raws: readonly unknown[],
  liveValuePhi: number | null
): { valuePhi: number | null; source: EmbeddedPhiSource } {
  for (const raw of raws) {
    const ledger = readLedgerBalance(raw);
    if (ledger) return { valuePhi: ledger.remaining, source: "balance" };
  }

  for (const raw of raws) {
    const embedded = readEmbeddedPhiAmount(raw);
    if (embedded != null) return { valuePhi: embedded, source: "embedded" };
  }

  return {
    valuePhi: typeof liveValuePhi === "number" && Number.isFinite(liveValuePhi) ? liveValuePhi : null,
    source: "live",
  };
}
