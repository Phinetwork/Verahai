// SigilMarkets/api/cacheApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — cacheApi
 *
 * A small stale-while-revalidate JSON fetch cache:
 * - Memory cache (fast)
 * - Optional localStorage cache (offline-first)
 * - Deterministic keying (FNV-1a hash)
 *
 * No "any". Callers can provide a decoder for runtime validation.
 */

export type CachePolicy = Readonly<{
  /** Fresh window. If cached entry age <= maxAgeMs, it's "fresh". */
  maxAgeMs: number;
  /** Stale window. If fresh window expired but age <= staleWhileRevalidateMs, return stale and revalidate in background. */
  staleWhileRevalidateMs: number;
  /** If true, persist to localStorage (best effort). Default: true */
  persist?: boolean;
}>;

export type CacheMode = "no-cache" | "cache-first" | "network-first";

export type CacheFetchOptions<T> = Readonly<{
  url: string;
  init?: RequestInit;
  policy: CachePolicy;
  mode?: CacheMode;
  /**
   * Optional runtime decoder.
   * If provided, cache stores *decoded* value only.
   */
  decode?: (v: unknown) => DecodeResult<T>;
  /**
   * Optional AbortSignal.
   * Note: background revalidation will not inherit this signal.
   */
  signal?: AbortSignal;
}>;

export type CacheFetchResult<T> =
  | Readonly<{
      ok: true;
      value: T;
      fromCache: boolean;
      isStale: boolean;
      fetchedAtMs: number;
    }>
  | Readonly<{
      ok: false;
      error: string;
      fromCache: boolean;
    }>;

export type DecodeResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

type StoredEnvelope = Readonly<{
  v: 1;
  url: string;
  savedAtMs: number;
  data: unknown;
}>;

type MemEntry<T> = Readonly<{
  value: T;
  savedAtMs: number;
  url: string;
}>;

const NS = "sigilmarkets:cache:v1";
const ENVELOPE_VERSION = 1;

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Normalize user-provided ms windows:
 * - Coerce non-finite to 0
 * - Floor to integer
 * - Clamp to a safe finite upper bound (prevents Infinity poisoning comparisons)
 */
const normalizeWindowMs = (v: number): number => {
  const n = Number.isFinite(v) ? Math.floor(v) : 0;
  return clamp(n, 0, Number.MAX_SAFE_INTEGER);
};

const normalizeMaxEntries = (v: number): number => {
  const n = Number.isFinite(v) ? Math.floor(v) : 0;
  return clamp(n, 0, Number.MAX_SAFE_INTEGER);
};

/**
 * FNV-1a 32-bit hash to keep localStorage keys short and safe.
 * Returns 8-char hex.
 */
const fnv1a32Hex = (input: string): string => {
  // 32-bit FNV offset basis
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime: 16777619
    // h *= 16777619 (with overflow)
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

const storageKeyForUrl = (url: string): string => `${NS}:${fnv1a32Hex(url)}`;

const getStorage = (): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    if (!("localStorage" in window)) return null;
    const s = window.localStorage;
    // probe
    const k = `${NS}:__probe__`;
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
};

const safeJsonParse = (raw: string): DecodeResult<unknown> => {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "JSON parse error";
    return { ok: false, error: msg };
  }
};

const safeJsonStringify = (v: unknown): DecodeResult<string> => {
  try {
    return { ok: true, value: JSON.stringify(v) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "JSON stringify error";
    return { ok: false, error: msg };
  }
};

const decodeEnvelope = (v: unknown): DecodeResult<StoredEnvelope> => {
  if (!isRecord(v)) return { ok: false, error: "envelope: not object" };
  const ver = v["v"];
  const url = v["url"];
  const savedAtMs = v["savedAtMs"];
  const data = v["data"];

  if (ver !== ENVELOPE_VERSION) return { ok: false, error: "envelope: bad version" };
  if (!isString(url) || url.length === 0) return { ok: false, error: "envelope: bad url" };
  if (!isNumber(savedAtMs) || savedAtMs <= 0) return { ok: false, error: "envelope: bad savedAtMs" };

  return { ok: true, value: { v: 1, url, savedAtMs, data } };
};

const defaultFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  return fetch(input, init);
};

