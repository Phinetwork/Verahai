"use client";

/**
 * SigilMarkets — vaultStore
 *
 * Responsibilities:
 * - Hold vault records (value bound to Identity Sigil)
 * - Maintain lock escrow invariants (lockedMicro = sum(locks where status="locked"))
 * - Support deposit/withdraw and lock transitions
 * - Persist offline-first to local storage
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type ReactNode,
} from "react";

import {
  SM_VAULTS_KEY,
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

import type { KaiMoment, KaiPulse, LockId, PhiMicro, VaultId } from "../types/marketTypes";
import { asVaultId } from "../types/marketTypes";

import {
  asCanonicalHash,
  asIdentitySigilId,
  asKaiSignature,
  asMicroDecimalString,
  asSvgHash,
  asUserPhiKey,
  type CanonicalHash,
  type IdentitySigilId,
  type KaiSignature,
  type MicroDecimalString,
  type SerializedVaultRecord,
  type SvgHash,
  type UserPhiKey,
  type VaultLock,
  type VaultLockReason,
  type VaultLockStatus,
  type VaultRecord,
  type VaultStatus,
  type ZkProofRef,
} from "../types/vaultTypes";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

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

const calcLockedMicro = (locks: readonly VaultLock[]): PhiMicro => {
  let sum = 0n;
  for (const l of locks) {
    if (l.status === "locked") sum += l.amountMicro;
  }
  return normalizePhi(sum);
};

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const sortVaultIds = (byId: Readonly<Record<string, VaultRecord>>): VaultId[] => {
  const arr: Array<{ id: string; p: number }> = [];
  for (const [id, v] of Object.entries(byId)) {
    arr.push({ id, p: v.updatedPulse ?? 0 });
  }
  arr.sort((a, b) => {
    if (b.p !== a.p) return b.p - a.p;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return arr.map((x) => asVaultId(x.id));
};

const vaultKey = (id: VaultId): string => String(id);

/** ------------------------------
 * Cache shapes
 * ------------------------------ */

type SerializedVaultCache = Readonly<{
  byId: Readonly<Record<string, SerializedVaultRecord>>;
  ids: readonly string[];
  activeVaultId?: string;
  lastUpdatedPulse?: KaiPulse;
}>;

const CACHE_ENVELOPE_VERSION = 1;

