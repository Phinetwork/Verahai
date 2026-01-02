// SigilMarkets/state/positionStore.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — positionStore
 *
 * Responsibilities:
 * - Hold PositionRecords (wager receipts) + their lifecycle (open → claimable/lost/refundable → claimed/refunded)
 * - Persist offline-first to local storage
 * - Apply market resolution snapshots to all positions for a market
 *
 * Non-goals:
 * - Executing vault balance movements (vaultStore does that)
 * - Rendering / minting sigils (sigils/* does that)
 */

import React, { createContext, useEffect, useMemo, useRef, useState } from "react";
import {
  SM_POSITIONS_KEY,
  decodeEnvelope,
  getDefaultStorage,
  loadFromStorage,
  removeFromStorage,
  saveToStorage,
  wrapEnvelope,
  type Decoder,
  type PersistResult,
  type StorageLike,
} from "./persistence";

import type {
  EvidenceHash,
  KaiPulse,
  MarketId,
  MarketOutcome,
  PhiMicro,
  VaultId,
} from "../types/marketTypes";

import { asLockId, asMarketId } from "../types/marketTypes";

import type {
  PositionId,
  PositionRecord,
  PositionResolutionSnapshot,
  PositionStatus,
  PositionSigilArtifact,
  PositionPayoutModel,
  PositionEntrySnapshot,
  PositionLockRef,
  SerializedPositionRecord,
} from "../types/sigilPositionTypes";

import { asPositionId, isPositionStatus } from "../types/sigilPositionTypes";

import type { MicroDecimalString } from "../types/vaultTypes";
import { asMicroDecimalString } from "../types/vaultTypes";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const parseBigIntDec = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v;
  if (!isString(v)) return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
};

const biToDec = (v: bigint): MicroDecimalString => asMicroDecimalString(v.toString(10));

