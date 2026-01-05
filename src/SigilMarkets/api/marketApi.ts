// SigilMarkets/api/marketApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — marketApi
 *
 * Goals:
 * - Provide a single, clean interface for loading Markets.
 * - Offline-first: can run fully local with seeded demo markets.
 * - Remote-ready: if a baseUrl is configured, fetch + decode markets.
 *
 * Remote JSON contract (supported):
 * 1) Array of markets: SerializedBinaryMarket[]
 * 2) Object wrapper: { markets: SerializedBinaryMarket[], lastSyncedPulse?: number }
 *
 * Where SerializedBinaryMarket has:
 *   { def: {...}, state: {...} }
 * and micro values are decimal strings.
 */

import type {
  AmmCurve,
  AmmState,
  BinaryMarket,
  BinaryMarketDefinition,
  BinaryMarketState,
  BinaryPricesMicro,
  ClobPriceLevel,
  ClobState,
  KaiPulse,
  Market,
  MarketCategory,
  MarketOraclePolicy,
  MarketRules,
  MarketSettlementPolicy,
  MarketStatus,
  MarketTiming,
  MarketVenueState,
  OracleProvider,
  ParimutuelState,
  PhiMicro,
  PriceMicro,
  ShareMicro,
  MarketOutcome,
} from "../types/marketTypes";

import {
  asEvidenceHash,
  asMarketId,
  asMarketSlug,
  asOracleId,
  isMarketOutcome,
  isMarketStatus,
  ONE_PHI_MICRO,
} from "../types/marketTypes";

import { cachedJsonFetch, type DecodeResult } from "./cacheApi";
import { makeEmptyBinaryMarket } from "../state/marketStore";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

const parsePulse = (v: unknown): KaiPulse | null => {
  if (!isNumber(v)) return null;
  if (v < 0) return 0;
  return Math.floor(v);
};

const parseBps = (v: unknown): number | null => {
  if (!isNumber(v)) return null;
  return clampInt(v, 0, 10_000);
};

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

const parseCategory = (v: unknown): MarketCategory | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as MarketCategory;
};

const parseOracleProvider = (v: unknown): OracleProvider | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as OracleProvider;
};

/** Price micros are probabilities for a binary market, expressed in Φ-micro (0 .. 1Φ). */
const isPriceMicro = (bi: bigint): bi is PriceMicro => bi >= 0n && bi <= ONE_PHI_MICRO;

/** ---------------------------------------
 * Remote JSON shapes (micro values = strings)
 * -------------------------------------- */

type MicroStr = string;

type SerializedBinaryPricesMicro = Readonly<{ yes: MicroStr; no: MicroStr }>;

type SerializedAmmState = Readonly<{
  curve: AmmCurve;
  yesInventoryMicro: MicroStr;
  noInventoryMicro: MicroStr;
  feeBps: number;
  paramMicro?: MicroStr;
}>;

type SerializedParimutuelState = Readonly<{
  yesPoolMicro: MicroStr;
  noPoolMicro: MicroStr;
  feeBps: number;
}>;

type SerializedClobPriceLevel = Readonly<{ priceMicro: MicroStr; sizeMicro: MicroStr }>;

type SerializedClobState = Readonly<{
  yesBidMicro?: MicroStr;
  yesAskMicro?: MicroStr;
  noBidMicro?: MicroStr;
  noAskMicro?: MicroStr;
  depthYes?: readonly SerializedClobPriceLevel[];
  depthNo?: readonly SerializedClobPriceLevel[];
  feeBps: number;
}>;

type SerializedVenueState =
  | Readonly<{ venue: "amm"; amm: SerializedAmmState }>
  | Readonly<{ venue: "parimutuel"; pool: SerializedParimutuelState }>
  | Readonly<{ venue: "clob"; clob: SerializedClobState }>;

type SerializedMarketResolution = Readonly<{
  marketId: string;
  outcome: MarketOutcome;
  resolvedPulse: KaiPulse;
  oracle: Readonly<{
    provider: string;
    oracleId?: string;
    disputeWindowPulses?: number;
    evidenceRequired?: boolean;
  }>;
  evidence?: Readonly<{
    urls?: readonly string[];
    hashes?: readonly string[];
    summary?: string;
  }>;
  dispute?: Readonly<{
    proposedPulse: KaiPulse;
    finalPulse: KaiPulse;
    meta?: Readonly<Record<string, string>>;
  }>;
}>;

type SerializedBinaryMarketState = Readonly<{
  status: MarketStatus;
  venueState: SerializedVenueState;
  pricesMicro: SerializedBinaryPricesMicro;
  liquidityMicro?: MicroStr;
  volume24hMicro?: MicroStr;
  updatedPulse: KaiPulse;
  resolution?: SerializedMarketResolution;
}>;

type SerializedMarketTiming = Readonly<{
  createdPulse: KaiPulse;
  openPulse: KaiPulse;
  closePulse: KaiPulse;
  resolveEarliestPulse?: KaiPulse;
  resolveByPulse?: KaiPulse;
}>;

type SerializedSettlementPolicy = Readonly<{
  unit: "phi";
  redeemPerShareMicro: MicroStr;
  feeBps: number;
  feeTiming: "entry" | "exit";
}>;

type SerializedOraclePolicy = Readonly<{
  provider: string;
  oracleId?: string;
  disputeWindowPulses?: number;
  evidenceRequired?: boolean;
}>;

type SerializedRules = Readonly<{
  yesCondition: string;
  clarifications?: readonly string[];
  oracle: SerializedOraclePolicy;
  settlement: SerializedSettlementPolicy;
  voidPolicy: Readonly<{
    canVoid: boolean;
    refundMode: "refund-stake" | "refund-less-fee" | "no-refund";
  }>;
}>;

type SerializedBinaryMarketDefinition = Readonly<{
  id: string;
  kind: "binary";
  slug: string;
  question: string;
  description?: string;
  category: string;
  tags: readonly string[];
  timing: SerializedMarketTiming;
  rules: SerializedRules;
  iconEmoji?: string;
  heroImageUrl?: string;
  definitionHash?: string;
}>;

type SerializedBinaryMarket = Readonly<{ def: SerializedBinaryMarketDefinition; state: SerializedBinaryMarketState }>;

type SerializedMarketListResponse =
  | readonly SerializedBinaryMarket[]
  | Readonly<{ markets: readonly SerializedBinaryMarket[]; lastSyncedPulse?: KaiPulse }>;

/** ---------------------------------------
 * Decoders
 * -------------------------------------- */

const decodePrices = (v: unknown): DecodeResult<BinaryPricesMicro> => {
  if (!isRecord(v)) return { ok: false, error: "pricesMicro: not object" };
  const yes = parseBigIntDec(v["yes"]);
  const no = parseBigIntDec(v["no"]);
  if (yes === null || no === null) return { ok: false, error: "pricesMicro: bad micros" };
  if (!isPriceMicro(yes) || !isPriceMicro(no)) return { ok: false, error: "pricesMicro: out of range (0..1Φ)" };
  return { ok: true, value: { yes, no } };
};

