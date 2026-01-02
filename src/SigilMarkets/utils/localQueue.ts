/* eslint-disable @typescript-eslint/consistent-type-definitions */
/**
 * SigilMarkets — localQueue.ts
 *
 * A durable, offline-first local mutation queue (no "any").
 *
 * Why this exists
 * - Users will click / act while offline or while the API is unreachable.
 * - We never want to lose intent: we enqueue it locally, then flush when possible.
 * - We also protect against double-submits (dedupeKey) and multi-tab stampedes (lock).
 *
 * Design goals
 * - Works in browser + SSR/Node (falls back to in-memory storage).
 * - Safe under storage failures (Safari private mode, quota, JSON corruption).
 * - Deterministic retry (exponential backoff, no jitter by default).
 * - Optional multi-tab lock to ensure only one tab flushes at a time.
 *
 * Notes
 * - Time is injected (nowMs) so you can swap to Kai-based time if you want.
 * - Payloads are JSON-serializable objects (JsonObject).
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [k: string]: JsonValue };

export type LocalQueueKind = string;

export type LocalQueueItem<TPayload extends JsonObject = JsonObject> = Readonly<{
  id: string;
  kind: LocalQueueKind;
  payload: TPayload;

  /** Optional key to prevent duplicates (e.g., "order:place:<marketId>:<walletId>:<nonce>") */
  dedupeKey?: string;

  /** Higher runs sooner (default 0). */
  priority: number;

  createdAtMs: number;
  updatedAtMs: number;

  attempts: number;
  nextAttemptAtMs: number;

  lastError?: string;
}>;

export type LocalQueueSnapshot = Readonly<{
  v: 1;
  items: readonly LocalQueueItem[];
}>;

export type LocalQueueEnqueueOptions = Readonly<{
  dedupeKey?: string;
  priority?: number;
  /**
   * If provided, item becomes eligible no earlier than this absolute time.
   * Useful for "schedule later" behavior.
   */
  notBeforeMs?: number;
}>;

export type LocalQueueFlushOptions = Readonly<{
  /**
   * Stop after processing N items (useful to keep UI responsive).
   * Default: Infinity
   */
  maxItems?: number;

  /**
   * If true (default), acquires a multi-tab lock before flushing.
   * If lock can't be acquired, flush returns without doing anything.
   */
  useLock?: boolean;

  /**
   * If provided, flush stops early when signal is aborted.
   */
  signal?: AbortSignal;
}>;

export type LocalQueueHandler = (item: LocalQueueItem) => Promise<void>;

export type LocalQueue = Readonly<{
  key: string;
  lockKey: string;

  load: () => LocalQueueSnapshot;
  getItems: () => readonly LocalQueueItem[];
  size: () => number;

  enqueue: <TPayload extends JsonObject>(
    kind: LocalQueueKind,
    payload: TPayload,
    opts?: LocalQueueEnqueueOptions
  ) => LocalQueueItem<TPayload>;

  remove: (id: string) => boolean;
  clear: () => void;

  /**
   * Flushes ready items (nextAttemptAtMs <= now) in priority order.
   * On handler success: item removed.
   * On handler failure: item is rescheduled with deterministic exponential backoff.
   */
  flush: (handler: LocalQueueHandler, opts?: LocalQueueFlushOptions) => Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    skippedBecauseLocked: boolean;
  }>;

  /**
   * Subscribe to queue changes (including cross-tab storage events when available).
   * Returns an unsubscribe function.
   */
  subscribe: (fn: () => void) => () => void;
}>;

type StorageLike = Readonly<{
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}>;

type LocalQueueConfig = Readonly<{
  key?: string;
  lockKey?: string;

  /** Maximum number of items to retain (oldest pruned first). Default: 500 */
  maxItems?: number;

  /** Maximum age (ms) before items are pruned. Default: 21 days */
  maxAgeMs?: number;

  /** Backoff base (ms). Default: 1_000 */
  backoffBaseMs?: number;

  /** Backoff cap (ms). Default: 5 * 60_000 */
  backoffMaxMs?: number;

  /** Lock TTL (ms). Default: 10_000 */
  lockTtlMs?: number;

  /** Provide your own storage (tests / non-browser). */
  storage?: StorageLike;

  /** Inject time source. Default: Date.now() */
  nowMs?: () => number;
}>;

const DEFAULT_KEY = "SM_LOCAL_QUEUE_V1";
const DEFAULT_LOCK_KEY = "SM_LOCAL_QUEUE_LOCK_V1";

const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LOCK_TTL_MS = 10_000;