const normalizePhi = (v: bigint): PhiMicro => (v < 0n ? (0n as PhiMicro) : (v as PhiMicro));

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const sortPositionIds = (byId: Readonly<Record<string, PositionRecord>>): PositionId[] => {
  const arr: Array<{ id: string; p: number; openP: number }> = [];
  for (const [id, pos] of Object.entries(byId)) {
    arr.push({ id, p: pos.updatedPulse ?? 0, openP: pos.entry.openedAt.pulse ?? 0 });
  }
  arr.sort((a, b) => {
    if (b.p !== a.p) return b.p - a.p;
    if (b.openP !== a.openP) return b.openP - a.openP;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return arr.map((x) => asPositionId(x.id));
};

/** ------------------------------
 * Serialization / Deserialization
 * ------------------------------ */

const serializePositionRecord = (p: PositionRecord): SerializedPositionRecord => ({
  id: p.id,
  marketId: p.marketId,
  lock: {
    vaultId: p.lock.vaultId,
    lockId: p.lock.lockId,
    lockedStakeMicro: biToDec(p.lock.lockedStakeMicro),
  },
  entry: {
    side: p.entry.side,
    stakeMicro: biToDec(p.entry.stakeMicro),
    feeMicro: biToDec(p.entry.feeMicro),
    totalCostMicro: biToDec(p.entry.totalCostMicro),
    sharesMicro: biToDec(p.entry.sharesMicro),
    avgPriceMicro: biToDec(p.entry.avgPriceMicro),
    worstPriceMicro: biToDec(p.entry.worstPriceMicro),
    venue: p.entry.venue,
    openedAt: p.entry.openedAt,
    marketDefinitionHash: p.entry.marketDefinitionHash,
  },
  payoutModel: p.payoutModel,
  status: p.status,
  resolution: p.resolution
    ? {
        outcome: p.resolution.outcome,
        resolvedPulse: p.resolution.resolvedPulse,
        isWinner: p.resolution.isWinner,
        isRefundable: p.resolution.isRefundable,
        evidenceHashes: p.resolution.evidenceHashes,
      }
    : undefined,
  settlement: p.settlement
    ? {
        settledPulse: p.settlement.settledPulse,
        creditedMicro: biToDec(p.settlement.creditedMicro),
        debitedMicro: biToDec(p.settlement.debitedMicro),
        note: p.settlement.note,
      }
    : undefined,
  sigil: p.sigil,
  updatedPulse: p.updatedPulse,
});

const deserializeEntry = (v: unknown): PersistResult<PositionEntrySnapshot> => {
  if (!isRecord(v)) return { ok: false, error: "entry: not object" };

  const side = v["side"];
  if (side !== "YES" && side !== "NO") return { ok: false, error: "entry.side: bad" };

  const stake = parseBigIntDec(v["stakeMicro"]);
  const fee = parseBigIntDec(v["feeMicro"]);
  const total = parseBigIntDec(v["totalCostMicro"]);
  const shares = parseBigIntDec(v["sharesMicro"]);
  const avg = parseBigIntDec(v["avgPriceMicro"]);
  const worst = parseBigIntDec(v["worstPriceMicro"]);

  if (stake === null || fee === null || total === null) return { ok: false, error: "entry: bad cost micros" };
  if (shares === null || avg === null || worst === null) return { ok: false, error: "entry: bad share/price micros" };

  const venue = v["venue"];
  if (venue !== "amm" && venue !== "parimutuel" && venue !== "clob") return { ok: false, error: "entry.venue: bad" };

  const openedAt = v["openedAt"];
  if (!isRecord(openedAt)) return { ok: false, error: "entry.openedAt: bad" };
  const pulse = openedAt["pulse"];
  const beat = openedAt["beat"];
  const stepIndex = openedAt["stepIndex"];
  if (!isNumber(pulse) || !isNumber(beat) || !isNumber(stepIndex)) return { ok: false, error: "entry.openedAt: bad fields" };

  const marketDefinitionHash = isString(v["marketDefinitionHash"]) ? (v["marketDefinitionHash"] as EvidenceHash) : undefined;

  return {
    ok: true,
    value: {
      side,
      stakeMicro: normalizePhi(stake),
      feeMicro: normalizePhi(fee),
      totalCostMicro: normalizePhi(total),
      sharesMicro: shares as unknown as bigint,
      avgPriceMicro: avg as unknown as bigint,
      worstPriceMicro: worst as unknown as bigint,
      venue,
      openedAt: { pulse: Math.max(0, Math.floor(pulse)), beat: Math.floor(beat), stepIndex: Math.floor(stepIndex) },
      marketDefinitionHash,
    } as PositionEntrySnapshot,
  };
};

const deserializeLock = (v: unknown): PersistResult<PositionLockRef> => {
  if (!isRecord(v)) return { ok: false, error: "lock: not object" };
  const vaultId = v["vaultId"];
  const lockId = v["lockId"];
  const lockedStake = parseBigIntDec(v["lockedStakeMicro"]);

  if (!isString(vaultId) || vaultId.length === 0) return { ok: false, error: "lock.vaultId: bad" };
  if (!isString(lockId) || lockId.length === 0) return { ok: false, error: "lock.lockId: bad" };
  if (lockedStake === null) return { ok: false, error: "lock.lockedStakeMicro: bad" };

  return {
    ok: true,
    value: {
      vaultId: vaultId as unknown as VaultId,
      lockId: asLockId(lockId),
      lockedStakeMicro: normalizePhi(lockedStake),
    },
  };
};

const deserializeResolution = (v: unknown): PersistResult<PositionResolutionSnapshot | undefined> => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, error: "resolution: not object" };

  const outcome = v["outcome"];
  if (outcome !== "YES" && outcome !== "NO" && outcome !== "VOID") return { ok: false, error: "resolution.outcome: bad" };

  const resolvedPulse = v["resolvedPulse"];
  if (!isNumber(resolvedPulse)) return { ok: false, error: "resolution.resolvedPulse: bad" };

  const isWinner = typeof v["isWinner"] === "boolean" ? v["isWinner"] : undefined;
  const isRefundable = typeof v["isRefundable"] === "boolean" ? v["isRefundable"] : undefined;

  const evidenceHashesRaw = v["evidenceHashes"];
  const evidenceHashes: EvidenceHash[] | undefined = isArray(evidenceHashesRaw)
    ? evidenceHashesRaw.filter((x): x is string => isString(x) && x.length > 0).map((s) => s as EvidenceHash)
    : undefined;

  return {
    ok: true,
    value: {
      outcome: outcome as MarketOutcome,
      resolvedPulse: Math.max(0, Math.floor(resolvedPulse)),
      isWinner,
      isRefundable,
      evidenceHashes,
    },
  };
};