class CacheCore {
  private mem: Map<string, MemEntry<unknown>> = new Map();
  private storage: Storage | null = null;

  constructor() {
    this.storage = getStorage();
  }

  setStorageEnabled(enabled: boolean): void {
    this.storage = enabled ? getStorage() : null;
  }

  clearAll(): void {
    this.mem.clear();
    const s = this.storage;
    if (!s) return;
    // Best effort: remove only our namespace keys.
    // localStorage doesn't provide prefix iteration, so we must scan.
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        if (k && k.startsWith(`${NS}:`)) keys.push(k);
      }
      for (const k of keys) s.removeItem(k);
    } catch {
      // ignore
    }
  }

  prune(maxEntries: number, maxAgeMs: number): void {
    const safeMaxEntries = normalizeMaxEntries(maxEntries);
    const safeMaxAgeMs = normalizeWindowMs(maxAgeMs);

    // Memory prune
    if (safeMaxEntries > 0 && this.mem.size > safeMaxEntries) {
      const entries = Array.from(this.mem.entries()).map(([k, v]) => ({ k, t: v.savedAtMs }));
      entries.sort((a, b) => a.t - b.t); // oldest first
      const toDrop = entries.slice(0, Math.max(0, entries.length - safeMaxEntries));
      for (const d of toDrop) this.mem.delete(d.k);
    }

    // Storage prune
    const s = this.storage;
    if (!s) return;

    const cutoff = nowMs() - safeMaxAgeMs;
    try {
      const candidates: Array<{ k: string; t: number }> = [];
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        if (!k || !k.startsWith(`${NS}:`)) continue;
        const raw = s.getItem(k);
        if (!raw) continue;
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) continue;
        const env = decodeEnvelope(parsed.value);
        if (!env.ok) continue;
        candidates.push({ k, t: env.value.savedAtMs });
      }

      // Remove too-old
      for (const c of candidates) {
        if (c.t < cutoff) s.removeItem(c.k);
      }

      // Enforce maxEntries best-effort by removing oldest
      if (safeMaxEntries > 0) {
        const remaining: Array<{ k: string; t: number }> = [];
        for (const c of candidates) {
          if (c.t >= cutoff) remaining.push(c);
        }
        if (remaining.length > safeMaxEntries) {
          remaining.sort((a, b) => a.t - b.t);
          const toDrop = remaining.slice(0, remaining.length - safeMaxEntries);
          for (const d of toDrop) s.removeItem(d.k);
        }
      }
    } catch {
      // ignore
    }
  }

  getMem<T>(url: string): MemEntry<T> | null {
    const k = storageKeyForUrl(url);
    const v = this.mem.get(k);
    return (v as MemEntry<T> | undefined) ?? null;
  }

  setMem<T>(url: string, value: T, savedAtMs: number): void {
    const k = storageKeyForUrl(url);
    this.mem.set(k, { url, value, savedAtMs });
  }

  getStored(url: string): StoredEnvelope | null {
    const s = this.storage;
    if (!s) return null;
    const k = storageKeyForUrl(url);
    try {
      const raw = s.getItem(k);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      if (!parsed.ok) return null;
      const env = decodeEnvelope(parsed.value);
      if (!env.ok) return null;
      if (env.value.url !== url) return null; // defensive
      return env.value;
    } catch {
      return null;
    }
  }

  setStored(url: string, data: unknown, savedAtMs: number): void {
    const s = this.storage;
    if (!s) return;
    const k = storageKeyForUrl(url);
    const env: StoredEnvelope = { v: 1, url, savedAtMs, data };
    const raw = safeJsonStringify(env);
    if (!raw.ok) return;
    try {
      s.setItem(k, raw.value);
    } catch {
      // ignore (quota / blocked)
    }
  }
}

const CORE = new CacheCore();

/** Public controls */
export const setSigilMarketsCacheStorageEnabled = (enabled: boolean): void => CORE.setStorageEnabled(enabled);
export const clearSigilMarketsCache = (): void => CORE.clearAll();
export const pruneSigilMarketsCache = (opts: Readonly<{ maxEntries: number; maxAgeMs: number }>): void =>
  CORE.prune(opts.maxEntries, opts.maxAgeMs);