const decodeSerializedVaultRecord: Decoder<SerializedVaultRecord> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "vault: not object" };

  const vaultId = v["vaultId"];
  if (!isString(vaultId) || vaultId.length === 0) return { ok: false, error: "vaultId: bad" };

  const ownerRaw = v["owner"];
  if (!isRecord(ownerRaw)) return { ok: false, error: "owner: bad" };

  const userPhiKey = ownerRaw["userPhiKey"];
  const kaiSignature = ownerRaw["kaiSignature"];
  if (!isString(userPhiKey) || userPhiKey.length === 0) return { ok: false, error: "owner.userPhiKey: bad" };
  if (!isString(kaiSignature) || kaiSignature.length === 0) return { ok: false, error: "owner.kaiSignature: bad" };

  const status = v["status"];
  const okStatus: VaultStatus = status === "frozen" ? "frozen" : "active";

  const spendable = parseBigIntDec(v["spendableMicro"]);
  const locked = parseBigIntDec(v["lockedMicro"]);
  if (spendable === null || locked === null) return { ok: false, error: "balances: bad micros" };

  const locksRaw = v["locks"];
  const locks: Array<SerializedVaultRecord["locks"][number]> = [];
  if (isArray(locksRaw)) {
    for (const item of locksRaw) {
      if (!isRecord(item)) continue;

      const lockId = item["lockId"];
      const lStatus = item["status"];
      const reason = item["reason"];
      const amount = parseBigIntDec(item["amountMicro"]);
      const createdAt = item["createdAt"];
      const updatedPulse = item["updatedPulse"];

      if (!isString(lockId) || lockId.length === 0) continue;
      if (
        lStatus !== "locked" &&
        lStatus !== "released" &&
        lStatus !== "burned" &&
        lStatus !== "paid" &&
        lStatus !== "refunded"
      )
        continue;
      if (!isString(reason) || reason.length === 0) continue;
      if (amount === null) continue;
      if (!isRecord(createdAt)) continue;

      const pulse = createdAt["pulse"];
      const beat = createdAt["beat"];
      const stepIndex = createdAt["stepIndex"];
      if (!isNumber(pulse) || !isNumber(beat) || !isNumber(stepIndex)) continue;
      if (!isNumber(updatedPulse)) continue;

      locks.push({
        lockId: lockId as unknown as LockId,
        status: lStatus,
        reason: reason as VaultLockReason,
        amountMicro: biToDec(amount),
        createdAt: { pulse: Math.floor(pulse), beat: Math.floor(beat), stepIndex: Math.floor(stepIndex) },
        updatedPulse: Math.floor(updatedPulse),
        marketId: isString(item["marketId"]) ? item["marketId"] : undefined,
        positionId: isString(item["positionId"]) ? item["positionId"] : undefined,
        note: isString(item["note"]) ? item["note"] : undefined,
      });
    }
  }

  // owner.identitySigil (optional)
  const identitySigilRaw = ownerRaw["identitySigil"];
  const identitySigil =
    isRecord(identitySigilRaw) && isString(identitySigilRaw["svgHash"])
      ? {
          sigilId: isString(identitySigilRaw["sigilId"])
            ? asIdentitySigilId(identitySigilRaw["sigilId"])
            : undefined,
          svgHash: asSvgHash(identitySigilRaw["svgHash"]),
          url: isString(identitySigilRaw["url"]) ? identitySigilRaw["url"] : undefined,
          canonicalHash: isString(identitySigilRaw["canonicalHash"])
            ? asCanonicalHash(identitySigilRaw["canonicalHash"].toLowerCase())
            : undefined,
          valuePhiMicro: (() => {
            const parsed = parseBigIntDec(identitySigilRaw["valuePhiMicro"]);
            return parsed === null ? undefined : biToDec(parsed);
          })(),
          availablePhiMicro: (() => {
            const parsed = parseBigIntDec(identitySigilRaw["availablePhiMicro"]);
            return parsed === null ? undefined : biToDec(parsed);
          })(),
          lastValuedPulse: isNumber(identitySigilRaw["lastValuedPulse"])
            ? Math.max(0, Math.floor(identitySigilRaw["lastValuedPulse"]))
            : undefined,
        }
      : undefined;

  const zkProofRef = isString(ownerRaw["zkProofRef"])
    ? (ownerRaw["zkProofRef"] as unknown as ZkProofRef)
    : undefined;

  const statsRaw = v["stats"];
  const stats =
    isRecord(statsRaw)
      ? {
          winStreak: isNumber(statsRaw["winStreak"]) ? clampInt(statsRaw["winStreak"], 0, 1_000_000) : 0,
          lossStreak: isNumber(statsRaw["lossStreak"]) ? clampInt(statsRaw["lossStreak"], 0, 1_000_000) : 0,
          totalWins: isNumber(statsRaw["totalWins"]) ? clampInt(statsRaw["totalWins"], 0, 1_000_000_000) : 0,
          totalLosses: isNumber(statsRaw["totalLosses"]) ? clampInt(statsRaw["totalLosses"], 0, 1_000_000_000) : 0,
          totalClaims: isNumber(statsRaw["totalClaims"]) ? clampInt(statsRaw["totalClaims"], 0, 1_000_000_000) : 0,
          totalRefunds: isNumber(statsRaw["totalRefunds"]) ? clampInt(statsRaw["totalRefunds"], 0, 1_000_000_000) : 0,
          lastOutcomePulse: isNumber(statsRaw["lastOutcomePulse"])
            ? Math.max(0, Math.floor(statsRaw["lastOutcomePulse"]))
            : undefined,
        }
      : undefined;

  const createdPulse = isNumber(v["createdPulse"]) ? Math.max(0, Math.floor(v["createdPulse"])) : 0;
  const updatedPulse = isNumber(v["updatedPulse"]) ? Math.max(0, Math.floor(v["updatedPulse"])) : createdPulse;

  const out: SerializedVaultRecord = {
    vaultId: asVaultId(vaultId),
    owner: {
      userPhiKey: asUserPhiKey(userPhiKey),
      kaiSignature: asKaiSignature(kaiSignature),
      zkProofRef,
      identitySigil,
    },
    status: okStatus,
    spendableMicro: biToDec(spendable),
    lockedMicro: biToDec(locked),
    locks,
    stats,
    createdPulse,
    updatedPulse,
  };

  return { ok: true, value: out };
};

