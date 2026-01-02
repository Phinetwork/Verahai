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
  MarketId,
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
  EvidenceHash,
} from "../types/marketTypes";

import {
  asEvidenceHash,
  asMarketId,
  asMarketSlug,
  asOracleId,
  isMarketOutcome,
  isMarketStatus,
  ONE_PHI_MICRO,
  type MarketOutcome,
} from "../types/marketTypes";

import { cachedJsonFetch, type DecodeResult } from "./cacheApi";
import { makeEmptyBinaryMarket } from "../state/marketStore";

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

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
  return { ok: true, value: { yes: yes as PriceMicro, no: no as PriceMicro } };
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
      return bi === null ? undefined : (bi as PriceMicro);
    };

    const parseDepth = (x: unknown): readonly ClobPriceLevel[] | undefined => {
      if (!isArray(x)) return undefined;
      const out: ClobPriceLevel[] = [];
      for (let i = 0; i < x.length; i += 1) {
        const item = x[i];
        if (!isRecord(item)) continue;
        const price = parseBigIntDec(item["priceMicro"]);
        const size = parseBigIntDec(item["sizeMicro"]);
        if (price === null || size === null) continue;
        out.push({ priceMicro: price as PriceMicro, sizeMicro: size as ShareMicro });
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
  const clarifications =
    isArray(clarificationsRaw) ? clarificationsRaw.filter((x): x is string => isString(x) && x.length > 0) : undefined;

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
          urls: isArray(evidenceRaw["urls"]) ? evidenceRaw["urls"].filter((x): x is string => isString(x) && x.length > 0) : undefined,
          hashes: isArray(evidenceRaw["hashes"])
            ? evidenceRaw["hashes"].filter((x): x is string => isString(x) && x.length > 0).map((h) => asEvidenceHash(h))
            : undefined,
          summary: isString(evidenceRaw["summary"]) ? evidenceRaw["summary"] : undefined,
        }
      : undefined;

  const disputeRaw = v["dispute"];
  const dispute =
    isRecord(disputeRaw) && disputeRaw["proposedPulse"] !== undefined && disputeRaw["finalPulse"] !== undefined
      ? {
          proposedPulse: parsePulse(disputeRaw["proposedPulse"]) ?? resolvedPulse,
          finalPulse: parsePulse(disputeRaw["finalPulse"]) ?? resolvedPulse,
          meta: isRecord(disputeRaw["meta"])
            ? Object.fromEntries(Object.entries(disputeRaw["meta"]).filter(([, vv]): vv is string => isString(vv)))
            : undefined,
        }
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
    slug: asMarketSlug(isString(defRaw["slug"]) ? defRaw["slug"] : slug),
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

const decodeMarketListResponse = (v: unknown): DecodeResult<Readonly<{ markets: readonly Market[]; lastSyncedPulse?: KaiPulse }>> => {
  const arr = isArray(v) ? v : null;

  if (arr) {
    const markets: Market[] = [];
    for (const item of arr) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    return { ok: true, value: { markets } };
  }

  if (isRecord(v) && isArray(v["markets"])) {
    const rawMarkets = v["markets"];
    const markets: Market[] = [];
    for (const item of rawMarkets) {
      const dm = decodeBinaryMarket(item);
      if (dm.ok) markets.push(dm.value);
    }
    const lastSyncedPulse = v["lastSyncedPulse"] !== undefined ? parsePulse(v["lastSyncedPulse"]) ?? undefined : undefined;
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
  const entries = Object.entries(query).filter(([k, v]) => k.length > 0 && v.length > 0);
  if (entries.length === 0) return url;

  const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  for (const [k, v] of entries) u.searchParams.set(k, v);
  return u.toString();
};

/**
 * Local seeded markets for standalone app / offline mode.
 * Deterministic enough for UI; real deployments will use remote list.
 */
export const seedDemoMarkets = (nowPulse: KaiPulse): readonly Market[] => {
  const mk = (id: string, slug: string, q: string): Market =>
    makeEmptyBinaryMarket({ id, slug, question: q, nowPulse });

  return [
    mk("m_weather_rain_tomorrow", "rain-tomorrow", "Will it rain tomorrow in NYC?"),
    mk("m_weather_snow_week", "snow-this-week", "Will NYC get measurable snow this week?"),
    mk("m_crypto_btc_100k", "btc-100k", "Will BTC touch 100k before the close?"),
    mk("m_sports_knicks_win", "knicks-win", "Will the Knicks win their next game?"),
    mk("m_world_launch", "rocket-launch", "Will the next launch succeed on the first attempt?"),
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
  // If you want a global override, set: window.__SIGIL_MARKETS_API_BASE__ = "https://…"
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_API_BASE__"]) ? (g["__SIGIL_MARKETS_API_BASE__"] as string) : undefined;

  return {
    baseUrl: base,
    marketsPath: "/markets",
    cache: { maxAgeMs: 12_000, staleWhileRevalidateMs: 60_000 },
  };
};
