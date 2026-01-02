// SigilMarkets/state/feedStore.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — feedStore
 *
 * Responsibilities:
 * - Prophecy Feed (sealed predictions, shareable/verifiable social objects)
 * - Market Activity timeline (trades, closes, resolutions) for MarketRoom
 * - Offline-first persistence (localStorage) with salvage + caps
 *
 * Notes:
 * - "Prophecies" are NOT wagers. They are proof-of-forecast objects.
 * - Wagers produce Positions (positionStore).
 */

import React, { createContext, useEffect, useMemo, useRef, useState } from "react";
import {
  SM_FEED_KEY,
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
  Brand,
  EvidenceHash,
  KaiMoment,
  KaiPulse,
  MarketActivityEvent,
  MarketId,
  MarketOutcome,
  MarketSide,
  PhiMicro,
  PriceMicro,
  ShareMicro,
  LockId,
  VaultId,
} from "../types/marketTypes";

import { asLockId, asMarketId, asVaultId } from "../types/marketTypes";

import type { PositionId } from "../types/sigilPositionTypes";
import { asPositionId } from "../types/sigilPositionTypes";

import type { KaiSignature, SvgHash, UserPhiKey } from "../types/vaultTypes";
import { asKaiSignature, asSvgHash, asUserPhiKey } from "../types/vaultTypes";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const genId = (prefix: string): string => `${prefix}_${nowMs()}_${Math.random().toString(16).slice(2)}`;

/** ---- Prophecy types (exported) ---- */

export type ProphecyId = Brand<string, "ProphecyId">;
export const asProphecyId = (v: string): ProphecyId => v as ProphecyId;

export type ProphecyVisibility = "public" | "private";
export type ProphecyKind = "sealed-prediction";

export type ProphecyStatus = "sealed" | "fulfilled" | "missed" | "void";

export type ProphecyAuthor = Readonly<{
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;
}>;

/**
 * Optional portable artifact for a prophecy (Sigil).
 * This is not required for the feed to work, but enables export/print/share.
 */
export type ProphecySigilPayloadV1 = Readonly<{
  v: "SM-PROP-1";
  kind: "prophecy";

  prophecyId: ProphecyId;
  marketId: MarketId;
  side: MarketSide;

  createdAt: KaiMoment;

  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  visibility: ProphecyVisibility;
  note?: string;

  /** Optional link to a staked position. */
  positionId?: PositionId;

  /** Optional outcome snapshot if minted after resolution. */
  resolution?: Readonly<{
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    status: ProphecyStatus;
  }>;
}>;

export type ProphecySigilArtifact = Readonly<{
  svgHash: SvgHash;
  url?: string;
  payload: ProphecySigilPayloadV1;
}>;

export type ProphecyRecord = Readonly<{
  id: ProphecyId;
  kind: ProphecyKind;

  marketId: MarketId;
  side: MarketSide;

  createdAt: KaiMoment;
  author: ProphecyAuthor;

  visibility: ProphecyVisibility;
  note?: string;

  /** Optional linkage to a wager position. */
  positionId?: PositionId;

  /** Optional sigil artifact ref. */
  sigil?: ProphecySigilArtifact;

  /** Resolution snapshot applied by the store (derived from market resolution). */
  resolution?: Readonly<{
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    status: ProphecyStatus;
    evidenceHashes?: readonly EvidenceHash[];
  }>;

  updatedPulse: KaiPulse;
}>;

/** ---- Market activity storage (capped) ---- */

export type MarketActivityStore = Readonly<Record<string, readonly MarketActivityEvent[]>>;

const DEFAULT_ACTIVITY_CAP_PER_MARKET = 240;
const DEFAULT_GLOBAL_ACTIVITY_CAP = 420;