const decodeVenueState = (v: unknown): DecodeResult<MarketVenueState> => {
  if (!isRecord(v)) return { ok: false, error: "venueState: not object" };
  const venue = v["venue"];

  if (venue === "amm") {
    const amm = v["amm"];
    if (!isRecord(amm)) return { ok: false, error: "amm: not object" };
    const curve = amm["curve"];
    if (curve !== "cpmm" && curve !== "lmsr") return { ok: false, error: "amm.curve: bad" };

    const yesInv = parseBigIntDec(amm["yesInventoryMicro"]);
    const noInv = parseBigIntDec(amm["noInventoryMicro"]);
    const feeBps = parseBps(amm["feeBps"]);
    if (yesInv === null || noInv === null || feeBps === null) return { ok: false, error: "amm: bad micros/fee" };

    const param = amm["paramMicro"] !== undefined ? parseBigIntDec(amm["paramMicro"]) : null;

    const out: AmmState = {
      curve,
      yesInventoryMicro: yesInv as ShareMicro,
      noInventoryMicro: noInv as ShareMicro,
      feeBps,
      paramMicro: param !== null ? (param as PhiMicro) : undefined,
    };
    return { ok: true, value: { venue: "amm", amm: out } };
  }

  if (venue === "parimutuel") {
    const pool = v["pool"];
    if (!isRecord(pool)) return { ok: false, error: "pool: not object" };

    const yesPool = parseBigIntDec(pool["yesPoolMicro"]);
    const noPool = parseBigIntDec(pool["noPoolMicro"]);
    const feeBps = parseBps(pool["feeBps"]);
    if (yesPool === null || noPool === null || feeBps === null) return { ok: false, error: "pool: bad micros/fee" };

    const out: ParimutuelState = {
      yesPoolMicro: yesPool as PhiMicro,
      noPoolMicro: noPool as PhiMicro,
      feeBps,
    };
    return { ok: true, value: { venue: "parimutuel", pool: out } };
  }

  if (venue === "clob") {
    const clob = v["clob"];
    if (!isRecord(clob)) return { ok: false, error: "clob: not object" };
    const feeBps = parseBps(clob["feeBps"]);
    if (feeBps === null) return { ok: false, error: "clob.feeBps: bad" };

    const parseOptPrice = (x: unknown): PriceMicro | undefined => {
      const bi = parseBigIntDec(x);
      return bi !== null && isPriceMicro(bi) ? bi : undefined;
    };

    const parseDepth = (x: unknown): readonly ClobPriceLevel[] | undefined => {
      if (!isArray(x)) return undefined;
      const out: ClobPriceLevel[] = [];
      for (const item of x) {
        if (!isRecord(item)) continue;
        const price = parseBigIntDec(item["priceMicro"]);
        const size = parseBigIntDec(item["sizeMicro"]);
        if (price === null || size === null) continue;
        if (!isPriceMicro(price)) continue;
        out.push({ priceMicro: price, sizeMicro: size as ShareMicro });
      }
      return out;
    };

    const out: ClobState = {
      yesBidMicro: parseOptPrice(clob["yesBidMicro"]),
      yesAskMicro: parseOptPrice(clob["yesAskMicro"]),
      noBidMicro: parseOptPrice(clob["noBidMicro"]),
      noAskMicro: parseOptPrice(clob["noAskMicro"]),
      depthYes: parseDepth(clob["depthYes"]),
      depthNo: parseDepth(clob["depthNo"]),
      feeBps,
    };

    return { ok: true, value: { venue: "clob", clob: out } };
  }

  return { ok: false, error: "venueState: unknown venue" };
};

const decodeTiming = (v: unknown): DecodeResult<MarketTiming> => {
  if (!isRecord(v)) return { ok: false, error: "timing: not object" };
  const createdPulse = parsePulse(v["createdPulse"]);
  const openPulse = parsePulse(v["openPulse"]);
  const closePulse = parsePulse(v["closePulse"]);
  if (createdPulse === null || openPulse === null || closePulse === null) return { ok: false, error: "timing: bad pulses" };

  const resolveEarliestPulse = v["resolveEarliestPulse"] !== undefined ? parsePulse(v["resolveEarliestPulse"]) : null;
  const resolveByPulse = v["resolveByPulse"] !== undefined ? parsePulse(v["resolveByPulse"]) : null;

  return {
    ok: true,
    value: {
      createdPulse,
      openPulse,
      closePulse,
      resolveEarliestPulse: resolveEarliestPulse ?? undefined,
      resolveByPulse: resolveByPulse ?? undefined,
    },
  };
};

const decodeOraclePolicy = (v: unknown): DecodeResult<MarketOraclePolicy> => {
  if (!isRecord(v)) return { ok: false, error: "oracle: not object" };
  const provider = parseOracleProvider(v["provider"]);
  if (provider === null) return { ok: false, error: "oracle.provider: bad" };

  const oracleId = v["oracleId"];
  const disputeWindowPulses = v["disputeWindowPulses"];
  const evidenceRequired = v["evidenceRequired"];

  const dw =
    typeof disputeWindowPulses === "number" && Number.isFinite(disputeWindowPulses) && disputeWindowPulses >= 0
      ? clampInt(disputeWindowPulses, 0, 1_000_000_000)
      : undefined;

  return {
    ok: true,
    value: {
      provider,
      oracleId: isString(oracleId) && oracleId.length > 0 ? asOracleId(oracleId) : undefined,
      disputeWindowPulses: dw,
      evidenceRequired: typeof evidenceRequired === "boolean" ? evidenceRequired : undefined,
    },
  };
};

const decodeSettlementPolicy = (v: unknown): DecodeResult<MarketSettlementPolicy> => {
  if (!isRecord(v)) return { ok: false, error: "settlement: not object" };
  const unit = v["unit"];
  if (unit !== "phi") return { ok: false, error: "settlement.unit: bad" };

  const redeem = parseBigIntDec(v["redeemPerShareMicro"]);
  const feeBps = parseBps(v["feeBps"]);
  const feeTiming = v["feeTiming"];

  if (redeem === null) return { ok: false, error: "settlement.redeemPerShareMicro: bad" };
  if (feeBps === null) return { ok: false, error: "settlement.feeBps: bad" };
  if (feeTiming !== "entry" && feeTiming !== "exit") return { ok: false, error: "settlement.feeTiming: bad" };

  return {
    ok: true,
    value: {
      unit: "phi",
      redeemPerShareMicro: redeem as PhiMicro,
      feeBps,
      feeTiming,
    },
  };
};

const decodeRules = (v: unknown): DecodeResult<MarketRules> => {
  if (!isRecord(v)) return { ok: false, error: "rules: not object" };
  const yesCondition = v["yesCondition"];
  if (!isString(yesCondition) || yesCondition.length === 0) return { ok: false, error: "rules.yesCondition: bad" };

  const clarificationsRaw = v["clarifications"];
  const clarifications = isArray(clarificationsRaw)
    ? clarificationsRaw.filter((x): x is string => isString(x) && x.length > 0)
    : undefined;

  const oracleRes = decodeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: oracleRes.error };

  const settlementRes = decodeSettlementPolicy(v["settlement"]);
  if (!settlementRes.ok) return { ok: false, error: settlementRes.error };

  const voidPolicy = v["voidPolicy"];
  if (!isRecord(voidPolicy)) return { ok: false, error: "rules.voidPolicy: bad" };
  const canVoid = voidPolicy["canVoid"];
  const refundMode = voidPolicy["refundMode"];
  if (typeof canVoid !== "boolean") return { ok: false, error: "voidPolicy.canVoid: bad" };
  if (refundMode !== "refund-stake" && refundMode !== "refund-less-fee" && refundMode !== "no-refund") {
    return { ok: false, error: "voidPolicy.refundMode: bad" };
  }

  return {
    ok: true,
    value: {
      yesCondition,
      clarifications,
      oracle: oracleRes.value,
      settlement: settlementRes.value,
      voidPolicy: { canVoid, refundMode },
    },
  };
};