const decodeSerializedVaultCache: Decoder<SerializedVaultCache> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "cache: not object" };
  const byIdRaw = v["byId"];
  const idsRaw = v["ids"];
  if (!isRecord(byIdRaw)) return { ok: false, error: "cache.byId: bad" };
  if (!isArray(idsRaw)) return { ok: false, error: "cache.ids: bad" };

  const byId: Record<string, SerializedVaultRecord> = {};
  for (const [k, vv] of Object.entries(byIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    const dv = decodeSerializedVaultRecord(vv);
    if (dv.ok) byId[k] = dv.value;
  }

  const ids = idsRaw.filter((x): x is string => isString(x) && x.length > 0);
  const activeVaultId = isString(v["activeVaultId"]) ? v["activeVaultId"] : undefined;
  const lastUpdatedPulse = isNumber(v["lastUpdatedPulse"]) ? Math.max(0, Math.floor(v["lastUpdatedPulse"])) : undefined;

  return { ok: true, value: { byId, ids, activeVaultId, lastUpdatedPulse } };
};

const deserializeVaultRecord = (v: SerializedVaultRecord): VaultRecord => {
  const locks: VaultLock[] = v.locks.map((l) => ({
    lockId: l.lockId,
    status: l.status as VaultLockStatus,
    reason: l.reason,
    amountMicro: normalizePhi(parseBigIntDec(l.amountMicro) ?? 0n),
    createdAt: l.createdAt,
    updatedPulse: l.updatedPulse,
    marketId: l.marketId,
    positionId: l.positionId,
    note: l.note,
  }));

  // lock invariant: lockedMicro must match locks
  const lockedMicro = calcLockedMicro(locks);
  const spendableMicro = normalizePhi(parseBigIntDec(v.spendableMicro) ?? 0n);

  return {
    vaultId: v.vaultId,
    owner: {
      userPhiKey: v.owner.userPhiKey,
      kaiSignature: v.owner.kaiSignature,
      zkProofRef: v.owner.zkProofRef,
      identitySigil: v.owner.identitySigil
        ? {
            sigilId: v.owner.identitySigil.sigilId,
            svgHash: v.owner.identitySigil.svgHash,
            url: v.owner.identitySigil.url,
            canonicalHash: v.owner.identitySigil.canonicalHash,
            valuePhiMicro:
              v.owner.identitySigil.valuePhiMicro !== undefined
                ? normalizePhi(parseBigIntDec(v.owner.identitySigil.valuePhiMicro) ?? 0n)
                : undefined,
            availablePhiMicro:
              v.owner.identitySigil.availablePhiMicro !== undefined
                ? normalizePhi(parseBigIntDec(v.owner.identitySigil.availablePhiMicro) ?? 0n)
                : undefined,
            lastValuedPulse: v.owner.identitySigil.lastValuedPulse,
          }
        : undefined,
    },
    status: v.status,
    spendableMicro,
    lockedMicro,
    locks,
    stats: v.stats,
    createdPulse: v.createdPulse,
    updatedPulse: v.updatedPulse,
  };
};

const serializeVaultRecord = (v: VaultRecord): SerializedVaultRecord => {
  const lockedMicro = calcLockedMicro(v.locks);
  return {
    vaultId: v.vaultId,
    owner: {
      ...v.owner,
      identitySigil: v.owner.identitySigil
        ? {
            sigilId: v.owner.identitySigil.sigilId,
            svgHash: v.owner.identitySigil.svgHash,
            url: v.owner.identitySigil.url,
            canonicalHash: v.owner.identitySigil.canonicalHash,
            valuePhiMicro: v.owner.identitySigil.valuePhiMicro !== undefined ? biToDec(v.owner.identitySigil.valuePhiMicro) : undefined,
            availablePhiMicro: v.owner.identitySigil.availablePhiMicro !== undefined ? biToDec(v.owner.identitySigil.availablePhiMicro) : undefined,
            lastValuedPulse: v.owner.identitySigil.lastValuedPulse,
          }
        : undefined,
    },
    status: v.status,
    spendableMicro: biToDec(v.spendableMicro),
    lockedMicro: biToDec(lockedMicro),
    locks: v.locks.map((l) => ({
      lockId: l.lockId,
      status: l.status,
      reason: l.reason,
      amountMicro: biToDec(l.amountMicro),
      createdAt: l.createdAt,
      updatedPulse: l.updatedPulse,
      marketId: l.marketId,
      positionId: l.positionId,
      note: l.note,
    })),
    stats: v.stats,
    createdPulse: v.createdPulse,
    updatedPulse: v.updatedPulse,
  };
};