/** Derive a stable key to dedupe activity events best-effort. */
const activityKey = (e: MarketActivityEvent): string => {
  if (e.type === "trade") {
    const vid = e.vaultId ?? "";
    const lid = e.lockId ?? "";
    return `trade:${e.marketId}:${e.side}:${e.atPulse}:${vid}:${lid}:${e.stakeMicro.toString(10)}:${e.sharesMicro.toString(10)}`;
  }
  if (e.type === "market-created") return `created:${e.marketId}:${e.atPulse}`;
  if (e.type === "market-closed") return `closed:${e.marketId}:${e.atPulse}`;
  if (e.type === "resolution-proposed") return `proposed:${e.marketId}:${e.outcome}:${e.atPulse}`;
  return `resolved:${e.marketId}:${e.outcome}:${e.atPulse}`;
};

/** ---- Persistence shapes ---- */

type SerializedProphecy = Readonly<{
  id: string;
  kind: ProphecyKind;

  marketId: string;
  side: MarketSide;

  createdAt: KaiMoment;

  author: Readonly<{ userPhiKey: string; kaiSignature: string }>;

  visibility: ProphecyVisibility;
  note?: string;

  positionId?: string;

  sigil?: Readonly<{
    svgHash: string;
    url?: string;
    payload: ProphecySigilPayloadV1;
  }>;

  resolution?: Readonly<{
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    status: ProphecyStatus;
    evidenceHashes?: readonly string[];
  }>;

  updatedPulse: KaiPulse;
}>;

type SerializedActivityEvent = unknown; // stored as raw JSON; decoded loosely

type SerializedFeedCache = Readonly<{
  propheciesById: Readonly<Record<string, SerializedProphecy>>;
  prophecyIds: readonly string[];
  activityByMarketId: Readonly<Record<string, readonly SerializedActivityEvent[]>>;
  globalActivity: readonly SerializedActivityEvent[];
  lastUpdatedPulse?: KaiPulse;
}>;

const CACHE_ENVELOPE_VERSION = 1;

const decodeKaiMoment = (v: unknown): PersistResult<KaiMoment> => {
  if (!isRecord(v)) return { ok: false, error: "moment: not object" };
  const pulse = v["pulse"];
  const beat = v["beat"];
  const stepIndex = v["stepIndex"];
  if (!isNumber(pulse) || !isNumber(beat) || !isNumber(stepIndex)) return { ok: false, error: "moment: bad fields" };
  return {
    ok: true,
    value: {
      pulse: Math.max(0, Math.floor(pulse)),
      beat: Math.floor(beat),
      stepIndex: Math.floor(stepIndex),
    },
  };
};