const decodeResolution = (v: unknown): DecodeResult<BinaryMarketState["resolution"] | undefined> => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, error: "resolution: not object" };

  const marketId = v["marketId"];
  if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "resolution.marketId: bad" };

  const outcome = v["outcome"];
  if (!isMarketOutcome(outcome)) return { ok: false, error: "resolution.outcome: bad" };

  const resolvedPulse = parsePulse(v["resolvedPulse"]);
  if (resolvedPulse === null) return { ok: false, error: "resolution.resolvedPulse: bad" };

  const oracleRes = decodeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: `resolution.oracle: ${oracleRes.error}` };

  const evidenceRaw = v["evidence"];
  const evidence =
    isRecord(evidenceRaw)
      ? {
          urls: isArray(evidenceRaw["urls"])
            ? evidenceRaw["urls"].filter((x): x is string => isString(x) && x.length > 0)
            : undefined,
          hashes: isArray(evidenceRaw["hashes"])
            ? evidenceRaw["hashes"]
                .filter((x): x is string => isString(x) && x.length > 0)
                .map((h) => asEvidenceHash(h))
            : undefined,
          summary: isString(evidenceRaw["summary"]) ? evidenceRaw["summary"] : undefined,
        }
      : undefined;

  const disputeRaw = v["dispute"];
  const dispute =
    isRecord(disputeRaw) && disputeRaw["proposedPulse"] !== undefined && disputeRaw["finalPulse"] !== undefined
      ? (() => {
          const proposedPulse = parsePulse(disputeRaw["proposedPulse"]) ?? resolvedPulse;
          const finalPulse = parsePulse(disputeRaw["finalPulse"]) ?? resolvedPulse;

          const metaRaw = disputeRaw["meta"];
          let meta: Readonly<Record<string, string>> | undefined;

          if (isRecord(metaRaw)) {
            const out: Record<string, string> = {};
            for (const [k, val] of Object.entries(metaRaw)) {
              if (isString(val)) out[k] = val;
            }
            meta = Object.keys(out).length > 0 ? out : undefined;
          }

          return { proposedPulse, finalPulse, meta };
        })()
      : undefined;

  return {
    ok: true,
    value: {
      marketId: asMarketId(marketId),
      outcome,
      resolvedPulse,
      oracle: oracleRes.value,
      evidence: evidence ? { urls: evidence.urls, hashes: evidence.hashes, summary: evidence.summary } : undefined,
      dispute,
    },
  };
};

const decodeBinaryMarket = (v: unknown): DecodeResult<BinaryMarket> => {
  if (!isRecord(v)) return { ok: false, error: "market: not object" };

  const defRaw = v["def"];
  const stateRaw = v["state"];
  if (!isRecord(defRaw) || !isRecord(stateRaw)) return { ok: false, error: "market: missing def/state" };

  // def
  const id = defRaw["id"];
  const kind = defRaw["kind"];
  const slug = defRaw["slug"];
  const question = defRaw["question"];
  const category = defRaw["category"];
  const tagsRaw = defRaw["tags"];

  if (!isString(id) || id.length === 0) return { ok: false, error: "def.id: bad" };
  if (kind !== "binary") return { ok: false, error: "def.kind: bad" };
  if (!isString(slug) || slug.length === 0) return { ok: false, error: "def.slug: bad" };
  if (!isString(question) || question.length === 0) return { ok: false, error: "def.question: bad" };

  const cat = parseCategory(category);
  if (cat === null) return { ok: false, error: "def.category: bad" };

  const tags = isArray(tagsRaw) ? tagsRaw.filter((x): x is string => isString(x) && x.length > 0) : [];

  const timingRes = decodeTiming(defRaw["timing"]);
  if (!timingRes.ok) return { ok: false, error: `def.timing: ${timingRes.error}` };

  const rulesRes = decodeRules(defRaw["rules"]);
  if (!rulesRes.ok) return { ok: false, error: `def.rules: ${rulesRes.error}` };

  const definitionHash = isString(defRaw["definitionHash"]) ? asEvidenceHash(defRaw["definitionHash"]) : undefined;

  const def: BinaryMarketDefinition = {
    id: asMarketId(id),
    kind: "binary",
    slug: asMarketSlug(slug),
    question,
    description: isString(defRaw["description"]) ? defRaw["description"] : undefined,
    category: cat,
    tags,
    timing: timingRes.value,
    rules: rulesRes.value,
    iconEmoji: isString(defRaw["iconEmoji"]) ? defRaw["iconEmoji"] : undefined,
    heroImageUrl: isString(defRaw["heroImageUrl"]) ? defRaw["heroImageUrl"] : undefined,
    definitionHash,
  };

  // state
  const status = stateRaw["status"];
  if (!isMarketStatus(status)) return { ok: false, error: "state.status: bad" };

  const venueRes = decodeVenueState(stateRaw["venueState"]);
  if (!venueRes.ok) return { ok: false, error: `state.venueState: ${venueRes.error}` };

  const pricesRes = decodePrices(stateRaw["pricesMicro"]);
  if (!pricesRes.ok) return { ok: false, error: `state.pricesMicro: ${pricesRes.error}` };

  const updatedPulse = parsePulse(stateRaw["updatedPulse"]);
  if (updatedPulse === null) return { ok: false, error: "state.updatedPulse: bad" };

  const liquidityMicro = stateRaw["liquidityMicro"] !== undefined ? parseBigIntDec(stateRaw["liquidityMicro"]) : null;
  const volume24hMicro = stateRaw["volume24hMicro"] !== undefined ? parseBigIntDec(stateRaw["volume24hMicro"]) : null;

  const resolutionRes = decodeResolution(stateRaw["resolution"]);
  if (!resolutionRes.ok) return { ok: false, error: `state.resolution: ${resolutionRes.error}` };

  const state: BinaryMarketState = {
    status,
    venueState: venueRes.value,
    pricesMicro: pricesRes.value,
    liquidityMicro: liquidityMicro !== null ? (liquidityMicro as PhiMicro) : undefined,
    volume24hMicro: volume24hMicro !== null ? (volume24hMicro as PhiMicro) : undefined,
    updatedPulse,
    resolution: resolutionRes.value,
  };

  return { ok: true, value: { def, state } };
};

const decodeMarketListResponse = (
  v: unknown,
): DecodeResult<Readonly<{ markets: readonly Market[]; lastSyncedPulse?: KaiPulse }>> => {
  // Use the declared response union so it’s not dead code (and helps readability).
  const raw = v as SerializedMarketListResponse;

  if (isArray(raw)) {
    const markets: Market[] = [];
    for (const item of raw) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    return { ok: true, value: { markets } };
  }

  if (isRecord(raw) && isArray(raw["markets"])) {
    const rawMarkets = raw["markets"];
    const markets: Market[] = [];
    for (const item of rawMarkets) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    const lastSyncedPulse =
      raw["lastSyncedPulse"] !== undefined ? parsePulse(raw["lastSyncedPulse"]) ?? undefined : undefined;
    return { ok: true, value: { markets, lastSyncedPulse } };
  }

  return { ok: false, error: "unsupported response shape" };
};