const deserializeSettlement = (v: unknown): PersistResult<PositionRecord["settlement"] | undefined> => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, error: "settlement: not object" };

  const settledPulse = v["settledPulse"];
  const credited = parseBigIntDec(v["creditedMicro"]);
  const debited = parseBigIntDec(v["debitedMicro"]);
  if (!isNumber(settledPulse)) return { ok: false, error: "settlement.settledPulse: bad" };
  if (credited === null || debited === null) return { ok: false, error: "settlement: bad micros" };

  const note = isString(v["note"]) ? v["note"] : undefined;

  return {
    ok: true,
    value: {
      settledPulse: Math.max(0, Math.floor(settledPulse)),
      creditedMicro: normalizePhi(credited),
      debitedMicro: normalizePhi(debited),
      note,
    },
  };
};

const deserializePositionRecord: Decoder<PositionRecord> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "position: not object" };

  const id = v["id"];
  const marketId = v["marketId"];
  if (!isString(id) || id.length === 0) return { ok: false, error: "position.id: bad" };
  if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "position.marketId: bad" };

  const lockRes = deserializeLock(v["lock"]);
  if (!lockRes.ok) return { ok: false, error: lockRes.error };

  const entryRes = deserializeEntry(v["entry"]);
  if (!entryRes.ok) return { ok: false, error: entryRes.error };

  const payoutModel = v["payoutModel"];
  const okPayout: PositionPayoutModel =
    payoutModel === "parimutuel" || payoutModel === "void-refund" ? payoutModel : "amm-shares";

  const status = v["status"];
  if (!isPositionStatus(status)) return { ok: false, error: "position.status: bad" };

  const resolutionRes = deserializeResolution(v["resolution"]);
  if (!resolutionRes.ok) return { ok: false, error: resolutionRes.error };

  const settlementRes = deserializeSettlement(v["settlement"]);
  if (!settlementRes.ok) return { ok: false, error: settlementRes.error };

  const updatedPulse = isNumber(v["updatedPulse"]) ? Math.max(0, Math.floor(v["updatedPulse"])) : entryRes.value.openedAt.pulse;

  const sigil = isRecord(v["sigil"]) ? (v["sigil"] as PositionSigilArtifact) : undefined;

  return {
    ok: true,
    value: {
      id: asPositionId(id),
      marketId: asMarketId(marketId),
      lock: lockRes.value,
      entry: entryRes.value,
      payoutModel: okPayout,
      status,
      resolution: resolutionRes.value,
      settlement: settlementRes.value,
      sigil,
      updatedPulse,
    },
  };
};

type SerializedPositionsCache = Readonly<{
  byId: Readonly<Record<string, SerializedPositionRecord>>;
  ids: readonly string[];
  lastUpdatedPulse?: KaiPulse;
}>;

const CACHE_ENVELOPE_VERSION = 1;

const decodeSerializedCache: Decoder<SerializedPositionsCache> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "cache: not object" };
  const byIdRaw = v["byId"];
  const idsRaw = v["ids"];
  if (!isRecord(byIdRaw)) return { ok: false, error: "cache.byId: bad" };
  if (!isArray(idsRaw)) return { ok: false, error: "cache.ids: bad" };

  const byId: Record<string, SerializedPositionRecord> = {};
  for (const [k, vv] of Object.entries(byIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    if (!isRecord(vv)) continue;
    byId[k] = vv as unknown as SerializedPositionRecord;
  }

  const ids = idsRaw.filter((x): x is string => isString(x) && x.length > 0);
  const lastUpdatedPulse = isNumber(v["lastUpdatedPulse"]) ? Math.max(0, Math.floor(v["lastUpdatedPulse"])) : undefined;

  return { ok: true, value: { byId, ids, lastUpdatedPulse } };
};

