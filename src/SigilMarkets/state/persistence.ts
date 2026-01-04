// SigilMarkets/state/persistence.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — persistence (normative)
 *
 * Provides a small, safe persistence layer for localStorage (or any Storage-like backend).
 * - No bigint is persisted here (serialized records already use decimal strings).
 * - Includes versioned keys, guards, and error-resistant load/save.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { readonly [k: string]: JsonValue };
export type JsonArray = readonly JsonValue[];

export type StorageLike = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

export type PersistResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

/** SigilMarkets storage namespace + versioned keys. */
export const SIGIL_MARKETS_NS = "sigilmarkets";

export const SM_UI_STATE_KEY = `${SIGIL_MARKETS_NS}:ui:v1`;
export const SM_MARKETS_CACHE_KEY = `${SIGIL_MARKETS_NS}:markets:v1`;
export const SM_VAULTS_KEY = `${SIGIL_MARKETS_NS}:vaults:v1`;
export const SM_POSITIONS_KEY = `${SIGIL_MARKETS_NS}:positions:v1`;
export const SM_FEED_KEY = `${SIGIL_MARKETS_NS}:feed:v1`;
export const SM_LOCAL_QUEUE_KEY = `${SIGIL_MARKETS_NS}:queue:v1`;
export const SM_HOWTO_DISMISSED_KEY = `${SIGIL_MARKETS_NS}:howto:dismissed:v1`;

/** Runtime guards */
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

export const getDefaultStorage = (): StorageLike | null => {
  try {
    if (typeof window === "undefined") return null;
    if (!("localStorage" in window)) return null;
    const s = window.localStorage;
    // basic sanity check (may throw in private mode)
    const k = `${SIGIL_MARKETS_NS}:__probe__`;
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
};

export const safeJsonParse = (raw: string): PersistResult<unknown> => {
  try {
    const v: unknown = JSON.parse(raw);
    return { ok: true, value: v };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "JSON parse error";
    return { ok: false, error: msg };
  }
};

export const safeJsonStringify = (v: unknown): PersistResult<string> => {
  try {
    const raw = JSON.stringify(v);
    return { ok: true, value: raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "JSON stringify error";
    return { ok: false, error: msg };
  }
};

export type Decoder<T> = (v: unknown) => PersistResult<T>;

export const loadFromStorage = <T>(
  key: string,
  decode: Decoder<T>,
  storage?: StorageLike | null,
): PersistResult<T | null> => {
  const s = storage ?? getDefaultStorage();
  if (!s) return { ok: true, value: null };

  let raw: string | null = null;
  try {
    raw = s.getItem(key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "storage getItem error";
    return { ok: false, error: msg };
  }

  if (raw === null) return { ok: true, value: null };

  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return { ok: false, error: `load ${key}: ${parsed.error}` };

  const decoded = decode(parsed.value);
  if (!decoded.ok) return { ok: false, error: `decode ${key}: ${decoded.error}` };

  return { ok: true, value: decoded.value };
};

export const saveToStorage = (
  key: string,
  value: unknown,
  storage?: StorageLike | null,
): PersistResult<void> => {
  const s = storage ?? getDefaultStorage();
  if (!s) return { ok: true, value: undefined };

  const raw = safeJsonStringify(value);
  if (!raw.ok) return { ok: false, error: `save ${key}: ${raw.error}` };

  try {
    s.setItem(key, raw.value);
    return { ok: true, value: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "storage setItem error";
    return { ok: false, error: `save ${key}: ${msg}` };
  }
};

export const removeFromStorage = (key: string, storage?: StorageLike | null): PersistResult<void> => {
  const s = storage ?? getDefaultStorage();
  if (!s) return { ok: true, value: undefined };
  try {
    s.removeItem(key);
    return { ok: true, value: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "storage removeItem error";
    return { ok: false, error: `remove ${key}: ${msg}` };
  }
};

/** Optional metadata envelope (helps with migrations later). */
export type PersistEnvelope<T extends JsonValue> = Readonly<{
  v: number;
  savedAtMs: number;
  data: T;
}>;

export const wrapEnvelope = <T extends JsonValue>(data: T, v: number): PersistEnvelope<T> => ({
  v,
  savedAtMs: Date.now(),
  data,
});

/**
 * decodeEnvelope MUST NOT be constrained to JsonValue.
 * The decoder defines the actual target type; the envelope is just a transport shell.
 */
export const decodeEnvelope = <T>(
  v: unknown,
  expectedVersion: number,
  decodeData: Decoder<T>,
): PersistResult<Readonly<{ data: T; savedAtMs: number }>> => {
  if (!isRecord(v)) return { ok: false, error: "envelope: not an object" };
  const ver = v["v"];
  const savedAtMs = v["savedAtMs"];
  const data = v["data"];

  if (typeof ver !== "number" || !Number.isFinite(ver)) return { ok: false, error: "envelope: bad v" };
  if (ver !== expectedVersion) return { ok: false, error: `envelope: unsupported v=${ver}` };
  if (typeof savedAtMs !== "number" || !Number.isFinite(savedAtMs)) {
    return { ok: false, error: "envelope: bad savedAtMs" };
  }

  const decoded = decodeData(data);
  if (!decoded.ok) return { ok: false, error: `envelope: ${decoded.error}` };

  return { ok: true, value: { data: decoded.value, savedAtMs } };
};

/** Common decoders */
export const decodeString = (v: unknown): PersistResult<string> =>
  isString(v) ? { ok: true, value: v } : { ok: false, error: "expected string" };

export const decodeNumber = (v: unknown): PersistResult<number> =>
  typeof v === "number" && Number.isFinite(v) ? { ok: true, value: v } : { ok: false, error: "expected number" };

export const decodeBoolean = (v: unknown): PersistResult<boolean> =>
  typeof v === "boolean" ? { ok: true, value: v } : { ok: false, error: "expected boolean" };

export const decodeArray = <T>(v: unknown, decodeItem: Decoder<T>): PersistResult<readonly T[]> => {
  if (!Array.isArray(v)) return { ok: false, error: "expected array" };
  const out: T[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const di = decodeItem(v[i]);
    if (!di.ok) return { ok: false, error: `array[${i}]: ${di.error}` };
    out.push(di.value);
  }
  return { ok: true, value: out };
};

export const decodeRecord = <T>(v: unknown, decodeValue: Decoder<T>): PersistResult<Readonly<Record<string, T>>> => {
  if (!isRecord(v)) return { ok: false, error: "expected object" };
  const out: Record<string, T> = {};
  for (const [k, vv] of Object.entries(v)) {
    const dv = decodeValue(vv);
    if (!dv.ok) return { ok: false, error: `object.${k}: ${dv.error}` };
    out[k] = dv.value;
  }
  return { ok: true, value: out };
};