/** ---------------------------------------
 * API surface
 * -------------------------------------- */

export type SigilMarketsMarketApiConfig = Readonly<{
  /** If absent, API runs in local/demo mode (seeded). */
  baseUrl?: string;
  /** Path for market list (default: "/markets"). */
  marketsPath?: string;
  /** Optional query params appended to list request. */
  marketsQuery?: Readonly<Record<string, string>>;
  /** Cache policy for market list. */
  cache: Readonly<{ maxAgeMs: number; staleWhileRevalidateMs: number }>;
}>;

export type FetchMarketsResult =
  | Readonly<{ ok: true; markets: readonly Market[]; lastSyncedPulse?: KaiPulse; fromCache: boolean; isStale: boolean }>
  | Readonly<{ ok: false; error: string; fromCache: boolean }>;

const joinUrl = (base: string, path: string): string => {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
};

const withQuery = (url: string, query?: Readonly<Record<string, string>>): string => {
  if (!query) return url;
  const entries = Object.entries(query).filter(([k, val]) => k.length > 0 && val.length > 0);
  if (entries.length === 0) return url;

  const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  for (const [k, val] of entries) u.searchParams.set(k, val);
  return u.toString();
};

/**
 * Local seeded markets for standalone app / offline mode.
 *
 * KKS v1 “Sovereignty Test” (deterministic curriculum):
 * - Every market resolves from Kai-Klok math only.
 * - Every question teaches canon: lattice (11/44/36/6), primes, Fibonacci/Lucas/φ motifs, and cycle structure.
 * - No external reality. No feeds. No weather. No sports teams. No Chronos calendar.
 *
 * Design:
 * - Questions are simple to read.
 * - But hard to answer unless you understand the canon (or learn it by playing).
 */export const seedDemoMarkets = (nowPulse: KaiPulse): readonly Market[] => {
  // Keep category strings stable — your UI filter can key off these exactly.
  const CAT = {
    PULSE: "pulse",
    KAI: "kai",
    CULTURE: "culture",
    FINANCE: "finance",
    CRYPTO: "crypto",
    TECH: "tech",
    WORLD: "world",
    OTHER: "other",
    SPORTS: "sports",
    WEATHER: "weather",
    CALENDAR: "calendar",
  } as const;

  type SeedCategory = typeof CAT[keyof typeof CAT];

  const mk = (
    id: string,
    slug: string,
    question: string,
    opts: Readonly<{
      category: SeedCategory;
      tags?: readonly string[];
      description?: string;
      iconEmoji?: string;
      closeInPulses?: number;
    }>,
  ): Market => {
    const base = makeEmptyBinaryMarket({ id, slug, question, nowPulse });

    const closeIn =
      typeof opts.closeInPulses === "number" && Number.isFinite(opts.closeInPulses) ? opts.closeInPulses : undefined;

    const timing = closeIn
      ? (() => {
          const period = Math.max(1, Math.floor(closeIn));
          const anchoredNow = Math.max(0, Math.floor(nowPulse));
          const cycleIndex = Math.floor(anchoredNow / period);
          const openPulse = (cycleIndex * period) as KaiPulse;
          const closePulse = (openPulse + period) as KaiPulse;

          return {
            ...base.def.timing,
            createdPulse: openPulse,
            openPulse,
            closePulse,
          } as MarketTiming;
        })()
      : base.def.timing;

    return {
      ...base,
      def: {
        ...base.def,
        category: opts.category as unknown as MarketCategory,
        tags: (opts.tags ?? []) as readonly string[],
        description: opts.description ?? base.def.description,
        iconEmoji: opts.iconEmoji ?? base.def.iconEmoji,
        timing,
      },
    };
  };

  // ─────────────────────────────────────────────────────────────
  // KKS v1 Canon constants (discrete lattice)
  // ─────────────────────────────────────────────────────────────
  const PULSES_PER_STEP = 11;
  const STEPS_PER_BEAT = 44;
  const BEATS_PER_DAY = 36;
  const BEATS_PER_ARC = 6;

  const DAYS_PER_WEEK = 6;
  const WEEKS_PER_MONTH = 7;
  const MONTHS_PER_YEAR = 8;

  const P_BEAT = PULSES_PER_STEP * STEPS_PER_BEAT; // 484
  const P_ARC = P_BEAT * BEATS_PER_ARC; // 2,904

  // Discrete lattice day (indexing truth): 36×44×11 = 17,424
  const P_GRID_DAY = P_BEAT * BEATS_PER_DAY; // 17,424

  // Demo day bucket used for seeded markets: lattice day + drift
  // (teaches the canon difference: 17,491 − 17,424 = 67)
  const P_DAY = P_GRID_DAY + 67; // 17,491

  const P_WEEK = P_DAY * DAYS_PER_WEEK; // 6-day Kai week
  const P_MONTH = P_WEEK * WEEKS_PER_MONTH; // 42-day Kai month
  const P_YEAR = P_MONTH * MONTHS_PER_YEAR; // 336-day Kai year

  // Educational note (for your UI / help modal):
  // - StepIndex  = floor((pulse / 11) % 44)      ∈ [0..43]
  // - BeatIndex  = floor((pulse / 484) % 36)     ∈ [0..35]
  // - ArcIndex   = floor(BeatIndex / 6)          ∈ [0..5]
  // - WeekdayIdx = floor((pulse / P_DAY) % 6)    ∈ [0..5]
  //
  // Balance rule (50/50):
  // - We use exact halves (<= 21 in 0..43, <= 17 in 0..35, <= 2 in 0..5),
  //   parity checks, and hash high-bit style checks (0..7 vs 8..f) to keep outcomes ~50/50.

  return [
    /* ─────────────────────────────────────────────────────────────
       🔮 PULSE — Fast Sovereignty Gates (11 / 484 / 2,904)
       “Breathe. Count. Verify.” Quick cycles that train the lattice.
       Each resolves ~50/50 per cycle.
    ───────────────────────────────────────────────────────────── */
mk("m_pulse_step_gate_lowhalf", "step-gate-lowhalf", "Is the next step rising toward clarity?", {
  category: CAT.PULSE,
  tags: ["kks", "step", "11", "44", "gate"],
  iconEmoji: "🧿",
  closeInPulses: PULSES_PER_STEP,
  description:
    "There are 44 steps per beat. When the next step begins, we say YES if it lands in the first 22. This reveals whether the pulse is moving toward ignition or descent.",
}),

mk("m_pulse_beat_gate_lowhalf", "beat-gate-lowhalf", "Will the next beat still echo the morning?", {
  category: CAT.PULSE,
  tags: ["kks", "beat", "484", "36", "gate"],
  iconEmoji: "🥁",
  closeInPulses: P_BEAT,
  description:
    "There are 36 beats in a Kai day. If the next beat is in the first 18, we answer YES. This tests whether the day is still rising or has begun to reflect.",
}),

mk("m_pulse_arc_gate_first_triad", "arc-gate-first-triad", "Are we entering a light-facing arc?", {
  category: CAT.PULSE,
  tags: ["kks", "arc", "6", "gate"],
  iconEmoji: "⚡",
  closeInPulses: P_ARC,
  description:
    "Each day contains 6 arcs. The first 3 (Ignition, Integration, Harmonization) form the arc of ascent. If we’re entering one of these, the answer is YES.",
}),

mk("m_pulse_grid_residue_half", "grid-residue-half", "Is this moment breathing from the lighter side of the grid?", {
  category: CAT.PULSE,
  tags: ["kks", "17424", "residue", "gate"],
  iconEmoji: "🧭",
  closeInPulses: PULSES_PER_STEP,
  description:
    "Each Kai day is made of 17,424 pulses. If the current pulse is less than 8,712, the moment is on the lighter half. This reveals where the resonance rests.",
}),
mk("m_pulse_step_crossing", "step-crossing", "Is the next step crossing a threshold?", {
  category: CAT.PULSE,
  tags: ["kks", "step", "threshold"],
  iconEmoji: "🪜",
  closeInPulses: PULSES_PER_STEP,
  description:
    "Steps move from early to late. YES if the next step lands before the midpoint. This tests whether motion is still building or has begun to resolve.",
}),
mk("m_pulse_beat_weight", "beat-weight", "Will the next beat feel heavier or lighter?", {
  category: CAT.PULSE,
  tags: ["kks", "beat", "weight"],
  iconEmoji: "🥁",
  closeInPulses: P_BEAT,
  description:
    "Beats rise and fall across the day. YES means the next beat lands in the lighter half. You learn to feel weight without numbers.",
}),
mk("m_pulse_arc_turn", "arc-turn", "Is the day turning toward expansion right now?", {
  category: CAT.PULSE,
  tags: ["kks", "arc", "turn"],
  iconEmoji: "🔁",
  closeInPulses: P_ARC,
  description:
    "Arcs have a clear turn point. YES means the next arc begins before the shift from growth to release.",
}),
mk("m_kai_day_rising", "day-rising", "Is today still rising rather than releasing?", {
  category: CAT.KAI,
  tags: ["kks", "day", "rise"],
  iconEmoji: "🌅",
  closeInPulses: P_DAY,
  description:
    "Kai days breathe. YES if today is positioned before its natural midpoint. This trains day‑level intuition.",
}),
mk("m_kai_arc_alignment", "arc-alignment", "Is today aligned with forward motion?", {
  category: CAT.KAI,
  tags: ["kks", "arc", "alignment"],
  iconEmoji: "🌀",
  closeInPulses: P_DAY,
  description:
    "Some arcs push forward, others integrate. YES if today belongs to the forward‑moving half of the arc cycle.",
}),
mk("m_culture_balance_mark", "balance-mark", "Did today close in balance?", {
  category: CAT.CULTURE,
  tags: ["parity", "balance"],
  iconEmoji: "⚖️",
  closeInPulses: P_DAY,
  description:
    "YES if the close lands evenly. This teaches balance without measuring anything.",
}),
mk("m_culture_mirror_close", "mirror-close", "Does today mirror itself cleanly?", {
  category: CAT.CULTURE,
  tags: ["digits", "mirror"],
  iconEmoji: "🪞",
  closeInPulses: P_DAY,
  description:
    "Some closes mirror, others distort. YES if today’s close reflects symmetry.",
}),
mk("m_markets_position_bias", "position-bias", "Is today positioned early in the value cycle?", {
    category: CAT.FINANCE,
  tags: ["kks", "position"],
  iconEmoji: "📍",
  closeInPulses: P_DAY,
  description:
    "Value emerges from where you are, not what you expect. YES if today sits in the early half of the lattice.",
}),
mk("m_markets_arc_pressure", "arc-pressure", "Is pressure building or releasing today?", {
    category: CAT.FINANCE,
  tags: ["kks", "arc"],
  iconEmoji: "⚡",
  closeInPulses: P_DAY,
  description:
    "Arcs compress, then release. YES means pressure is still building.",
}),
mk("m_crypto_proof_tone", "proof-tone", "Does the proof lean light or heavy today?", {
  category: CAT.CRYPTO,
  tags: ["hash", "proof"],
  iconEmoji: "🔐",
  closeInPulses: P_DAY,
  description:
    "Read only the first mark of the proof. YES if it lands in the lighter half. Proof has tone.",
}),
mk("m_crypto_proof_closure", "proof-closure", "Did the proof close cleanly?", {
  category: CAT.CRYPTO,
  tags: ["hash", "closure"],
  iconEmoji: "🧩",
  closeInPulses: P_DAY,
  description:
    "YES if the final mark closes evenly. You’re learning to feel proof endings.",
}),
mk("m_other_scale_conflict", "scale-conflict", "Do the large rhythm and small rhythm disagree?", {
  category: CAT.OTHER,
  tags: ["kks", "residue"],
  iconEmoji: "🧬",
  closeInPulses: P_DAY,
  description:
    "YES if one rhythm says early while another says late. This trains multi‑scale awareness.",
}),
mk("m_other_single_truth", "single-truth", "Is exactly one signal speaking right now?", {
  category: CAT.OTHER,
  tags: ["kks", "xor"],
  iconEmoji: "🔀",
  closeInPulses: P_DAY,
  description:
    "YES if only one of two harmonic checks resolves true. Discernment beats agreement.",
}),
mk("m_tech_fib_turn", "fib-turn", "Is this moment before the Fibonacci turn?", {
  category: CAT.TECH,
  tags: ["harmonic", "fibonacci"],
  iconEmoji: "🌀",
  closeInPulses: P_DAY,
  description:
    "YES if the Fibonacci window is still open. You learn φ by position, not formulas.",
}),
mk("m_tech_resonance_phase", "resonance-phase", "Is resonance rising rather than collapsing?", {
  category: CAT.TECH,
  tags: ["harmonic", "resonance"],
  iconEmoji: "⚡",
  closeInPulses: P_DAY,
  description:
    "YES if the resonance window is in its first half. Physics becomes readable.",
}),

    mk("m_pulse_step_gate_lowhalf", "step-gate-lowhalf", "At the next STEP boundary, is the STEP index in the lower half (0–21)?", {
      category: CAT.PULSE,
      tags: ["kks", "step", "11", "44", "gate"],
      iconEmoji: "🧿",
      closeInPulses: PULSES_PER_STEP,
      description:
        "KKS: 11 pulses/step, 44 steps/beat. Rule: compute StepIndex = floor((pulse/11) % 44). YES if StepIndex ≤ 21 (Fibonacci 21 gate).",
    }),

    mk("m_pulse_beat_gate_lowhalf", "beat-gate-lowhalf", "At the next BEAT boundary, is the BEAT index in the lower half (0–17)?", {
      category: CAT.PULSE,
      tags: ["kks", "beat", "484", "36", "gate"],
      iconEmoji: "🥁",
      closeInPulses: P_BEAT,
      description:
        "KKS: 484 pulses/beat, 36 beats/day. Rule: BeatIndex = floor((pulse/484) % 36). YES if BeatIndex ≤ 17.",
    }),

    mk("m_pulse_arc_gate_first_triad", "arc-gate-first-triad", "At the next ARC boundary, is the ARC index in the first triad (0–2)?", {
      category: CAT.PULSE,
      tags: ["kks", "arc", "6", "gate"],
      iconEmoji: "⚡",
      closeInPulses: P_ARC,
      description:
        "KKS: 6 beats/arc (2,904 pulses). Rule: ArcIndex = floor(BeatIndex/6). YES if ArcIndex ∈ {0,1,2}.",
    }),

    mk("m_pulse_grid_residue_half", "grid-residue-half", "At the next STEP boundary, is the lattice residue in the first half of the 17,424 grid?", {
      category: CAT.PULSE,
      tags: ["kks", "17424", "residue", "gate"],
      iconEmoji: "🧭",
      closeInPulses: PULSES_PER_STEP,
      description:
        "Rule: Residue = pulse % 17,424. YES if Residue < 8,712. (Teaches the 36×44×11 lattice day.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🌈 KAI — Daily Coherence Tests (Weekday + Arc + Position)
       Each resolves once per Kai day bucket. All ~50/50.
    ───────────────────────────────────────────────────────────── */

    mk("m_kai_weekday_triad_solar", "weekday-solar-triad", "Is today a SOLAR weekday (Solhara / Aquaris / Flamora)?", {
      category: CAT.KAI,
      tags: ["kks", "weekday", "6", "triad"],
      iconEmoji: "☀️",
      closeInPulses: P_DAY,
      description:
        "KKS week = 6 days. Rule: WeekdayIdx = floor((pulse/P_DAY) % 6). YES if WeekdayIdx ∈ {0,1,2}.",
    }),

    mk("m_kai_arc_triad_light", "arc-light-triad", "Is today in a LIGHT arc (Ignition / Integration / Harmonization)?", {
      category: CAT.KAI,
      tags: ["kks", "arc", "6", "triad"],
      iconEmoji: "🌀",
      closeInPulses: P_DAY,
      description:
        "KKS day has 6 arcs. Rule: ArcIndex = floor(BeatIndex/6). YES if ArcIndex ∈ {0,1,2}.",
    }),

    mk("m_kai_step_fib_gate_21", "step-fib-21", "Is today’s STEP gate below Fibonacci 21 (StepIndex ≤ 21)?", {
      category: CAT.KAI,
      tags: ["phi", "fibonacci", "21", "kks", "step"],
      iconEmoji: "🌀",
      closeInPulses: P_DAY,
      description:
        "Rule: StepIndex = floor((pulse/11) % 44). YES if StepIndex ≤ 21. (21 is the φ-teaching threshold.)",
    }),

    mk("m_kai_beat_half", "beat-half", "Is today’s BEAT position in the first half of the day (BeatIndex ≤ 17)?", {
      category: CAT.KAI,
      tags: ["kks", "beat", "36", "half"],
      iconEmoji: "🥁",
      closeInPulses: P_DAY,
      description:
        "Rule: BeatIndex = floor((pulse/484) % 36). YES if BeatIndex ≤ 17. (Teaches 36 beats/day.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🧾 CULTURE — Number Literacy (Mirror / Symmetry / Parity)
       Not “news”. Culture here is: can you read the stamp.
       Balanced ~50/50 using parity / halves.
    ───────────────────────────────────────────────────────────── */

    mk("m_culture_close_digit_sum_even", "close-digit-sum-even", "Is the digit-sum of today’s CLOSE pulse EVEN?", {
      category: CAT.CULTURE,
      tags: ["digits", "parity", "literacy"],
      iconEmoji: "🧾",
      closeInPulses: P_DAY,
      description:
        "Rule: sum the decimal digits of CLOSE pulse. YES if the sum is even. (Sovereignty = fast verification.)",
    }),

    mk("m_culture_close_last_digit_even", "close-last-digit-even", "Is the last digit of today’s CLOSE pulse EVEN?", {
      category: CAT.CULTURE,
      tags: ["digits", "parity", "literacy"],
      iconEmoji: "⚖️",
      closeInPulses: P_DAY,
      description:
        "Rule: look at the last decimal digit of CLOSE pulse. YES if it’s 0/2/4/6/8. (Simple. Absolute. Deterministic.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🪙 MARKETS — φ Gates (value literacy without external prices)
       We teach φ by thresholds, not feeds.
       Balanced using exact halves.
    ───────────────────────────────────────────────────────────── */

    mk("m_markets_grid_half_gate", "grid-half-gate", "Does today’s lattice residue land in the first half of 17,424 (Residue < 8,712)?", {
      category: CAT.FINANCE,
      tags: ["kks", "17424", "gate", "phi"],
      iconEmoji: "🧭",
      closeInPulses: P_DAY,
      description:
        "Rule: Residue = CLOSE pulse % 17,424. YES if Residue < 8,712. (Teaches the lattice day as an exact witness.)",
    }),

    mk("m_markets_arc_half_gate", "arc-half-gate", "Does today’s CLOSE pulse land in the first half of an ARC (Residue < 1,452)?", {
      category: CAT.FINANCE,
      tags: ["kks", "arc", "2904", "gate"],
      iconEmoji: "⚡",
      closeInPulses: P_DAY,
      description:
        "Rule: Residue = CLOSE pulse % 2,904. YES if Residue < 1,452. (Half-arc gate = coherence balance.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       💰 FINANCE — Stewardship Tests (clean arithmetic, no oracle)
       Balanced ~50/50, trains the mind to measure.
    ───────────────────────────────────────────────────────────── */

    mk("m_finance_close_mod_484_lowhalf", "close-mod484-lowhalf", "Is today’s CLOSE pulse within the first half of a BEAT (CLOSE % 484 < 242)?", {
      category: CAT.FINANCE,
      tags: ["kks", "484", "stewardship", "half"],
      iconEmoji: "📏",
      closeInPulses: P_DAY,
      description:
        "Rule: CLOSE % 484 < 242. (Teaches 44×11 = 484, and that stewardship is residue-reading.)",
    }),

    mk("m_finance_day_index_even", "day-index-even", "Is today’s Kai DAY index EVEN?", {
      category: CAT.FINANCE,
      tags: ["kks", "day", "parity", "stewardship"],
      iconEmoji: "🪙",
      closeInPulses: P_DAY,
      description:
        "Rule: DayIndex = floor(CLOSE / P_DAY). YES if DayIndex is even. (Discipline: count your days by pulse.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🔐 CRYPTO — Witness Games (deterministic hash bits)
       If you can compute the witness, you’re sovereign.
       Each is ~50/50 by construction.
    ───────────────────────────────────────────────────────────── */

    mk("m_crypto_close_hash_first_hex_low", "close-hash-firsthex-low", "Is the FIRST hex digit of hash(CLOSE pulse) in 0–7?", {
      category: CAT.CRYPTO,
      tags: ["hash", "proof", "witness", "50-50"],
      iconEmoji: "🔐",
      closeInPulses: P_DAY,
      description:
        "Rule: take hash(CLOSE pulse). Read the FIRST hex digit. YES if it’s 0–7 (high-bit = 0).",
    }),

    mk("m_crypto_close_hash_last_hex_even", "close-hash-lasthex-even", "Is the LAST hex digit of hash(CLOSE pulse) EVEN?", {
      category: CAT.CRYPTO,
      tags: ["hash", "proof", "witness", "parity"],
      iconEmoji: "⚖️",
      closeInPulses: P_DAY,
      description:
        "Rule: take hash(CLOSE pulse). Read the LAST hex digit. YES if it’s even (0/2/4/6/8/a/c/e).",
    }),

    /* ─────────────────────────────────────────────────────────────
       🧪 TECH — Protocol Competency (learn the machine)
       No invariants as markets. Only variable gates that reference invariants.
    ───────────────────────────────────────────────────────────── */

    mk("m_tech_grid_day_boundary_half", "gridday-boundary-half", "At CLOSE, is (CLOSE % 17,424) in the first half ( < 8,712 )?", {
      category: CAT.TECH,
      tags: ["kks", "17424", "protocol", "gate"],
      iconEmoji: "🧠",
      closeInPulses: P_DAY,
      description:
        "Teaches the discrete lattice day. Variable outcome. Sovereigns read residues, not opinions.",
    }),

    mk("m_tech_step_gate_evenness", "stepindex-even", "Is today’s StepIndex EVEN?", {
      category: CAT.TECH,
      tags: ["kks", "step", "44", "parity"],
      iconEmoji: "🧮",
      closeInPulses: P_DAY,
      description:
        "Rule: StepIndex = floor((CLOSE/11) % 44). YES if StepIndex is even. (Fast lattice computation.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🌍 WORLD — Long Cycles (6 / 7 / 8) without Chronos
       Balanced gates on week/month/year boundaries.
    ───────────────────────────────────────────────────────────── */

    mk("m_world_week_index_even", "week-index-even", "At the next KKS WEEK boundary, is the WeekIndex EVEN?", {
      category: CAT.WORLD,
      tags: ["kks", "week", "6", "parity"],
      iconEmoji: "🌍",
      closeInPulses: P_WEEK,
      description:
        "Rule: WeekIndex = floor((CLOSE / P_WEEK)). YES if even. (KKS week = 6 days.)",
    }),

    mk("m_world_month_half_gate", "month-half-gate", "At the next KKS MONTH boundary, is MonthIndex in the first half (0–3 of 0–7)?", {
      category: CAT.WORLD,
      tags: ["kks", "month", "7", "8", "half"],
      iconEmoji: "🗺️",
      closeInPulses: P_MONTH,
      description:
        "KKS: 7 weeks/month, 8 months/year. Rule: MonthIndex = floor((CLOSE / P_MONTH) % 8). YES if 0..3.",
    }),

    mk("m_world_year_index_even", "year-index-even", "At the next KKS YEAR boundary, is YearIndex EVEN?", {
      category: CAT.WORLD,
      tags: ["kks", "year", "336", "parity"],
      iconEmoji: "🏛️",
      closeInPulses: P_YEAR,
      description:
        "KKS year = 336 days (8 months × 7 weeks × 6 days). Rule: YearIndex = floor(CLOSE / P_YEAR). YES if even.",
    }),

    /* ─────────────────────────────────────────────────────────────
       🧩 OTHER — Mastery Gates (hard but clean)
       These feel like riddles, but they are pure math.
    ───────────────────────────────────────────────────────────── */

    mk("m_other_arc_vs_beat_residue", "arc-vs-beat", "At CLOSE, is the ARC residue smaller than the BEAT residue?", {
      category: CAT.OTHER,
      tags: ["kks", "residue", "mastery"],
      iconEmoji: "🧩",
      closeInPulses: P_DAY,
      description:
        "Rule: a = CLOSE % 2,904; b = CLOSE % 484. YES if a < b. (Trains multi-scale residue intuition.)",
    }),

    mk("m_other_grid_vs_arc_half_xor", "grid-xor-arc", "At CLOSE, is exactly ONE of these true: (grid residue in first half) XOR (arc residue in first half)?", {
      category: CAT.OTHER,
      tags: ["kks", "xor", "mastery", "gate"],
      iconEmoji: "🧬",
      closeInPulses: P_DAY,
      description:
        "Rule: g = (CLOSE%17,424 < 8,712), a = (CLOSE%2,904 < 1,452). YES if (g !== a). Balanced and deep.",
    }),

    /* ─────────────────────────────────────────────────────────────
       🏁 SPORTS — Competitive Reasoning Trials
       Sports here = proving skill under rules (not teams).
    ───────────────────────────────────────────────────────────── */

    mk("m_sports_beatindex_even", "beatindex-even", "Is today’s BeatIndex EVEN?", {
      category: CAT.SPORTS,
      tags: ["kks", "beat", "36", "trial"],
      iconEmoji: "🏁",
      closeInPulses: P_DAY,
      description:
        "Rule: BeatIndex = floor((CLOSE/484) % 36). YES if even. (A clean skill check.)",
    }),

    mk("m_sports_arcindex_first_triad", "arcindex-first-triad", "Is today’s ArcIndex in the first triad (0–2)?", {
      category: CAT.SPORTS,
      tags: ["kks", "arc", "6", "trial"],
      iconEmoji: "🏋️",
      closeInPulses: P_DAY,
      description:
        "Rule: ArcIndex = floor(BeatIndex/6). YES if 0..2. (Triad mastery.)",
    }),

    /* ─────────────────────────────────────────────────────────────
       🌦️ WEATHER — Coherence Climate (pattern density, not sky)
       Balanced gates that train calm observation.
    ───────────────────────────────────────────────────────────── */

    mk("m_weather_grid_climate_light", "climate-light", "Is today’s lattice residue in the first half (a LIGHT climate)?", {
      category: CAT.WEATHER,
      tags: ["kks", "17424", "climate", "coherence"],
      iconEmoji: "🌤️",
      closeInPulses: P_DAY,
      description:
        "Rule: CLOSE%17,424 < 8,712. The ‘weather’ is your coherence climate — measurable, not vibes.",
    }),

    mk("m_weather_arc_climate_calm", "climate-calm", "Is today’s arc residue in the first half (a CALM climate)?", {
      category: CAT.WEATHER,
      tags: ["kks", "arc", "climate", "coherence"],
      iconEmoji: "🌫️",
      closeInPulses: P_DAY,
      description:
        "Rule: CLOSE%2,904 < 1,452. Calm = early arc; storm = late arc. Deterministic entrainment.",
    }),

    /* ─────────────────────────────────────────────────────────────
       🗓️ CALENDAR — Sovereign Calendar Gates (6/7/8)
       These resolve on calendar boundaries only.
    ───────────────────────────────────────────────────────────── */

    mk("m_calendar_week_boundary_hash_low", "week-hash-low", "At the next WEEK boundary, is the first hex digit of hash(CLOSE) in 0–7?", {
      category: CAT.CALENDAR,
      tags: ["kks", "week", "hash", "witness"],
      iconEmoji: "🗓️",
      closeInPulses: P_WEEK,
      description:
        "Boundary witness: hash(CLOSE) first hex digit in 0–7. Teaches: week = 6 Kai days, verified by proof not authority.",
    }),

    mk("m_calendar_month_boundary_half_gate", "month-boundary-half", "At the next MONTH boundary, is (CLOSE % 17,424) in the first half?", {
      category: CAT.CALENDAR,
      tags: ["kks", "month", "17424", "gate"],
      iconEmoji: "📅",
      closeInPulses: P_MONTH,
      description:
        "Month = 7 weeks = 42 days. We read boundary alignment by lattice residue. YES if CLOSE%17,424 < 8,712.",
    }),
        /* ─────────────────────────────────────────────────────────────
       🧬 HARMONIC PHYSICS — Sovereignty Science (deterministic, 50/50)
       These are not “vibes.” They are gates you can compute.
       Every gate is built on exact halves so YES/NO stays ~50/50,
       while training Fibonacci / lattice / resonance logic.
    ───────────────────────────────────────────────────────────── */

    // Fibonacci Gate 34 (exact 50/50)
    mk("m_tech_fib_gate_34", "fib-gate-34", "Harmonic Gate 34: Is (CLOSE % 34) in the first half (0–16)?", {
      category: CAT.TECH,
      tags: ["harmonic", "physics", "fibonacci", "34", "gate", "50-50"],
      iconEmoji: "🧬",
      closeInPulses: P_DAY,
      description:
        "Fibonacci Gate: 34 is a Fibonacci number. Rule: r = CLOSE % 34. YES if r < 17. Exact half-split → true 50/50.",
    }),

    // Fibonacci Gate 144 (exact 50/50)
    mk("m_tech_fib_gate_144", "fib-gate-144", "Harmonic Gate 144: Is (CLOSE % 144) in the first half (0–71)?", {
      category: CAT.TECH,
      tags: ["harmonic", "physics", "fibonacci", "144", "gate", "50-50"],
      iconEmoji: "🌀",
      closeInPulses: P_DAY,
      description:
        "Fibonacci Gate: 144 is Fibonacci. Rule: r = CLOSE % 144. YES if r < 72. Exact half-split → true 50/50.",
    }),

    // 13-Node Harmonic Shell (made exact 50/50 by doubling)
    mk("m_tech_shell_gate_26", "shell-gate-26", "13-Node Shell Gate: Is (CLOSE % 26) in the first half (0–12)?", {
      category: CAT.TECH,
      tags: ["harmonic", "physics", "shell", "13", "26", "gate", "50-50"],
      iconEmoji: "💠",
      closeInPulses: P_DAY,
      description:
        "Shell literacy: 13 is a harmonic node count. To keep exact 50/50 we use 26. Rule: r = CLOSE % 26. YES if r < 13.",
    }),

    // 137-Resonance Gate (kept exact 50/50 by doubling to 274)
    mk("m_tech_resonance_gate_274", "resonance-gate-274", "Resonance Gate 274: Is (CLOSE % 274) in the first half (0–136)?", {
      category: CAT.TECH,
      tags: ["harmonic", "physics", "resonance", "274", "gate", "50-50"],
      iconEmoji: "⚡",
      closeInPulses: P_DAY,
      description:
        "Resonance gate: we use 274 (= 2×137) so the split is exact. Rule: r = CLOSE % 274. YES if r < 137.",
    }),

    // Resonance Lock (XOR of two exact 50/50 gates → balanced + harder)
    mk(
      "m_markets_resonance_lock_xor",
      "resonance-lock",
      "Resonance Lock: Is exactly ONE true — (CLOSE%484 < 242) XOR (StepIndex is EVEN)?",
      {
        category: CAT.FINANCE,
        tags: ["harmonic", "physics", "resonance", "xor", "kks", "484", "44", "50-50"],
        iconEmoji: "🔒",
        closeInPulses: P_DAY,
        description:
          "Two witnesses: (1) BeatPhaseHalf: CLOSE%484 < 242. (2) StepPolarity: StepIndex even. YES only if they disagree (XOR). Balanced + trains multi-scale thinking.",
      },
    ),

    // Fibonacci Cross-Gate (XOR of exact Fibonacci halves → balanced + teaches φ-lineage)
    mk(
      "m_other_fib_cross_gate_xor",
      "fib-cross-gate",
      "Fibonacci Cross-Gate: Is exactly ONE true — (CLOSE%34 < 17) XOR (CLOSE%144 < 72)?",
      {
        category: CAT.OTHER,
        tags: ["harmonic", "physics", "fibonacci", "xor", "34", "144", "50-50"],
        iconEmoji: "🧩",
        closeInPulses: P_DAY,
        description:
          "Cross-gate training: two Fibonacci gates, one verdict. YES only if exactly one gate is open. This forces real computation, not guessing.",
      },
    ),

    // Lattice vs Fibonacci Gate (balanced XOR, teaches 17,424 lattice day + Fibonacci gate)
    mk(
      "m_other_lattice_vs_fib_xor",
      "lattice-vs-fib",
      "Lattice vs Fibonacci: Is exactly ONE true — (CLOSE%17,424 < 8,712) XOR (CLOSE%144 < 72)?",
      {
        category: CAT.OTHER,
        tags: ["harmonic", "physics", "kks", "17424", "fibonacci", "144", "xor", "50-50"],
        iconEmoji: "🧿",
        closeInPulses: P_DAY,
        description:
          "This is the sovereignty test: lattice witness (17,424) versus Fibonacci witness (144). YES only if they disagree (XOR).",
      },
    ),

    // Beat Gate on Fibonacci window (fast + exact, resolves often)
    mk("m_pulse_fib_gate_34_next_step", "fib34-next-step", "Next STEP: Is (pulse % 34) in the first half (0–16)?", {
      category: CAT.PULSE,
      tags: ["harmonic", "physics", "fibonacci", "34", "step", "50-50"],
      iconEmoji: "🧬",
      closeInPulses: PULSES_PER_STEP,
      description:
        "Instant Fibonacci literacy. Rule at the next step boundary: r = pulse % 34. YES if r < 17. Exact half-split.",
    }),

    // Beat Gate on Fibonacci 144 at beat boundary (slower, but teaches beat discipline)
    mk("m_pulse_fib_gate_144_next_beat", "fib144-next-beat", "Next BEAT: Is (pulse % 144) in the first half (0–71)?", {
      category: CAT.PULSE,
      tags: ["harmonic", "physics", "fibonacci", "144", "beat", "50-50"],
      iconEmoji: "🥁",
      closeInPulses: P_BEAT,
      description:
        "Beat-disciplined Fibonacci gate. Rule at the next beat boundary: r = pulse % 144. YES if r < 72. Exact half-split.",
    }),

  ];
};


/**
 * Fetch the market list.
 * - Remote mode if baseUrl provided.
 * - Local mode otherwise (seeded).
 */
export const fetchMarkets = async (cfg: SigilMarketsMarketApiConfig, nowPulse: KaiPulse): Promise<FetchMarketsResult> => {
  if (!cfg.baseUrl) {
    return { ok: true, markets: seedDemoMarkets(nowPulse), lastSyncedPulse: nowPulse, fromCache: true, isStale: false };
  }

  const path = cfg.marketsPath ?? "/markets";
  const url = withQuery(joinUrl(cfg.baseUrl, path), cfg.marketsQuery);

  const res = await cachedJsonFetch<Readonly<{ markets: readonly Market[]; lastSyncedPulse?: KaiPulse }>>({
    url,
    policy: { maxAgeMs: cfg.cache.maxAgeMs, staleWhileRevalidateMs: cfg.cache.staleWhileRevalidateMs, persist: true },
    mode: "cache-first",
    decode: decodeMarketListResponse,
  });

  if (!res.ok) return { ok: false, error: res.error, fromCache: res.fromCache };

  return {
    ok: true,
    markets: res.value.markets,
    lastSyncedPulse: res.value.lastSyncedPulse,
    fromCache: res.fromCache,
    isStale: res.isStale,
  };
};

/** Default config (safe for both standalone and integrated apps). */
export const defaultMarketApiConfig = (): SigilMarketsMarketApiConfig => {
  // Global override hook: window.__SIGIL_MARKETS_API_BASE__ = "https://…"
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_API_BASE__"]) ? (g["__SIGIL_MARKETS_API_BASE__"] as string) : undefined;

  return {
    baseUrl: base,
    marketsPath: "/markets",
    cache: { maxAgeMs: 12_000, staleWhileRevalidateMs: 60_000 },
  };
};