const decodeProphecy: Decoder<ProphecyRecord> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "prophecy: not object" };

  const id = v["id"];
  const kind = v["kind"];
  const marketId = v["marketId"];
  const side = v["side"];
  const createdAt = v["createdAt"];
  const author = v["author"];
  const visibility = v["visibility"];
  const updatedPulse = v["updatedPulse"];

  if (!isString(id) || id.length === 0) return { ok: false, error: "prophecy.id: bad" };
  if (kind !== "sealed-prediction") return { ok: false, error: "prophecy.kind: bad" };
  if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "prophecy.marketId: bad" };
  if (side !== "YES" && side !== "NO") return { ok: false, error: "prophecy.side: bad" };
  if (!isRecord(author)) return { ok: false, error: "prophecy.author: bad" };
  if (visibility !== "public" && visibility !== "private") return { ok: false, error: "prophecy.visibility: bad" };
  if (!isNumber(updatedPulse)) return { ok: false, error: "prophecy.updatedPulse: bad" };

  const momentRes = decodeKaiMoment(createdAt);
  if (!momentRes.ok) return { ok: false, error: momentRes.error };

  const userPhiKey = author["userPhiKey"];
  const kaiSignature = author["kaiSignature"];
  if (!isString(userPhiKey) || userPhiKey.length === 0) return { ok: false, error: "prophecy.author.userPhiKey: bad" };
  if (!isString(kaiSignature) || kaiSignature.length === 0) return { ok: false, error: "prophecy.author.kaiSignature: bad" };

  const note = isString(v["note"]) ? v["note"] : undefined;
  const positionId = isString(v["positionId"]) && v["positionId"].length > 0 ? asPositionId(v["positionId"]) : undefined;

  const sigilRaw = v["sigil"];
  const sigil =
    isRecord(sigilRaw) && isString(sigilRaw["svgHash"]) && isRecord(sigilRaw["payload"])
      ? {
          svgHash: asSvgHash(sigilRaw["svgHash"]),
          url: isString(sigilRaw["url"]) ? sigilRaw["url"] : undefined,
          payload: sigilRaw["payload"] as ProphecySigilPayloadV1,
        }
      : undefined;

  const resolutionRaw = v["resolution"];
  const resolution =
    isRecord(resolutionRaw) && (resolutionRaw["outcome"] === "YES" || resolutionRaw["outcome"] === "NO" || resolutionRaw["outcome"] === "VOID")
      ? {
          outcome: resolutionRaw["outcome"] as MarketOutcome,
          resolvedPulse: isNumber(resolutionRaw["resolvedPulse"]) ? Math.max(0, Math.floor(resolutionRaw["resolvedPulse"])) : momentRes.value.pulse,
          status:
            resolutionRaw["status"] === "fulfilled" || resolutionRaw["status"] === "missed" || resolutionRaw["status"] === "void"
              ? (resolutionRaw["status"] as ProphecyStatus)
              : ("sealed" as ProphecyStatus),
          evidenceHashes: isArray(resolutionRaw["evidenceHashes"])
            ? resolutionRaw["evidenceHashes"].filter((x): x is string => isString(x) && x.length > 0)
            : undefined,
        }
      : undefined;

  return {
    ok: true,
    value: {
      id: asProphecyId(id),
      kind: "sealed-prediction",
      marketId: asMarketId(marketId),
      side,
      createdAt: momentRes.value,
      author: { userPhiKey: asUserPhiKey(userPhiKey), kaiSignature: asKaiSignature(kaiSignature) },
      visibility,
      note,
      positionId,
      sigil,
      resolution: resolution
        ? {
            outcome: resolution.outcome,
            resolvedPulse: resolution.resolvedPulse,
            status: resolution.status,
            evidenceHashes: resolution.evidenceHashes ? (resolution.evidenceHashes as unknown as EvidenceHash[]) : undefined,
          }
        : undefined,
      updatedPulse: Math.max(0, Math.floor(updatedPulse)),
    },
  };
};