const SNAPSHOT_VERSION = 1 as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function defaultNowMs(): number {
  return Date.now();
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeJsonStringify(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function getDefaultStorage(): StorageLike {
  // SSR / Node: in-memory
  if (!isBrowser()) return createMemoryStorage();

  // Browser: localStorage if accessible
  try {
    const ls = window.localStorage;
    const testKey = "__sm_ls_test__";
    ls.setItem(testKey, "1");
    ls.removeItem(testKey);
    return ls;
  } catch {
    // Safari private mode or disabled storage
    return createMemoryStorage();
  }
}

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) ?? null) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, x));
}

function computeBackoffMs(attempts: number, baseMs: number, maxMs: number): number {
  const a = clampInt(attempts, 0, 60);
  // Deterministic exp backoff: base * 2^(attempts-1) for attempts>=1
  const factor = a <= 1 ? 1 : Math.pow(2, a - 1);
  const ms = Math.trunc(baseMs * factor);
  return Math.min(ms, maxMs);
}

function compareItems(a: LocalQueueItem, b: LocalQueueItem): number {
  // Ready ordering: higher priority first, then earlier nextAttemptAtMs, then older createdAtMs
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.nextAttemptAtMs !== b.nextAttemptAtMs) return a.nextAttemptAtMs - b.nextAttemptAtMs;
  return a.createdAtMs - b.createdAtMs;
}

function generateId(prefix: string): string {
  // URL-safe, short, random. No "any". Works in modern browsers; fallback if crypto missing.
  const rnd = getRandomBytes(12);
  const b64 = base64UrlEncode(rnd);
  return `${prefix}_${b64}`;
}

function getRandomBytes(n: number): Uint8Array {
  const len = clampInt(n, 1, 1024);
  const out = new Uint8Array(len);
  if (isBrowser() && typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(out);
    return out;
  }
  // Fallback: xorshift seeded from time + Math.random (not cryptographic, but fine for local ids)
  let x = (defaultNowMs() ^ Math.trunc(Math.random() * 0x7fffffff)) >>> 0;
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Browser: btoa on binary string; Node/SSR: manual map
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    const b1 = i < bytes.length ? (bytes[i++] ?? 0) : 0;
    const b2 = i < bytes.length ? (bytes[i++] ?? 0) : 0;

    const n = (b0 << 16) | (b1 << 8) | b2;

    const c0 = (n >>> 18) & 63;
    const c1 = (n >>> 12) & 63;
    const c2 = (n >>> 6) & 63;
    const c3 = n & 63;

    out += alphabet[c0] ?? "";
    out += alphabet[c1] ?? "";
    // handle padding by trimming later (we never include '=')
    out += i - 1 <= bytes.length ? (alphabet[c2] ?? "") : "";
    out += i <= bytes.length ? (alphabet[c3] ?? "") : "";
  }

  // Trim characters that were produced from padding logic
  const mod = bytes.length % 3;
  if (mod === 1) return out.slice(0, -2);
  if (mod === 2) return out.slice(0, -1);
  return out;
}

function normalizeSnapshot(input: unknown): LocalQueueSnapshot {
  const now = defaultNowMs();
  const empty: LocalQueueSnapshot = { v: SNAPSHOT_VERSION, items: [] };

  if (typeof input !== "object" || input == null) return empty;

  const rec = input as Record<string, unknown>;
  if (rec.v !== SNAPSHOT_VERSION) return empty;

  const itemsRaw = rec.items;
  if (!Array.isArray(itemsRaw)) return empty;

  const items: LocalQueueItem[] = [];
  for (const it of itemsRaw) {
    if (typeof it !== "object" || it == null) continue;
    const r = it as Record<string, unknown>;

    const id = typeof r.id === "string" ? r.id : "";
    const kind = typeof r.kind === "string" ? r.kind : "";
    const payload = (typeof r.payload === "object" && r.payload != null ? (r.payload as JsonObject) : null);

    if (!id || !kind || payload == null) continue;

    const dedupeKey = typeof r.dedupeKey === "string" ? r.dedupeKey : undefined;
    const priority = typeof r.priority === "number" ? clampInt(r.priority, -1000, 1000) : 0;

    const createdAtMs = typeof r.createdAtMs === "number" ? Math.trunc(r.createdAtMs) : now;
    const updatedAtMs = typeof r.updatedAtMs === "number" ? Math.trunc(r.updatedAtMs) : createdAtMs;

    const attempts = typeof r.attempts === "number" ? clampInt(r.attempts, 0, 1_000_000) : 0;
    const nextAttemptAtMs =
      typeof r.nextAttemptAtMs === "number" ? Math.trunc(r.nextAttemptAtMs) : createdAtMs;

    const lastError = typeof r.lastError === "string" ? r.lastError : undefined;

    items.push({
      id,
      kind,
      payload,
      dedupeKey,
      priority,
      createdAtMs,
      updatedAtMs,
      attempts,
      nextAttemptAtMs,
      lastError,
    });
  }

  items.sort(compareItems);
  return { v: SNAPSHOT_VERSION, items };
}