const loadCache = (
  storage: StorageLike | null,
): PersistResult<Readonly<{ state: SigilMarketsVaultState; savedAtMs?: number }>> => {
  const res = loadFromStorage(
    SM_VAULTS_KEY,
    (raw) => decodeEnvelope(raw, CACHE_ENVELOPE_VERSION, decodeSerializedVaultCache),
    storage,
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (res.value === null) return { ok: true, value: { state: defaultVaultState(), savedAtMs: undefined } };

  const env = res.value;
  const cache = env.data;

  const byId: Record<string, VaultRecord> = {};
  for (const [id, sv] of Object.entries(cache.byId)) {
    byId[id] = deserializeVaultRecord(sv);
  }

  const idsFromCache = cache.ids.filter((id: string) => byId[id] !== undefined).map((id: string) => asVaultId(id));
  const ids = idsFromCache.length > 0 ? idsFromCache : sortVaultIds(byId);

  const activeVaultId = cache.activeVaultId && byId[cache.activeVaultId] ? asVaultId(cache.activeVaultId) : null;

  const state: SigilMarketsVaultState = {
    byId,
    ids,
    activeVaultId,
    status: "ready",
    error: undefined,
    lastUpdatedPulse: cache.lastUpdatedPulse,
    cacheSavedAtMs: env.savedAtMs,
  };

  return { ok: true, value: { state, savedAtMs: env.savedAtMs } };
};

const persistCache = (storage: StorageLike | null, state: SigilMarketsVaultState): void => {
  if (!storage) return;

  const byId: Record<string, SerializedVaultRecord> = {};
  for (const [id, v] of Object.entries(state.byId)) {
    byId[id] = serializeVaultRecord(v);
  }

  const data: SerializedVaultCache = {
    byId,
    ids: state.ids.map((id: VaultId) => vaultKey(id)),
    activeVaultId: state.activeVaultId ? vaultKey(state.activeVaultId) : undefined,
    lastUpdatedPulse: state.lastUpdatedPulse,
  };

  const env = wrapEnvelope(data as unknown as never, CACHE_ENVELOPE_VERSION);
  saveToStorage(SM_VAULTS_KEY, env, storage);
};

/** ------------------------------
 * Store
 * ------------------------------ */

export type VaultStoreStatus = "idle" | "loading" | "ready" | "error";

export type SigilMarketsVaultState = Readonly<{
  byId: Readonly<Record<string, VaultRecord>>;
  ids: readonly VaultId[];
  activeVaultId: VaultId | null;

  status: VaultStoreStatus;
  error?: string;

  lastUpdatedPulse?: KaiPulse;
  cacheSavedAtMs?: number;
}>;

const defaultVaultState = (): SigilMarketsVaultState => ({
  byId: {},
  ids: [],
  activeVaultId: null,
  status: "idle",
  error: undefined,
  lastUpdatedPulse: undefined,
  cacheSavedAtMs: undefined,
});

export type CreateOrActivateVaultInput = Readonly<{
  vaultId: VaultId;

  owner: Readonly<{
    userPhiKey: UserPhiKey;
    kaiSignature: KaiSignature;
    zkProofRef?: ZkProofRef;
    identitySigil?: Readonly<{
      sigilId?: IdentitySigilId;
      svgHash: SvgHash;
      url?: string;
      canonicalHash?: CanonicalHash;
      valuePhiMicro?: PhiMicro;
      availablePhiMicro?: PhiMicro;
      lastValuedPulse?: KaiPulse;
    }>;
  }>;

  /** If absent, vault starts at 0. */
  initialSpendableMicro?: PhiMicro;

  createdPulse: KaiPulse;
}>;

export type SigilMarketsVaultActions = Readonly<{
  hydrateFromCache: () => void;

  /** Create the vault if missing, and make it active. */
  createOrActivateVault: (input: CreateOrActivateVaultInput) => VaultRecord;

  /** Apply a remote snapshot (authoritative balances/status) into local state. */
  applyVaultSnapshot: (snapshot: VaultRecord, opts?: Readonly<{ activate?: boolean }>) => VaultRecord;

  setActiveVault: (vaultId: VaultId | null) => void;

  /** Deposit/withdraw to spendable balance (fails safely if insufficient). */
  moveValue: (req: Readonly<{ vaultId: VaultId; kind: "deposit" | "withdraw"; amountMicro: PhiMicro; atPulse: KaiPulse }>) => PersistResult<VaultRecord>;

  /** Add a new escrow lock (fails if insufficient spendable). */
  openLock: (req: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    amountMicro: PhiMicro;
    reason: VaultLockReason;
    createdAt: KaiMoment;
    updatedPulse: KaiPulse;
    marketId?: string;
    positionId?: string;
    note?: string;
  }>) => PersistResult<VaultRecord>;

  /** Transition a lock status; if lock was "locked", adjust balances accordingly. */
  transitionLock: (req: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    toStatus: VaultLockStatus;
    reason: VaultLockReason;
    updatedPulse: KaiPulse;
    note?: string;
  }>) => PersistResult<VaultRecord>;

  /** Update streak stats (called by position outcomes). */
  applyOutcomeStats: (req: Readonly<{
    vaultId: VaultId;
    outcome: "win" | "loss" | "refund";
    atPulse: KaiPulse;
  }>) => PersistResult<VaultRecord>;

  removeVault: (vaultId: VaultId) => void;

  clearAll: () => void;
  clearCache: () => void;
  persistNow: () => void;

  setStatus: (status: VaultStoreStatus, error?: string) => void;
}>;