const decodeSerializedFeedCache: Decoder<SerializedFeedCache> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "cache: not object" };

  const propheciesByIdRaw = v["propheciesById"];
  const prophecyIdsRaw = v["prophecyIds"];
  const activityByMarketIdRaw = v["activityByMarketId"];
  const globalActivityRaw = v["globalActivity"];

  if (!isRecord(propheciesByIdRaw)) return { ok: false, error: "cache.propheciesById: bad" };
  if (!isArray(prophecyIdsRaw)) return { ok: false, error: "cache.prophecyIds: bad" };
  if (!isRecord(activityByMarketIdRaw)) return { ok: false, error: "cache.activityByMarketId: bad" };
  if (!isArray(globalActivityRaw)) return { ok: false, error: "cache.globalActivity: bad" };

  const propheciesById: Record<string, SerializedProphecy> = {};
  for (const [k, vv] of Object.entries(propheciesByIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    if (isRecord(vv)) propheciesById[k] = vv as unknown as SerializedProphecy;
  }

  const prophecyIds = prophecyIdsRaw.filter((x): x is string => isString(x) && x.length > 0);

  const activityByMarketId: Record<string, readonly SerializedActivityEvent[]> = {};
  for (const [k, vv] of Object.entries(activityByMarketIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    if (!isArray(vv)) continue;
    activityByMarketId[k] = vv as readonly SerializedActivityEvent[];
  }

  const globalActivity = globalActivityRaw as readonly SerializedActivityEvent[];
  const lastUpdatedPulse = isNumber(v["lastUpdatedPulse"]) ? Math.max(0, Math.floor(v["lastUpdatedPulse"])) : undefined;

  return {
    ok: true,
    value: { propheciesById, prophecyIds, activityByMarketId, globalActivity, lastUpdatedPulse },
  };
};

/** ---- In-memory state ---- */

export type FeedStoreStatus = "idle" | "loading" | "ready" | "error";

export type SigilMarketsFeedState = Readonly<{
  propheciesById: Readonly<Record<string, ProphecyRecord>>;
  prophecyIds: readonly ProphecyId[];

  activityByMarketId: MarketActivityStore;
  globalActivity: readonly MarketActivityEvent[];

  status: FeedStoreStatus;
  error?: string;

  lastUpdatedPulse?: KaiPulse;
  cacheSavedAtMs?: number;
}>;

const defaultFeedState = (): SigilMarketsFeedState => ({
  propheciesById: {},
  prophecyIds: [],
  activityByMarketId: {},
  globalActivity: [],
  status: "idle",
  error: undefined,
  lastUpdatedPulse: undefined,
  cacheSavedAtMs: undefined,
});

const sortProphecyIds = (byId: Readonly<Record<string, ProphecyRecord>>): ProphecyId[] => {
  const arr: Array<{ id: string; p: number }> = [];
  for (const [id, pr] of Object.entries(byId)) {
    arr.push({ id, p: pr.updatedPulse ?? 0 });
  }
  arr.sort((a, b) => {
    if (b.p !== a.p) return b.p - a.p;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return arr.map((x) => asProphecyId(x.id));
};

const serializeProphecy = (p: ProphecyRecord): SerializedProphecy => ({
  id: p.id as unknown as string,
  kind: p.kind,
  marketId: p.marketId as unknown as string,
  side: p.side,
  createdAt: p.createdAt,
  author: { userPhiKey: p.author.userPhiKey as unknown as string, kaiSignature: p.author.kaiSignature as unknown as string },
  visibility: p.visibility,
  note: p.note,
  positionId: p.positionId ? (p.positionId as unknown as string) : undefined,
  sigil: p.sigil
    ? {
        svgHash: p.sigil.svgHash as unknown as string,
        url: p.sigil.url,
        payload: p.sigil.payload,
      }
    : undefined,
  resolution: p.resolution
    ? {
        outcome: p.resolution.outcome,
        resolvedPulse: p.resolution.resolvedPulse,
        status: p.resolution.status,
        evidenceHashes: p.resolution.evidenceHashes ? (p.resolution.evidenceHashes as unknown as string[]) : undefined,
      }
    : undefined,
  updatedPulse: p.updatedPulse,
});

const persistCache = (storage: StorageLike | null, state: SigilMarketsFeedState): void => {
  if (!storage) return;

  const propheciesById: Record<string, SerializedProphecy> = {};
  for (const [id, p] of Object.entries(state.propheciesById)) {
    propheciesById[id] = serializeProphecy(p);
  }

  const activityByMarketId: Record<string, readonly SerializedActivityEvent[]> = {};
  for (const [mid, events] of Object.entries(state.activityByMarketId)) {
    activityByMarketId[mid] = events as unknown as readonly SerializedActivityEvent[];
  }

  const data: SerializedFeedCache = {
    propheciesById,
    prophecyIds: state.prophecyIds.map((id) => id as unknown as string),
    activityByMarketId,
    globalActivity: state.globalActivity as unknown as readonly SerializedActivityEvent[],
    lastUpdatedPulse: state.lastUpdatedPulse,
  };

  const env = wrapEnvelope(data as unknown as never, CACHE_ENVELOPE_VERSION);
  saveToStorage(SM_FEED_KEY, env, storage);
};

const loadCache = (storage: StorageLike | null): PersistResult<Readonly<{ state: SigilMarketsFeedState }>> => {
  const res = loadFromStorage(
    SM_FEED_KEY,
    (raw) => decodeEnvelope(raw, CACHE_ENVELOPE_VERSION, decodeSerializedFeedCache),
    storage,
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (res.value === null) return { ok: true, value: { state: defaultFeedState() } };

  const env = res.value;
  const cache = env.data;

  const propheciesById: Record<string, ProphecyRecord> = {};
  for (const [id, sv] of Object.entries(cache.propheciesById)) {
    const dp = decodeProphecy(sv);
    if (dp.ok) propheciesById[id] = dp.value;
  }

  const prophecyIdsFromCache = cache.prophecyIds.filter((id) => propheciesById[id] !== undefined).map((id) => asProphecyId(id));
  const prophecyIds = prophecyIdsFromCache.length > 0 ? prophecyIdsFromCache : sortProphecyIds(propheciesById);

  // Activity is decoded loosely (best-effort); if malformed, drop.
  const decodeActivityEvent = (v: unknown): MarketActivityEvent | null => {
    if (!isRecord(v)) return null;
    const type = v["type"];
    const marketId = v["marketId"];
    const atPulse = v["atPulse"];
    if (!isString(type) || !isString(marketId) || !isNumber(atPulse)) return null;
    const p = Math.max(0, Math.floor(atPulse));

    if (type === "market-created") return { type, marketId: asMarketId(marketId), atPulse: p };
    if (type === "market-closed") return { type, marketId: asMarketId(marketId), atPulse: p };
    if (type === "resolution-proposed") {
      const outcome = v["outcome"];
      if (outcome !== "YES" && outcome !== "NO" && outcome !== "VOID") return null;
      return { type, marketId: asMarketId(marketId), outcome, atPulse: p };
    }
    if (type === "market-resolved") {
      const outcome = v["outcome"];
      if (outcome !== "YES" && outcome !== "NO" && outcome !== "VOID") return null;
      return { type, marketId: asMarketId(marketId), outcome, atPulse: p };
    }
    if (type === "trade") {
      const side = v["side"];
      if (side !== "YES" && side !== "NO") return null;
      const stakeMicro = v["stakeMicro"];
      const sharesMicro = v["sharesMicro"];
      const avgPriceMicro = v["avgPriceMicro"];
      if (typeof stakeMicro !== "string" || typeof sharesMicro !== "string" || typeof avgPriceMicro !== "string") return null;
      // keep as bigint-like strings? In canonical types these are bigint.
      // For feed UI we can rehydrate as BigInt safely.
      try {
        const stake = BigInt(stakeMicro);
        const shares = BigInt(sharesMicro);
        const avg = BigInt(avgPriceMicro);
        const vaultId = isString(v["vaultId"]) ? asVaultId(v["vaultId"]) : undefined;
        const lockId = isString(v["lockId"]) ? asLockId(v["lockId"]) : undefined;

        return {
          type,
          marketId: asMarketId(marketId),
          side,
          stakeMicro: stake as PhiMicro,
          sharesMicro: shares as ShareMicro,
          avgPriceMicro: avg as PriceMicro,
          atPulse: p,
          vaultId: vaultId as VaultId | undefined,
          lockId: lockId as LockId | undefined,
        };
      } catch {
        return null;
      }
    }

    return null;
  };

  const activityByMarketId: Record<string, readonly MarketActivityEvent[]> = {};
  for (const [mid, rawEvents] of Object.entries(cache.activityByMarketId)) {
    const events: MarketActivityEvent[] = [];
    for (const ev of rawEvents) {
      const d = decodeActivityEvent(ev);
      if (d) events.push(d);
    }
    activityByMarketId[mid] = events;
  }

  const globalActivity: MarketActivityEvent[] = [];
  for (const ev of cache.globalActivity) {
    const d = decodeActivityEvent(ev);
    if (d) globalActivity.push(d);
  }

  return {
    ok: true,
    value: {
      state: {
        propheciesById,
        prophecyIds,
        activityByMarketId,
        globalActivity,
        status: "ready",
        error: undefined,
        lastUpdatedPulse: cache.lastUpdatedPulse,
        cacheSavedAtMs: env.savedAtMs,
      },
    },
  };
};

/** ---- Store actions ---- */

export type CreateProphecyInput = Readonly<{
  marketId: MarketId;
  side: MarketSide;
  createdAt: KaiMoment;
  author: ProphecyAuthor;
  visibility?: ProphecyVisibility;
  note?: string;
  positionId?: PositionId;
  sigil?: ProphecySigilArtifact;
}>;

export type SigilMarketsFeedActions = Readonly<{
  hydrateFromCache: () => void;

  addProphecy: (input: CreateProphecyInput) => ProphecyRecord;
  upsertProphecies: (prophecies: readonly ProphecyRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>) => void;
  removeProphecy: (id: ProphecyId) => void;

  attachProphecySigil: (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse) => PersistResult<ProphecyRecord>;

  applyMarketResolutionToProphecies: (req: Readonly<{
    marketId: MarketId;
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    evidenceHashes?: readonly EvidenceHash[];
  }>) => Readonly<{ updated: number; prophecies: readonly ProphecyRecord[] }>;

  appendMarketActivity: (req: Readonly<{
    marketId: MarketId;
    events: readonly MarketActivityEvent[];
    capPerMarket?: number;
    globalCap?: number;
    updatedPulse: KaiPulse;
  }>) => Readonly<{ added: number }>;

  clearAll: () => void;
  clearCache: () => void;
  persistNow: () => void;

  setStatus: (status: FeedStoreStatus, error?: string) => void;
}>;

export type SigilMarketsFeedStore = Readonly<{
  state: SigilMarketsFeedState;
  actions: SigilMarketsFeedActions;
}>;

const SigilMarketsFeedContext = createContext<SigilMarketsFeedStore | null>(null);

export const SigilMarketsFeedProvider = (props: Readonly<{ children: React.ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);
  const [state, setState] = useState<SigilMarketsFeedState>(() => {
    const loaded = loadCache(storage);
    if (loaded.ok) return loaded.value.state;
    return defaultFeedState();
  });

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistMsRef = useRef<number>(0);

  const schedulePersist = (next: SigilMarketsFeedState): void => {
    if (!storage) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const t = nowMs();
      if (t - lastPersistMsRef.current < 350) return;
      lastPersistMsRef.current = t;
      persistCache(storage, next);
    }, 250);
  };

  const setAndMaybePersist = (updater: (prev: SigilMarketsFeedState) => SigilMarketsFeedState, persist: boolean): void => {
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
      if (e.key !== SM_FEED_KEY) return;
      if (e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const env = decodeEnvelope(parsed, CACHE_ENVELOPE_VERSION, decodeSerializedFeedCache);
        if (!env.ok) return;

        // Reuse loadCache logic by re-parsing via decoder pipeline
        const loaded = loadCache(storage);
        if (loaded.ok) setState(loaded.value.state);
      } catch {
        // ignore
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  const actions: SigilMarketsFeedActions = useMemo(() => {
    const hydrateFromCache = (): void => {
      const loaded = loadCache(storage);
      if (!loaded.ok) {
        setState((s) => ({ ...s, status: "error", error: loaded.error }));
        return;
      }
      setState(loaded.value.state);
    };

    const addProphecy = (input: CreateProphecyInput): ProphecyRecord => {
      const id = asProphecyId(genId("prophecy"));
      const visibility: ProphecyVisibility = input.visibility ?? "public";

      const rec: ProphecyRecord = {
        id,
        kind: "sealed-prediction",
        marketId: input.marketId,
        side: input.side,
        createdAt: input.createdAt,
        author: input.author,
        visibility,
        note: input.note,
        positionId: input.positionId,
        sigil: input.sigil,
        resolution: undefined,
        updatedPulse: input.createdAt.pulse,
      };

      setAndMaybePersist(
        (prev) => {
          const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById, [id as unknown as string]: rec };
          const prophecyIds = sortProphecyIds(byId);
          return {
            ...prev,
            propheciesById: byId,
            prophecyIds,
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

    const upsertProphecies = (prophecies: readonly ProphecyRecord[], opts?: Readonly<{ lastUpdatedPulse?: KaiPulse }>): void => {
      if (prophecies.length === 0) return;

      setAndMaybePersist(
        (prev) => {
          const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById };
          let maxPulse = prev.lastUpdatedPulse ?? 0;

          for (const p of prophecies) {
            byId[p.id as unknown as string] = p;
            maxPulse = Math.max(maxPulse, p.updatedPulse);
          }

          const prophecyIds = sortProphecyIds(byId);
          return {
            ...prev,
            propheciesById: byId,
            prophecyIds,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: opts?.lastUpdatedPulse ?? maxPulse,
            cacheSavedAtMs: nowMs(),
          };
        },
        true,
      );
    };

    const removeProphecy = (id: ProphecyId): void => {
      const key = id as unknown as string;
      setAndMaybePersist(
        (prev) => {
          if (!prev.propheciesById[key]) return prev;
          const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById };
          delete byId[key];
          const prophecyIds = prev.prophecyIds.filter((x) => (x as unknown as string) !== key);
          return { ...prev, propheciesById: byId, prophecyIds };
        },
        true,
      );
    };

    const attachProphecySigil = (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse): PersistResult<ProphecyRecord> => {
      const key = id as unknown as string;
      let out: ProphecyRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const p = prev.propheciesById[key];
          if (!p) {
            err = "prophecy not found";
            return prev;
          }
          const next: ProphecyRecord = { ...p, sigil, updatedPulse: Math.max(p.updatedPulse, updatedPulse) };
          out = next;

          const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById, [key]: next };
          const prophecyIds = sortProphecyIds(byId);

          return {
            ...prev,
            propheciesById: byId,
            prophecyIds,
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

    const applyMarketResolutionToProphecies = (req: Readonly<{
      marketId: MarketId;
      outcome: MarketOutcome;
      resolvedPulse: KaiPulse;
      evidenceHashes?: readonly EvidenceHash[];
    }>): Readonly<{ updated: number; prophecies: readonly ProphecyRecord[] }> => {
      const updated: ProphecyRecord[] = [];
      let count = 0;

      setAndMaybePersist(
        (prev) => {
          let changed = false;
          const byId: Record<string, ProphecyRecord> = { ...prev.propheciesById };

          for (const [id, p] of Object.entries(prev.propheciesById)) {
            if ((p.marketId as unknown as string) !== (req.marketId as unknown as string)) continue;
            if (p.resolution) continue; // already applied

            let status: ProphecyStatus = "sealed";
            if (req.outcome === "VOID") status = "void";
            else status = p.side === req.outcome ? "fulfilled" : "missed";

            const next: ProphecyRecord = {
              ...p,
              resolution: {
                outcome: req.outcome,
                resolvedPulse: req.resolvedPulse,
                status,
                evidenceHashes: req.evidenceHashes ? [...req.evidenceHashes] : undefined,
              },
              updatedPulse: Math.max(p.updatedPulse, req.resolvedPulse),
            };

            byId[id] = next;
            updated.push(next);
            count += 1;
            changed = true;
          }

          if (!changed) return prev;

          const prophecyIds = sortProphecyIds(byId);
          return {
            ...prev,
            propheciesById: byId,
            prophecyIds,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, req.resolvedPulse),
            status: "ready",
            error: undefined,
          };
        },
        true,
      );

      return { updated: count, prophecies: updated };
    };

    const appendMarketActivity = (req: Readonly<{
      marketId: MarketId;
      events: readonly MarketActivityEvent[];
      capPerMarket?: number;
      globalCap?: number;
      updatedPulse: KaiPulse;
    }>): Readonly<{ added: number }> => {
      const capPerMarket = req.capPerMarket ?? DEFAULT_ACTIVITY_CAP_PER_MARKET;
      const globalCap = req.globalCap ?? DEFAULT_GLOBAL_ACTIVITY_CAP;

      let added = 0;

      setAndMaybePersist(
        (prev) => {
          if (req.events.length === 0) return prev;

          const mid = req.marketId as unknown as string;
          const existing = prev.activityByMarketId[mid] ?? [];
          const seen = new Set<string>(existing.map(activityKey));

          const appended: MarketActivityEvent[] = [...existing];
          for (const e of req.events) {
            const k = activityKey(e);
            if (seen.has(k)) continue;
            seen.add(k);
            appended.push(e);
            added += 1;
          }

          // sort by atPulse ascending (timeline), but keep stable within pulse
          appended.sort((a, b) => a.atPulse - b.atPulse);

          const cappedPerMarket = appended.length > capPerMarket ? appended.slice(appended.length - capPerMarket) : appended;

          const activityByMarketId: Record<string, readonly MarketActivityEvent[]> = {
            ...prev.activityByMarketId,
            [mid]: cappedPerMarket,
          };

          // global activity: append and cap (descending feel)
          const globalSeen = new Set<string>(prev.globalActivity.map(activityKey));
          const global: MarketActivityEvent[] = [...prev.globalActivity];

          for (const e of req.events) {
            const k = activityKey(e);
            if (globalSeen.has(k)) continue;
            globalSeen.add(k);
            global.push(e);
          }
          global.sort((a, b) => a.atPulse - b.atPulse);
          const cappedGlobal = global.length > globalCap ? global.slice(global.length - globalCap) : global;

          return {
            ...prev,
            activityByMarketId,
            globalActivity: cappedGlobal,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, req.updatedPulse),
            status: "ready",
            error: undefined,
          };
        },
        true,
      );

      return { added };
    };

    const clearAll = (): void => {
      setState(defaultFeedState());
      removeFromStorage(SM_FEED_KEY, storage);
    };

    const clearCache = (): void => {
      removeFromStorage(SM_FEED_KEY, storage);
      setState((prev) => ({ ...prev, cacheSavedAtMs: undefined }));
    };

    const persistNow = (): void => {
      if (!storage) return;
      persistCache(storage, state);
    };

    const setStatus = (status: FeedStoreStatus, error?: string): void => {
      setState((prev) => ({ ...prev, status, error }));
    };

    return {
      hydrateFromCache,
      addProphecy,
      upsertProphecies,
      removeProphecy,
      attachProphecySigil,
      applyMarketResolutionToProphecies,
      appendMarketActivity,
      clearAll,
      clearCache,
      persistNow,
      setStatus,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, state]);

  const store = useMemo<SigilMarketsFeedStore>(() => ({ state, actions }), [state, actions]);

  return <SigilMarketsFeedContext.Provider value={store}>{props.children}</SigilMarketsFeedContext.Provider>;
};

export const useSigilMarketsFeedStore = (): SigilMarketsFeedStore => {
  const ctx = React.useContext(SigilMarketsFeedContext);
  if (!ctx) throw new Error("useSigilMarketsFeedStore must be used within <SigilMarketsFeedProvider>");
  return ctx;
};

/** Convenience selectors */
export const useProphecyFeed = (): readonly ProphecyRecord[] => {
  const { state } = useSigilMarketsFeedStore();
  return state.prophecyIds
    .map((id) => state.propheciesById[id as unknown as string])
    .filter((p): p is ProphecyRecord => p !== undefined);
};

export const useMarketActivity = (marketId: MarketId): readonly MarketActivityEvent[] => {
  const { state } = useSigilMarketsFeedStore();
  return state.activityByMarketId[marketId as unknown as string] ?? [];
};

export const useGlobalActivity = (): readonly MarketActivityEvent[] => useSigilMarketsFeedStore().state.globalActivity;