function pruneItems(
  items: readonly LocalQueueItem[],
  nowMs: number,
  maxItems: number,
  maxAgeMs: number
): LocalQueueItem[] {
  const minCreated = nowMs - maxAgeMs;
  const filtered = items.filter((it) => it.createdAtMs >= minCreated);

  if (filtered.length <= maxItems) return filtered.slice();

  // Prune oldest first
  const sorted = filtered.slice().sort((a, b) => a.createdAtMs - b.createdAtMs);
  return sorted.slice(sorted.length - maxItems);
}

type LockRecord = Readonly<{ owner: string; untilMs: number }>;

function readLock(storage: StorageLike, key: string): LockRecord | null {
  const raw = storage.getItem(key);
  const parsed = safeJsonParse<unknown>(raw);
  if (typeof parsed !== "object" || parsed == null) return null;
  const r = parsed as Record<string, unknown>;
  const owner = typeof r.owner === "string" ? r.owner : "";
  const untilMs = typeof r.untilMs === "number" ? Math.trunc(r.untilMs) : 0;
  if (!owner || !Number.isFinite(untilMs)) return null;
  return { owner, untilMs };
}

function writeLock(storage: StorageLike, key: string, rec: LockRecord): void {
  const raw = safeJsonStringify(rec);
  if (raw == null) return;
  try {
    storage.setItem(key, raw);
  } catch {
    // ignore lock write failures
  }
}