export type SigilMarketsVaultStore = Readonly<{
  state: SigilMarketsVaultState;
  actions: SigilMarketsVaultActions;
}>;

const SigilMarketsVaultContext = createContext<SigilMarketsVaultStore | null>(null);

export const SigilMarketsVaultProvider = (props: Readonly<{ children: ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);
  const [state, setState] = useState<SigilMarketsVaultState>(() => {
    const loaded = loadCache(storage);
    if (loaded.ok) return loaded.value.state;
    return defaultVaultState();
  });

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistMsRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = null;
    };
  }, []);

  const schedulePersist = useCallback(
    (next: SigilMarketsVaultState) => {
      if (!storage) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);

      persistTimer.current = setTimeout(() => {
        const t = nowMs();
        if (t - lastPersistMsRef.current < 350) return;
        lastPersistMsRef.current = t;
        persistCache(storage, next);
      }, 250);
    },
    [storage],
  );

  const setAndMaybePersist = useCallback(
    (updater: (prev: SigilMarketsVaultState) => SigilMarketsVaultState, persist: boolean) => {
      setState((prev) => {
        const next = updater(prev);
        if (persist) schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  // Cross-tab sync
  useEffect(() => {
    if (!storage || typeof window === "undefined") return;

    const onStorage = (e: StorageEvent): void => {
      if (e.key !== SM_VAULTS_KEY) return;
      if (e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const env = decodeEnvelope(parsed, CACHE_ENVELOPE_VERSION, decodeSerializedVaultCache);
        if (!env.ok) return;

        const byId: Record<string, VaultRecord> = {};
        for (const [id, sv] of Object.entries(env.value.data.byId)) {
          byId[id] = deserializeVaultRecord(sv);
        }

        const idsFromCache = env.value.data.ids
          .filter((id: string) => byId[id] !== undefined)
          .map((id: string) => asVaultId(id));
        const ids = idsFromCache.length > 0 ? idsFromCache : sortVaultIds(byId);

        const activeVaultId =
          env.value.data.activeVaultId && byId[env.value.data.activeVaultId]
            ? asVaultId(env.value.data.activeVaultId)
            : null;

        setState({
          byId,
          ids,
          activeVaultId,
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

  const actions: SigilMarketsVaultActions = useMemo(() => {
    const hydrateFromCache = (): void => {
      const loaded = loadCache(storage);
      if (!loaded.ok) {
        setState((s) => ({ ...s, status: "error", error: loaded.error }));
        return;
      }
      setState(loaded.value.state);
    };

    const setActiveVault = (vaultId: VaultId | null): void => {
      setAndMaybePersist((s) => ({ ...s, activeVaultId: vaultId }), true);
    };

    const createOrActivateVault = (input: CreateOrActivateVaultInput): VaultRecord => {
      const key = vaultKey(input.vaultId);
      let created: VaultRecord | null = null;

      setAndMaybePersist(
        (prev) => {
          const existing = prev.byId[key];
          if (existing) {
            const nextIdentitySigil = input.owner.identitySigil
              ? {
                  ...existing.owner.identitySigil,
                  sigilId: input.owner.identitySigil.sigilId ?? existing.owner.identitySigil?.sigilId,
                  svgHash: input.owner.identitySigil.svgHash,
                  url: input.owner.identitySigil.url ?? existing.owner.identitySigil?.url,
                  canonicalHash: input.owner.identitySigil.canonicalHash ?? existing.owner.identitySigil?.canonicalHash,
                  valuePhiMicro: input.owner.identitySigil.valuePhiMicro ?? existing.owner.identitySigil?.valuePhiMicro,
                  availablePhiMicro:
                    input.owner.identitySigil.availablePhiMicro ?? existing.owner.identitySigil?.availablePhiMicro,
                  lastValuedPulse:
                    input.owner.identitySigil.lastValuedPulse ?? existing.owner.identitySigil?.lastValuedPulse,
                }
              : existing.owner.identitySigil;

            const nextOwner = {
              ...existing.owner,
              userPhiKey: input.owner.userPhiKey,
              kaiSignature: input.owner.kaiSignature,
              zkProofRef: input.owner.zkProofRef ?? existing.owner.zkProofRef,
              identitySigil: nextIdentitySigil,
            };

            const updated = nextOwner === existing.owner ? existing : { ...existing, owner: nextOwner };
            created = updated;

            const ids = prev.ids.includes(input.vaultId) ? prev.ids : [input.vaultId, ...prev.ids];

            return {
              ...prev,
              byId: updated === existing ? prev.byId : { ...prev.byId, [key]: updated },
              ids,
              activeVaultId: input.vaultId,
              status: "ready",
              error: undefined,
              lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, updated.updatedPulse),
            };
          }

          const spendableMicro = input.initialSpendableMicro ?? (0n as PhiMicro);

          const v: VaultRecord = {
            vaultId: input.vaultId,
            owner: {
              userPhiKey: input.owner.userPhiKey,
              kaiSignature: input.owner.kaiSignature,
              zkProofRef: input.owner.zkProofRef,
              identitySigil: input.owner.identitySigil
                ? {
                    sigilId: input.owner.identitySigil.sigilId,
                    svgHash: input.owner.identitySigil.svgHash,
                    url: input.owner.identitySigil.url,
                    canonicalHash: input.owner.identitySigil.canonicalHash,
                    valuePhiMicro: input.owner.identitySigil.valuePhiMicro,
                    availablePhiMicro: input.owner.identitySigil.availablePhiMicro,
                    lastValuedPulse: input.owner.identitySigil.lastValuedPulse,
                  }
                : undefined,
            },
            status: "active",
            spendableMicro: normalizePhi(spendableMicro),
            lockedMicro: 0n as PhiMicro,
            locks: [],
            stats: {
              winStreak: 0,
              lossStreak: 0,
              totalWins: 0,
              totalLosses: 0,
              totalClaims: 0,
              totalRefunds: 0,
            },
            createdPulse: input.createdPulse,
            updatedPulse: input.createdPulse,
          };

          created = v;

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: v };
          const ids = [input.vaultId, ...prev.ids];

          return {
            ...prev,
            byId,
            ids,
            activeVaultId: input.vaultId,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, input.createdPulse),
          };
        },
        true,
      );

      return (
        created ?? {
          vaultId: input.vaultId,
          owner: input.owner as unknown as VaultRecord["owner"],
          status: "active",
          spendableMicro: normalizePhi(input.initialSpendableMicro ?? 0n),
          lockedMicro: 0n as PhiMicro,
          locks: [],
          createdPulse: input.createdPulse,
          updatedPulse: input.createdPulse,
        }
      );
    };

    const applyVaultSnapshot = (snapshot: VaultRecord, opts?: Readonly<{ activate?: boolean }>): VaultRecord => {
      const key = vaultKey(snapshot.vaultId);
      let updated: VaultRecord = snapshot;

      setAndMaybePersist(
        (prev) => {
          const existing = prev.byId[key];
          const mergedIdentitySigil = snapshot.owner.identitySigil ?? existing?.owner.identitySigil;
          const mergedLocks = snapshot.locks.length > 0 ? snapshot.locks : existing?.locks ?? snapshot.locks;
          const mergedStats = snapshot.stats ?? existing?.stats;

          updated = {
            ...snapshot,
            owner: {
              ...snapshot.owner,
              identitySigil: mergedIdentitySigil,
            },
            locks: mergedLocks,
            stats: mergedStats,
          };

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: updated };
          const ids = sortVaultIds(byId);

          return {
            ...prev,
            byId,
            ids,
            activeVaultId: opts?.activate === false ? prev.activeVaultId : snapshot.vaultId,
            status: "ready",
            error: undefined,
            lastUpdatedPulse: Math.max(prev.lastUpdatedPulse ?? 0, updated.updatedPulse),
          };
        },
        true,
      );

      return updated;
    };

    const moveValue = (req: Readonly<{ vaultId: VaultId; kind: "deposit" | "withdraw"; amountMicro: PhiMicro; atPulse: KaiPulse }>): PersistResult<VaultRecord> => {
      const key = vaultKey(req.vaultId);
      const amt = normalizePhi(req.amountMicro);

      if (amt === 0n) return { ok: false, error: "amount must be > 0" };

      let out: VaultRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const v = prev.byId[key];
          if (!v) {
            err = "vault not found";
            return prev;
          }
          if (v.status === "frozen") {
            err = "vault frozen";
            return prev;
          }

          const spendable = v.spendableMicro;
          if (req.kind === "withdraw" && spendable < amt) {
            err = "insufficient spendable";
            return prev;
          }

          let nextIdentitySigil = v.owner.identitySigil;

          if (req.kind === "deposit") {
            const identity = v.owner.identitySigil;
            const available = identity?.availablePhiMicro;
            const baseValue = identity?.valuePhiMicro;
            const fallbackAvailable = available ?? baseValue;
            if (fallbackAvailable !== undefined && fallbackAvailable < amt) {
              err = "insufficient glyph balance";
              return prev;
            }
            if (identity) {
              const nextAvailable =
                fallbackAvailable !== undefined ? normalizePhi(fallbackAvailable - amt) : identity.availablePhiMicro;
              nextIdentitySigil = { ...identity, availablePhiMicro: nextAvailable };
            }
          }

          if (req.kind === "withdraw") {
            const identity = v.owner.identitySigil;
            if (identity) {
              const baseValue = identity.valuePhiMicro;
              const available = identity.availablePhiMicro ?? baseValue;
              if (available !== undefined) {
                const nextAvailableRaw = normalizePhi(available + amt);
                const nextAvailable =
                  baseValue !== undefined && nextAvailableRaw > baseValue ? normalizePhi(baseValue) : nextAvailableRaw;
                nextIdentitySigil = { ...identity, availablePhiMicro: nextAvailable };
              }
            }
          }

          const nextSpendable = req.kind === "deposit" ? normalizePhi(spendable + amt) : normalizePhi(spendable - amt);

          const next: VaultRecord = {
            ...v,
            owner: {
              ...v.owner,
              identitySigil: nextIdentitySigil,
            },
            spendableMicro: nextSpendable,
            lockedMicro: calcLockedMicro(v.locks),
            updatedPulse: Math.max(v.updatedPulse, req.atPulse),
          };

          out = next;

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: next };
          const ids = sortVaultIds(byId);

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

    const openLock = (req: Readonly<{
      vaultId: VaultId;
      lockId: LockId;
      amountMicro: PhiMicro;
      reason: VaultLockReason;
      createdAt: KaiMoment;
      updatedPulse: KaiPulse;
      marketId?: string;
      positionId?: string;
      note?: string;
    }>): PersistResult<VaultRecord> => {
      const key = vaultKey(req.vaultId);
      const amt = normalizePhi(req.amountMicro);
      if (amt === 0n) return { ok: false, error: "lock amount must be > 0" };

      let out: VaultRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const v = prev.byId[key];
          if (!v) {
            err = "vault not found";
            return prev;
          }
          if (v.status === "frozen") {
            err = "vault frozen";
            return prev;
          }
          if (v.spendableMicro < amt) {
            err = "insufficient spendable";
            return prev;
          }

          if (v.locks.some((l) => l.lockId === req.lockId)) {
            err = "duplicate lockId";
            return prev;
          }

          const newLock: VaultLock = {
            lockId: req.lockId,
            status: "locked",
            reason: req.reason,
            amountMicro: amt,
            createdAt: req.createdAt,
            updatedPulse: req.updatedPulse,
            marketId: req.marketId,
            positionId: req.positionId,
            note: req.note,
          };

          const locks = [...v.locks, newLock];
          const lockedMicro = calcLockedMicro(locks);

          const next: VaultRecord = {
            ...v,
            spendableMicro: normalizePhi(v.spendableMicro - amt),
            lockedMicro,
            locks,
            updatedPulse: Math.max(v.updatedPulse, req.updatedPulse),
          };

          out = next;

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: next };
          const ids = sortVaultIds(byId);

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

    const transitionLock = (req: Readonly<{
      vaultId: VaultId;
      lockId: LockId;
      toStatus: VaultLockStatus;
      reason: VaultLockReason;
      updatedPulse: KaiPulse;
      note?: string;
    }>): PersistResult<VaultRecord> => {
      const key = vaultKey(req.vaultId);

      let out: VaultRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const v = prev.byId[key];
          if (!v) {
            err = "vault not found";
            return prev;
          }

          const idx = v.locks.findIndex((l) => l.lockId === req.lockId);
          if (idx < 0) {
            err = "lock not found";
            return prev;
          }

          const lock = v.locks[idx];
          const wasLocked = lock.status === "locked";

          const nextLock: VaultLock = {
            ...lock,
            status: req.toStatus,
            reason: req.reason,
            updatedPulse: req.updatedPulse,
            note: req.note ?? lock.note,
          };

          const locks = v.locks.slice();
          locks[idx] = nextLock;

          let spendable = v.spendableMicro;
          if (wasLocked && req.toStatus === "released") {
            spendable = normalizePhi(spendable + lock.amountMicro);
          }

          const lockedMicro = calcLockedMicro(locks);

          const next: VaultRecord = {
            ...v,
            spendableMicro: spendable,
            lockedMicro,
            locks,
            updatedPulse: Math.max(v.updatedPulse, req.updatedPulse),
          };

          out = next;

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: next };
          const ids = sortVaultIds(byId);

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

    const applyOutcomeStats = (req: Readonly<{ vaultId: VaultId; outcome: "win" | "loss" | "refund"; atPulse: KaiPulse }>): PersistResult<VaultRecord> => {
      const key = vaultKey(req.vaultId);

      let out: VaultRecord | null = null;
      let err: string | null = null;

      setAndMaybePersist(
        (prev) => {
          const v = prev.byId[key];
          if (!v) {
            err = "vault not found";
            return prev;
          }

          const s = v.stats ?? {
            winStreak: 0,
            lossStreak: 0,
            totalWins: 0,
            totalLosses: 0,
            totalClaims: 0,
            totalRefunds: 0,
          };

          let nextStats = { ...s, lastOutcomePulse: req.atPulse };

          if (req.outcome === "win") {
            nextStats = {
              ...nextStats,
              winStreak: s.winStreak + 1,
              lossStreak: 0,
              totalWins: s.totalWins + 1,
              totalClaims: s.totalClaims + 1,
            };
          } else if (req.outcome === "loss") {
            nextStats = {
              ...nextStats,
              winStreak: 0,
              lossStreak: s.lossStreak + 1,
              totalLosses: s.totalLosses + 1,
            };
          } else {
            nextStats = {
              ...nextStats,
              totalRefunds: s.totalRefunds + 1,
            };
          }

          const next: VaultRecord = {
            ...v,
            stats: nextStats,
            updatedPulse: Math.max(v.updatedPulse, req.atPulse),
          };

          out = next;

          const byId: Record<string, VaultRecord> = { ...prev.byId, [key]: next };
          const ids = sortVaultIds(byId);

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

    const removeVault = (vaultId: VaultId): void => {
      const key = vaultKey(vaultId);
      setAndMaybePersist(
        (prev) => {
          if (!prev.byId[key]) return prev;
          const byId: Record<string, VaultRecord> = { ...prev.byId };
          delete byId[key];
          const ids = prev.ids.filter((id: VaultId) => vaultKey(id) !== key);
          const activeVaultId = prev.activeVaultId && vaultKey(prev.activeVaultId) === key ? null : prev.activeVaultId;
          return { ...prev, byId, ids, activeVaultId };
        },
        true,
      );
    };

    const clearAll = (): void => {
      setState(defaultVaultState());
      removeFromStorage(SM_VAULTS_KEY, storage);
    };

    const clearCache = (): void => {
      removeFromStorage(SM_VAULTS_KEY, storage);
      setState((prev) => ({ ...prev, cacheSavedAtMs: undefined }));
    };

    const persistNow = (): void => {
      if (!storage) return;
      persistCache(storage, state);
    };

    const setStatus = (status: VaultStoreStatus, error?: string): void => {
      setState((prev) => ({ ...prev, status, error }));
    };

    return {
      hydrateFromCache,
      createOrActivateVault,
      applyVaultSnapshot,
      setActiveVault,
      moveValue,
      openLock,
      transitionLock,
      applyOutcomeStats,
      removeVault,
      clearAll,
      clearCache,
      persistNow,
      setStatus,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAndMaybePersist, storage, state]);

  const store = useMemo<SigilMarketsVaultStore>(() => ({ state, actions }), [state, actions]);

  return <SigilMarketsVaultContext.Provider value={store}>{props.children}</SigilMarketsVaultContext.Provider>;
};

export const useSigilMarketsVaultStore = (): SigilMarketsVaultStore => {
  const ctx = useContext(SigilMarketsVaultContext);
  if (!ctx) throw new Error("useSigilMarketsVaultStore must be used within <SigilMarketsVaultProvider>");
  return ctx;
};

export const useActiveVault = (): VaultRecord | null => {
  const { state } = useSigilMarketsVaultStore();
  if (!state.activeVaultId) return null;
  return state.byId[vaultKey(state.activeVaultId)] ?? null;
};

export const useVaultById = (vaultId: VaultId): VaultRecord | null => {
  const { state } = useSigilMarketsVaultStore();
  return state.byId[vaultKey(vaultId)] ?? null;
};