/**
 * Core cached JSON fetch.
 * - cache-first: return fresh cache immediately if available; else fetch network (and cache)
 * - network-first: try network; on failure, fall back to any cache (fresh or stale)
 * - no-cache: always fetch network, never read cache, still writes if policy.persist
 */
export const cachedJsonFetch = async <T>(opts: CacheFetchOptions<T>): Promise<CacheFetchResult<T>> => {
  const mode: CacheMode = opts.mode ?? "cache-first";
  const persist = opts.policy.persist ?? true;

  const maxAgeMs = normalizeWindowMs(opts.policy.maxAgeMs);
  const swrMs = normalizeWindowMs(opts.policy.staleWhileRevalidateMs);
  const now = nowMs();

  const decode = opts.decode;

  const readCache = (): Readonly<{ entry: MemEntry<T> | null; stored: StoredEnvelope | null }> => {
    const mem = CORE.getMem<T>(opts.url);
    const stored = CORE.getStored(opts.url);
    // If storage has a newer copy than memory, prefer it and update memory.
    if (stored && (!mem || stored.savedAtMs > mem.savedAtMs)) {
      const decoded = decode ? decode(stored.data) : ({ ok: true, value: stored.data as T } as DecodeResult<T>);
      if (decoded.ok) {
        CORE.setMem<T>(opts.url, decoded.value, stored.savedAtMs);
        return { entry: { url: opts.url, value: decoded.value, savedAtMs: stored.savedAtMs }, stored };
      }
    }
    return { entry: mem, stored };
  };

  const classifyAge = (savedAt: number): Readonly<{ isFresh: boolean; isWithinSWR: boolean; ageMs: number }> => {
    const ageMs = Math.max(0, now - savedAt);
    const isFresh = ageMs <= maxAgeMs;
    const isWithinSWR = ageMs <= swrMs;
    return { isFresh, isWithinSWR, ageMs };
  };

  const tryNetwork = async (): Promise<CacheFetchResult<T>> => {
    try {
      const res = await defaultFetch(opts.url, { ...opts.init, signal: opts.signal });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, fromCache: false };
      }
      const json = (await res.json()) as unknown;
      const decoded = decode ? decode(json) : ({ ok: true, value: json as T } as DecodeResult<T>);
      if (!decoded.ok) return { ok: false, error: `decode: ${decoded.error}`, fromCache: false };

      const t = nowMs();
      CORE.setMem<T>(opts.url, decoded.value, t);
      if (persist) CORE.setStored(opts.url, decoded.value, t);

      return { ok: true, value: decoded.value, fromCache: false, isStale: false, fetchedAtMs: t };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      return { ok: false, error: msg, fromCache: false };
    }
  };

  const kickRevalidate = async (): Promise<void> => {
    // Best-effort background refresh without blocking UI.
    const res = await tryNetwork();
    if (!res.ok) return;
  };

  // no-cache: always network
  if (mode === "no-cache") {
    const net = await tryNetwork();
    if (net.ok) return net;
    return net;
  }

  const cached = readCache();
  const entry = cached.entry;

  if (mode === "cache-first") {
    if (entry) {
      const { isFresh, isWithinSWR } = classifyAge(entry.savedAtMs);
      if (isFresh) {
        return { ok: true, value: entry.value, fromCache: true, isStale: false, fetchedAtMs: entry.savedAtMs };
      }
      if (isWithinSWR) {
        // serve stale and revalidate
        void kickRevalidate();
        return { ok: true, value: entry.value, fromCache: true, isStale: true, fetchedAtMs: entry.savedAtMs };
      }
      // too old: go network
    }

    const net = await tryNetwork();
    if (net.ok) return net;

    // Network failed: fall back to whatever cache we have
    if (entry) {
      return { ok: true, value: entry.value, fromCache: true, isStale: true, fetchedAtMs: entry.savedAtMs };
    }
    return net;
  }

  // network-first
  const net = await tryNetwork();
  if (net.ok) return net;

  if (entry) {
    const { isWithinSWR } = classifyAge(entry.savedAtMs);
    return {
      ok: true,
      value: entry.value,
      fromCache: true,
      isStale: !isWithinSWR ? true : true,
      fetchedAtMs: entry.savedAtMs,
    };
  }

  return net;
};