function removeLock(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function tryAcquireLock(storage: StorageLike, lockKey: string, owner: string, nowMs: number, ttlMs: number): boolean {
  const current = readLock(storage, lockKey);
  if (current == null || current.untilMs <= nowMs) {
    writeLock(storage, lockKey, { owner, untilMs: nowMs + ttlMs });
    // re-read to confirm we hold it (best-effort; localStorage isn't transactional)
    const confirm = readLock(storage, lockKey);
    return confirm != null && confirm.owner === owner && confirm.untilMs > nowMs;
  }
  return current.owner === owner; // already ours
}

function releaseLock(storage: StorageLike, lockKey: string, owner: string): void {
  const cur = readLock(storage, lockKey);
  if (cur != null && cur.owner === owner) removeLock(storage, lockKey);
}

export function createLocalQueue(config?: LocalQueueConfig): LocalQueue {
  const key = config?.key ?? DEFAULT_KEY;
  const lockKey = config?.lockKey ?? DEFAULT_LOCK_KEY;

  const maxItems = config?.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxAgeMs = config?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  const backoffBaseMs = config?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffMaxMs = config?.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;

  const lockTtlMs = config?.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;

  const storage = config?.storage ?? getDefaultStorage();
  const nowMsFn = config?.nowMs ?? defaultNowMs;

  const ownerId = generateId("tab");

  let cached: LocalQueueSnapshot | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // never let listeners break queue
      }
    }
  }

  function loadInternal(): LocalQueueSnapshot {
    const raw = storage.getItem(key);
    const parsed = safeJsonParse<unknown>(raw);
    const normalized = normalizeSnapshot(parsed);
    const pruned = pruneItems(normalized.items, nowMsFn(), maxItems, maxAgeMs);
    const snapshot: LocalQueueSnapshot = { v: SNAPSHOT_VERSION, items: pruned };
    cached = snapshot;

    // If pruning changed it, persist back (best-effort)
    if (pruned.length !== normalized.items.length) {
      const encoded = safeJsonStringify(snapshot);
      if (encoded != null) {
        try {
          storage.setItem(key, encoded);
        } catch {
          // ignore
        }
      }
    }

    return snapshot;
  }

  function saveInternal(snapshot: LocalQueueSnapshot): void {
    const encoded = safeJsonStringify(snapshot);
    if (encoded == null) return;
    try {
      storage.setItem(key, encoded);
    } catch {
      // If persistence fails (quota, private mode), fall back to memory snapshot.
      // We still keep runtime correctness for this session.
    }
    cached = snapshot;
    notify();
  }

  function load(): LocalQueueSnapshot {
    if (cached != null) return cached;
    return loadInternal();
  }

  function getItems(): readonly LocalQueueItem[] {
    return load().items;
  }

  function size(): number {
    return load().items.length;
  }

  function enqueue<TPayload extends JsonObject>(
    kind: LocalQueueKind,
    payload: TPayload,
    opts?: LocalQueueEnqueueOptions
  ): LocalQueueItem<TPayload> {
    const now = nowMsFn();
    const snap = loadInternal(); // always read fresh to reduce cross-tab stomps

    const dedupeKey = opts?.dedupeKey;
    if (dedupeKey != null && dedupeKey.length > 0) {
      const existing = snap.items.find((it) => it.dedupeKey === dedupeKey);
      if (existing != null) return existing as LocalQueueItem<TPayload>;
    }

    const item: LocalQueueItem<TPayload> = {
      id: generateId("q"),
      kind,
      payload,
      dedupeKey: dedupeKey && dedupeKey.length > 0 ? dedupeKey : undefined,
      priority: typeof opts?.priority === "number" ? clampInt(opts.priority, -1000, 1000) : 0,
      createdAtMs: now,
      updatedAtMs: now,
      attempts: 0,
      nextAttemptAtMs: typeof opts?.notBeforeMs === "number" ? Math.trunc(opts.notBeforeMs) : now,
    };

    const items = pruneItems([...snap.items, item], now, maxItems, maxAgeMs).sort(compareItems);
    saveInternal({ v: SNAPSHOT_VERSION, items });
    return item;
  }

  function remove(id: string): boolean {
    const snap = loadInternal();
    const next = snap.items.filter((it) => it.id !== id);
    const changed = next.length !== snap.items.length;
    if (changed) saveInternal({ v: SNAPSHOT_VERSION, items: next });
    return changed;
  }

  function clear(): void {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
    cached = { v: SNAPSHOT_VERSION, items: [] };
    notify();
  }

  function rescheduleFailure(item: LocalQueueItem, errMsg: string): LocalQueueItem {
    const now = nowMsFn();
    const attempts = item.attempts + 1;
    const backoff = computeBackoffMs(attempts, backoffBaseMs, backoffMaxMs);
    return {
      ...item,
      attempts,
      updatedAtMs: now,
      nextAttemptAtMs: now + backoff,
      lastError: errMsg,
    };
  }

  async function flush(handler: LocalQueueHandler, opts?: LocalQueueFlushOptions): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    skippedBecauseLocked: boolean;
  }> {
    const useLock = opts?.useLock ?? true;
    const maxToProcess = typeof opts?.maxItems === "number" ? Math.max(0, Math.trunc(opts.maxItems)) : Infinity;
    const signal = opts?.signal;

    if (signal?.aborted) {
      return { processed: 0, succeeded: 0, failed: 0, skippedBecauseLocked: false };
    }

    const now = nowMsFn();
    let locked = true;

    if (useLock) {
      locked = tryAcquireLock(storage, lockKey, ownerId, now, lockTtlMs);
      if (!locked) {
        return { processed: 0, succeeded: 0, failed: 0, skippedBecauseLocked: true };
      }
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      while (processed < maxToProcess) {
        if (signal?.aborted) break;

        // keep lock alive (best-effort)
        if (useLock) {
          const t = nowMsFn();
          tryAcquireLock(storage, lockKey, ownerId, t, lockTtlMs);
        }

        const snap = loadInternal();
        const tNow = nowMsFn();

        const ready = snap.items
          .filter((it) => it.nextAttemptAtMs <= tNow)
          .sort(compareItems);

        const item = ready[0];
        if (item == null) break;

        processed += 1;

        try {
          await handler(item);

          // success -> remove
          const remaining = snap.items.filter((it) => it.id !== item.id);
          saveInternal({ v: SNAPSHOT_VERSION, items: remaining });
          succeeded += 1;
        } catch (e) {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Queue handler failed";

          const updated = rescheduleFailure(item, msg);
          const nextItems = snap.items.map((it) => (it.id === item.id ? updated : it)).sort(compareItems);
          saveInternal({ v: SNAPSHOT_VERSION, items: nextItems });
          failed += 1;
        }
      }
    } finally {
      if (useLock) releaseLock(storage, lockKey, ownerId);
    }

    return { processed, succeeded, failed, skippedBecauseLocked: false };
  }

  function subscribe(fn: () => void): () => void {
    listeners.add(fn);

    // Cross-tab updates when localStorage is used
    let onStorage: ((ev: StorageEvent) => void) | null = null;

    if (isBrowser() && typeof window.addEventListener === "function") {
      onStorage = (ev: StorageEvent) => {
        if (ev.key === key) {
          // invalidate cache then notify
          cached = null;
          notify();
        }
      };
      window.addEventListener("storage", onStorage);
    }

    return () => {
      listeners.delete(fn);
      if (onStorage != null) {
        window.removeEventListener("storage", onStorage);
      }
    };
  }

  return {
    key,
    lockKey,
    load,
    getItems,
    size,
    enqueue,
    remove,
    clear,
    flush,
    subscribe,
  };
}

/**
 * Default singleton for SigilMarkets.
 * Import and use directly unless you need isolated queues in tests.
 */
export const localQueue: LocalQueue = createLocalQueue();