const loadCache = (storage: StorageLike | null): PersistResult<Readonly<{ state: SigilMarketsPositionState }>> => {
  const res = loadFromStorage(
    SM_POSITIONS_KEY,
    (raw) => decodeEnvelope(raw, CACHE_ENVELOPE_VERSION, decodeSerializedCache),
    storage,
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (res.value === null) return { ok: true, value: { state: defaultPositionState() } };

  const env = res.value;
  const cache = env.data;

  // Salvage: decode positions per entry; skip bad ones.
  const byId: Record<string, PositionRecord> = {};
  for (const [id, sv] of Object.entries(cache.byId)) {
    const dp = deserializePositionRecord(sv);
    if (dp.ok) byId[id] = dp.value;
  }

  const idsFromCache = cache.ids.filter((id) => byId[id] !== undefined).map((id) => asPositionId(id));
  const ids = idsFromCache.length > 0 ? idsFromCache : sortPositionIds(byId);

  return {
    ok: true,
    value: {
      state: {
        byId,
        ids,
        status: "ready",
        error: undefined,
        lastUpdatedPulse: cache.lastUpdatedPulse,
        cacheSavedAtMs: env.savedAtMs,
      },
    },
  };
};

const persistCache = (storage: StorageLike | null, state: SigilMarketsPositionState): void => {
  if (!storage) return;

  const byId: Record<string, SerializedPositionRecord> = {};
  for (const [id, p] of Object.entries(state.byId)) {
    byId[id] = serializePositionRecord(p);
  }

  const data: SerializedPositionsCache = {
    byId,
    ids: state.ids.map((id) => id as unknown as string),
    lastUpdatedPulse: state.lastUpdatedPulse,
  };

  const env = wrapEnvelope(data as unknown as never, CACHE_ENVELOPE_VERSION);
  saveToStorage(SM_POSITIONS_KEY, env, storage);
};

/** ------------------------------
 * Store
 * ------------------------------ */

export type PositionStoreStatus = "idle" | "loading" | "ready" | "error";

export type SigilMarketsPositionState = Readonly<{
  byId: Readonly<Record<string, PositionRecord>>;
  ids: readonly PositionId[];
  status: PositionStoreStatus;
  error?: string;
  lastUpdatedPulse?: KaiPulse;
  cacheSavedAtMs?: number;
}>;

const defaultPositionState = (): SigilMarketsPositionState => ({
  byId: {},
  ids: [],
  status: "idle",
  error: undefined,
  lastUpdatedPulse: undefined,
  cacheSavedAtMs: undefined,
});

export type OpenPositionInput = Readonly<{
  id: PositionId;
  marketId: MarketId;
  lock: PositionLockRef;
  entry: PositionEntrySnapshot;
  payoutModel: PositionPayoutModel;
  updatedPulse: KaiPulse;
  sigil?: PositionSigilArtifact;
}>;

export type SigilMarketsPositionActions = Readonly<{
  hydrateFromCache: () => void;

  /** Add a new position (open). If exists, it is replaced (idempotent). */
  openPosition: (input: OpenPositionInput) => PositionRecord;

  /** Upsert positions (bulk). */
  upsertPositions: (positions: readonly PositionRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>) => void;

  /** Attach/update a minted Position Sigil artifact. */
  attachSigil: (positionId: PositionId, sigil: PositionSigilArtifact, updatedPulse: KaiPulse) => PersistResult<PositionRecord>;

  /** Apply a market resolution to all open positions in that market. */
  applyMarketResolution: (req: Readonly<{
    marketId: MarketId;
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    evidenceHashes?: readonly EvidenceHash[];
  }>) => Readonly<{ updated: number; positions: readonly PositionRecord[] }>;

  /** Mark a single position as settled (claimed/refunded). */
  applySettlement: (req: Readonly<{
    positionId: PositionId;
    settledPulse: KaiPulse;
    creditedMicro: PhiMicro;
    debitedMicro: PhiMicro;
    nextStatus: PositionStatus; // "claimed" | "refunded"
    note?: string;
  }>) => PersistResult<PositionRecord>;

  removePosition: (positionId: PositionId) => void;

  clearAll: () => void;
  clearCache: () => void;
  persistNow: () => void;

  setStatus: (status: PositionStoreStatus, error?: string) => void;
}>;

export type SigilMarketsPositionStore = Readonly<{
  state: SigilMarketsPositionState;
  actions: SigilMarketsPositionActions;
}>;

const SigilMarketsPositionContext = createContext<SigilMarketsPositionStore | null>(null);

export const SigilMarketsPositionProvider = (props: Readonly<{ children: React.ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);
  const [state, setState] = useState<SigilMarketsPositionState>(() => {
    const loaded = loadCache(storage);
    if (loaded.ok) return loaded.value.state;
    return defaultPositionState();
  });

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistMsRef = useRef<number>(0);

  const schedulePersist = (next: SigilMarketsPositionState): void => {
    if (!storage) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const t = nowMs();
      if (t - lastPersistMsRef.current < 350) return;
      lastPersistMsRef.current = t;
      persistCache(storage, next);
    }, 250);
  };

  const setAndMaybePersist = (updater: (prev: SigilMarketsPositionState) => SigilMarketsPositionState, persist: boolean): void => {
    setState((prev) => {
      const next = updater(prev);
      if (persist) schedulePersist(next);
      return next;
    });
  };

  // Cross-tab sync
  useEffect(() => {
    if (!storage || typeof window === "undefined") return;

    const onStorage = (e: StorageEvent): void => {
      if (e.key !== SM_POSITIONS_KEY) return;
      if (e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const env = decodeEnvelope(parsed, CACHE_ENVELOPE_VERSION, decodeSerializedCache);
        if (!env.ok) return;

        const byId: Record<string, PositionRecord> = {};
        for (const [id, sv] of Object.entries(env.value.data.byId)) {
          const dp = deserializePositionRecord(sv);
          if (dp.ok) byId[id] = dp.value;
        }
        const idsFromCache = env.value.data.ids.filter((id) => byId[id] !== undefined).map((id) => asPositionId(id));
        const ids = idsFromCache.length > 0 ? idsFromCache : sortPositionIds(byId);

        setState({
          byId,
          ids,
          status: "ready",
          error: undefined,
          lastUpdatedPulse: env.value.data.lastUpdatedPulse,
          cacheSavedAtMs: env.value.savedAtMs,
        });
      } catch {
        // ignore
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  const actions: SigilMarketsPositionActions = useMemo(() => {
    const hydrateFromCache = (): void => {
      const loaded = loadCache(storage);
      if (!loaded.ok) {
        setState((s) => ({ ...s, status: "error", error: loaded.error }));
        return;
      }
      setState(loaded.value.state);
    };

    const openPosition = (input: OpenPositionInput): PositionRecord => {
      const rec: PositionRecord = {
        id: input.id,
        marketId: input.marketId,
        lock: input.lock,
        entry: input.entry,
        payoutModel: input.payoutModel,
        status: "open",
        resolution: undefined,
        settlement: undefined,
        sigil: input.sigil,
        updatedPulse: input.updatedPulse,
      };

      const key = input.id as unknown as string;

      setAndMaybePersist(
        (prev) => {
          const byId: Record<string, PositionRecord> = { ...prev.byId, [key]: rec };
          const ids = sortPositionIds(byId);
          return {
            ...prev,
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, rec.updatedPulse),
            cacheSavedAtMs: nowMs(),
          };
        },
        true,
      );

      return rec;
    };

    const upsertPositions = (positions: readonly PositionRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>): void => {
      if (positions.length === 0) return;

      setAndMaybePersist(
        (prev) => {
          const byId: Record<string, PositionRecord> = { ...prev.byId };
          let maxPulse = prev.lastUpdatedPulse ?? 0;

          for (const p of positions) {
            byId[p.id as unknown as string] = p;
            maxPulse = Math.max(maxPulse, p.updatedPulse);
          }

          const ids = sortPositionIds(byId);
          return {
            ...prev,
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: opts?.lastUpdatedPulse ?? maxPulse,
            cacheSavedAtMs: nowMs(),
          };
        },
        true,
      );
    };

    const attachSigil = (positionId: PositionId, sigil: PositionSigilArtifact, updatedPulse: KaiPulse): PersistResult<PositionRecord> => {
      const key = positionId as unknown as string;
      let out: PositionRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const p = prev.byId[key];
          if (!p) {
            err = "position not found";
            return prev;
          }
          const next: PositionRecord = { ...p, sigil, updatedPulse: Math.max(p.updatedPulse, updatedPulse) };
          out = next;

          const byId: Record<string, PositionRecord> = { ...prev.byId, [key]: next };
          const ids = sortPositionIds(byId);

          return {
            ...prev,
            byId,
            ids,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, next.updatedPulse),
            status: "ready",
            error: undefined,
          };
        },
        true,
      );

      if (err) return { ok: false, error: err };
      return out ? { ok: true, value: out } : { ok: false, error: "unknown error" };
    };

    const applyMarketResolution = (req: Readonly<{
      marketId: MarketId;
      outcome: MarketOutcome;
      resolvedPulse: KaiPulse;
      evidenceHashes?: readonly EvidenceHash[];
    }>): Readonly<{ updated: number; positions: readonly PositionRecord[] }> => {
      const updatedPositions: PositionRecord[] = [];
      let updatedCount = 0;

      setAndMaybePersist(
        (prev) => {
          let changed = false;
          const byId: Record<string, PositionRecord> = { ...prev.byId };

          for (const [id, p] of Object.entries(prev.byId)) {
            if ((p.marketId as unknown as string) !== (req.marketId as unknown as string)) continue;
            if (p.status !== "open") continue;

            const isVoid = req.outcome === "VOID";
            const isWinner = !isVoid && p.entry.side === req.outcome;

            const nextStatus: PositionStatus = isVoid ? "refundable" : isWinner ? "claimable" : "lost";

            const resolution: PositionResolutionSnapshot = {
              outcome: req.outcome,
              resolvedPulse: req.resolvedPulse,
              isWinner: isVoid ? undefined : isWinner,
              isRefundable: isVoid ? true : undefined,
              evidenceHashes: req.evidenceHashes ? [...req.evidenceHashes] : undefined,
            };

            const next: PositionRecord = {
              ...p,
              status: nextStatus,
              resolution,
              updatedPulse: Math.max(p.updatedPulse, req.resolvedPulse),
            };

            byId[id] = next;
            updatedPositions.push(next);
            updatedCount += 1;
            changed = true;
          }

          if (!changed) return prev;

          const ids = sortPositionIds(byId);
          return {
            ...prev,
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, req.resolvedPulse),
          };
        },
        true,
      );

      return { updated: updatedCount, positions: updatedPositions };
    };

    const applySettlement = (req: Readonly<{
      positionId: PositionId;
      settledPulse: KaiPulse;
      creditedMicro: PhiMicro;
      debitedMicro: PhiMicro;
      nextStatus: PositionStatus;
      note?: string;
    }>): PersistResult<PositionRecord> => {
      const key = req.positionId as unknown as string;
      let out: PositionRecord | null = null;
      let err: string | null = null;

      if (req.nextStatus !== "claimed" && req.nextStatus !== "refunded") {
        return { ok: false, error: "nextStatus must be claimed or refunded" };
      }

      setAndMaybePersist(
        (prev) => {
          const p = prev.byId[key];
          if (!p) {
            err = "position not found";
            return prev;
          }

          const next: PositionRecord = {
            ...p,
            status: req.nextStatus,
            settlement: {
              settledPulse: req.settledPulse,
              creditedMicro: normalizePhi(req.creditedMicro),
              debitedMicro: normalizePhi(req.debitedMicro),
              note: req.note,
            },
            updatedPulse: Math.max(p.updatedPulse, req.settledPulse),
          };

          out = next;

          const byId: Record<string, PositionRecord> = { ...prev.byId, [key]: next };
          const ids = sortPositionIds(byId);

          return {
            ...prev,
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, next.updatedPulse),
          };
        },
        true,
      );

      if (err) return { ok: false, error: err };
      return out ? { ok: true, value: out } : { ok: false, error: "unknown error" };
    };

    const removePosition = (positionId: PositionId): void => {
      const key = positionId as unknown as string;
      setAndMaybePersist(
        (prev) => {
          if (!prev.byId[key]) return prev;
          const byId: Record<string, PositionRecord> = { ...prev.byId };
          delete byId[key];
          const ids = prev.ids.filter((id) => (id as unknown as string) !== key);
          return { ...prev, byId, ids };
        },
        true,
      );
    };

    const clearAll = (): void => {
      setState(defaultPositionState());
      removeFromStorage(SM_POSITIONS_KEY, storage);
    };

    const clearCache = (): void => {
      removeFromStorage(SM_POSITIONS_KEY, storage);
      setState((prev) => ({ ...prev, cacheSavedAtMs: undefined }));
    };

    const persistNow = (): void => {
      if (!storage) return;
      persistCache(storage, state);
    };

    const setStatus = (status: PositionStoreStatus, error?: string): void => {
      setState((prev) => ({ ...prev, status, error }));
    };

    return {
      hydrateFromCache,
      openPosition,
      upsertPositions,
      attachSigil,
      applyMarketResolution,
      applySettlement,
      removePosition,
      clearAll,
      clearCache,
      persistNow,
      setStatus,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, state]);

  const store = useMemo<SigilMarketsPositionStore>(() => ({ state, actions }), [state, actions]);

  return <SigilMarketsPositionContext.Provider value={store}>{props.children}</SigilMarketsPositionContext.Provider>;
};

export const useSigilMarketsPositionStore = (): SigilMarketsPositionStore => {
  const ctx = React.useContext(SigilMarketsPositionContext);
  if (!ctx) throw new Error("useSigilMarketsPositionStore must be used within <SigilMarketsPositionProvider>");
  return ctx;
};

export const usePositions = (): readonly PositionRecord[] => {
  const { state } = useSigilMarketsPositionStore();
  return state.ids
    .map((id) => state.byId[id as unknown as string])
    .filter((p): p is PositionRecord => p !== undefined);
};

export const usePositionById = (positionId: PositionId): PositionRecord | null => {
  const { state } = useSigilMarketsPositionStore();
  return state.byId[positionId as unknown as string] ?? null;
};
