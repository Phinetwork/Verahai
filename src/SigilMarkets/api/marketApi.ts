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
 * IMPORTANT:
 * - Categories are set explicitly so the UI can filter (Sports tab shows sports, etc.).
 * - We keep each market ID unique (no duplicates like “btc-green” + “btc-red”).
 */
export const seedDemoMarkets = (nowPulse: KaiPulse): readonly Market[] => {
  // Keep category strings stable — your UI filter can key off these exactly.
  const CAT = {
    PULSE: "pulse",
    KAI: "kai",
    CULTURE: "culture",
    MARKETS: "markets",
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

    const closeIn = typeof opts.closeInPulses === "number" && Number.isFinite(opts.closeInPulses) ? opts.closeInPulses : undefined;
    const timing = closeIn
      ? (() => {
          const period = Math.max(1, Math.floor(closeIn));
          const anchoredNow = Math.max(0, Math.floor(nowPulse));
          const cycleIndex = Math.floor(anchoredNow / period);
          const openPulse = (cycleIndex * period) as KaiPulse;
          const closePulse = (openPulse + period) as KaiPulse;

          return {
            ...base.def.timing,
            // Anchor to genesis pulse so cycles are stable across reloads.
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

  return [
    /* ─────────────────────────────────────────────────────────────
       🔮 PULSE (Zero-API games — fully deterministic in-app)
       - These are “pure Kai + seed rules” games.
       - Category: pulse
       - Tags: pulse, game
    ───────────────────────────────────────────────────────────── */

    /* Coin / Dice / Cards / Roulette */
    mk("m_pulse_coinflip_next", "coinflip-next", "Will the next Kai coinflip land HEADS?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "coinflip"],
      iconEmoji: "🪙",
      closeInPulses: 44,
    }),
    mk("m_pulse_coinflip_bestof3_heads", "coinflip-bestof3", "Will HEADS win best-of-3 (next 3 flips)?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "coinflip"],
      iconEmoji: "🪙",
      closeInPulses: 44 * 3,
    }),
    mk("m_pulse_coinflip_streak3_today", "coinflip-streak3", "Will there be a 3-in-a-row HEADS streak today?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "coinflip", "today"],
      iconEmoji: "🧬",
      closeInPulses: 17_491,
    }),

    mk("m_pulse_dice_six_next", "dice-six-next", "Will the next Kai dice roll be a 6?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "dice"],
      iconEmoji: "🎲",
      closeInPulses: 44,
    }),
    mk("m_pulse_dice_even_next", "dice-even-next", "Will the next Kai dice roll be EVEN?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "dice"],
      iconEmoji: "🎲",
      closeInPulses: 44,
    }),
    mk("m_pulse_dice_sum_7_next2", "dice-sum7-next2", "Will the next TWO Kai dice rolls sum to 7?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "dice"],
      iconEmoji: "🎲",
      closeInPulses: 44 * 2,
    }),

    mk("m_pulse_roulette_red_next", "roulette-red-next", "Will the next Kai roulette spin land RED?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "roulette"],
      iconEmoji: "🎰",
      closeInPulses: 44,
    }),
    mk("m_pulse_roulette_zero_next", "roulette-zero-next", "Will the next Kai roulette spin land on 0?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "roulette"],
      iconEmoji: "🎯",
      closeInPulses: 44,
    }),

    mk("m_pulse_card_ace_next", "card-ace-next", "Will the next Kai card draw be an ACE?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "cards"],
      iconEmoji: "🃏",
      closeInPulses: 44,
    }),
    mk("m_pulse_card_face_next", "card-face-next", "Will the next Kai card draw be a FACE card (J/Q/K)?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "cards"],
      iconEmoji: "🃏",
      closeInPulses: 44,
    }),
    mk("m_pulse_card_heart_next", "card-heart-next", "Will the next Kai card draw be a HEART?", {
      category: CAT.PULSE,
      tags: ["pulse", "game", "cards"],
      iconEmoji: "♥️",
      closeInPulses: 44,
    }),

    /* Hash / seed micro-proofs */
    mk("m_pulse_hash_even_next", "hash-even-next", "Will the next pulse-hash end in an even hex digit?", {
      category: CAT.PULSE,
      tags: ["pulse", "hash"],
      iconEmoji: "🔐",
      closeInPulses: 11,
    }),
    mk("m_pulse_hash_00_next", "hash-00-next", "Will the next pulse-hash start with '00'?", {
      category: CAT.PULSE,
      tags: ["pulse", "hash"],
      iconEmoji: "🔐",
      closeInPulses: 11,
    }),
    mk("m_pulse_hash_contains_dead_today", "hash-dead-today", "Will any pulse-hash contain 'dead' today?", {
      category: CAT.PULSE,
      tags: ["pulse", "hash", "today"],
      iconEmoji: "🧾",
      closeInPulses: 17_491,
    }),

    /* Lattice mini-games (KKS indexing) */
    mk("m_pulse_next_beat_boundary_even", "next-beat-even", "Will the next BEAT boundary pulse be EVEN?", {
      category: CAT.PULSE,
      tags: ["pulse", "kai", "lattice"],
      iconEmoji: "🧿",
      closeInPulses: 44,
    }),
    mk("m_pulse_next_step_boundary_even", "next-step-even", "Will the next STEP boundary pulse be EVEN?", {
      category: CAT.PULSE,
      tags: ["pulse", "kai", "lattice"],
      iconEmoji: "🧿",
      closeInPulses: 11,
    }),
    mk("m_pulse_next_beat_prime", "next-beat-prime", "Will the next moment's beat be PRIME?", {
      category: CAT.PULSE,
      tags: ["pulse", "kai", "lattice"],
      iconEmoji: "🔢",
      closeInPulses: 44,
    }),

    /* ─────────────────────────────────────────────────────────────
       🌈 KAI (Daily Oracles — real Kai math, no vibes)
       - These are computed from your KKS engine (weekday/arc/seed residues).
       - Category: kai
    ───────────────────────────────────────────────────────────── */

    /* Kai weekday (6) */
    mk("m_kai_weekday_solhara_today", "weekday-solhara", "Will today's Kai weekday be Solhara?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "☀️",
      closeInPulses: 17_491,
    }),
    mk("m_kai_weekday_aquaris_today", "weekday-aquaris", "Will today's Kai weekday be Aquaris?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "💧",
      closeInPulses: 17_491,
    }),
    mk("m_kai_weekday_flamora_today", "weekday-flamora", "Will today's Kai weekday be Flamora?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "🔥",
      closeInPulses: 17_491,
    }),
    mk("m_kai_weekday_verdari_today", "weekday-verdari", "Will today's Kai weekday be Verdari?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "🌿",
      closeInPulses: 17_491,
    }),
    mk("m_kai_weekday_sonari_today", "weekday-sonari", "Will today's Kai weekday be Sonari?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "🎶",
      closeInPulses: 17_491,
    }),
    mk("m_kai_weekday_kaelith_today", "weekday-kaelith", "Will today's Kai weekday be Kaelith?", {
      category: CAT.KAI,
      tags: ["kai", "weekday"],
      iconEmoji: "🪞",
      closeInPulses: 17_491,
    }),

    /* Kai arc (6) */
    mk("m_kai_arc_ignition_today", "arc-ignition", "Will today's Kai arc be Ignition?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "⚡",
      closeInPulses: 17_491,
    }),
    mk("m_kai_arc_integration_today", "arc-integration", "Will today's Kai arc be Integration?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "🧩",
      closeInPulses: 17_491,
    }),
    mk("m_kai_arc_harmonization_today", "arc-harmonization", "Will today's Kai arc be Harmonization?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "🌀",
      closeInPulses: 17_491,
    }),
    mk("m_kai_arc_reflection_today", "arc-reflection", "Will today's Kai arc be Reflection?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "🪞",
      closeInPulses: 17_491,
    }),
    mk("m_kai_arc_purification_today", "arc-purification", "Will today's Kai arc be Purification?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "💠",
      closeInPulses: 17_491,
    }),
    mk("m_kai_arc_dream_today", "arc-dream", "Will today's Kai arc be Dream?", {
      category: CAT.KAI,
      tags: ["kai", "arc"],
      iconEmoji: "🌙",
      closeInPulses: 17_491,
    }),

    /* Day-seed residues (derived from dayStartPulse % 36/%44/%11) */
    mk("m_kai_seedbeat_prime_today", "seedbeat-prime", "Is today's Day-Seed Beat PRIME?", {
      category: CAT.KAI,
      tags: ["kai", "seed", "beat"],
      iconEmoji: "🔢",
      closeInPulses: 17_491,
    }),
    mk("m_kai_seedstep_div11_today", "seedstep-div11", "Is today's Day-Seed Step divisible by 11?", {
      category: CAT.KAI,
      tags: ["kai", "seed", "step"],
      iconEmoji: "🧿",
      closeInPulses: 17_491,
    }),
    mk("m_kai_seedpulse_is_0_today", "seedpulse-0", "Is today's Day-Seed Pulse = 0?", {
      category: CAT.KAI,
      tags: ["kai", "seed", "pulse"],
      iconEmoji: "0️⃣",
      closeInPulses: 17_491,
    }),

    /* ─────────────────────────────────────────────────────────────
       💬 CULTURE (no API required — resolved by public artifact proof)
       - Category: culture
    ───────────────────────────────────────────────────────────── */

    mk("m_culture_song_hits_spotify_global1_week", "song-global1-week", "Will ANY new song hit #1 on Spotify Global this week?", {
      category: CAT.CULTURE,
      tags: ["culture", "music", "chart", "week"],
      iconEmoji: "🎧",
      closeInPulses: 17_491 * 7,
    }),
    mk("m_culture_album_hits_apple1_week", "album-apple1-week", "Will ANY new album hit #1 on Apple Music (Top Albums) this week?", {
      category: CAT.CULTURE,
      tags: ["culture", "music", "chart", "week"],
      iconEmoji: "💿",
      closeInPulses: 17_491 * 7,
    }),
    mk("m_culture_trailer_hits_yt_trending_week", "trailer-trending-week", "Will a movie/series trailer hit YouTube Trending this week?", {
      category: CAT.CULTURE,
      tags: ["culture", "tv", "film", "week"],
      iconEmoji: "🎬",
      closeInPulses: 17_491 * 7,
    }),
    mk("m_culture_platform_outage_x_week", "x-outage-week", "Will X (Twitter) have a widespread outage this week?", {
      category: CAT.CULTURE,
      tags: ["culture", "platform", "week"],
      iconEmoji: "📵",
      closeInPulses: 17_491 * 7,
    }),
    mk("m_culture_new_meme_template_week", "new-meme-template", "Will a new meme template be born this week?", {
      category: CAT.CULTURE,
      tags: ["culture", "meme", "week"],
      iconEmoji: "😂",
      closeInPulses: 17_491 * 7,
    }),

    /* ─────────────────────────────────────────────────────────────
       🪙 MARKETS (screenshot-proof)
       - Category: markets
    ───────────────────────────────────────────────────────────── */

    mk("m_crypto_btc_100k", "btc-100k", "Will BTC touch 100k before the day closes?", {
      category: CAT.MARKETS,
      tags: ["markets", "crypto", "btc", "today"],
      iconEmoji: "₿",
      closeInPulses: 17_491,
    }),
    mk("m_crypto_btc_green_today", "btc-green-today", "Will BTC close UP today?", {
      category: CAT.MARKETS,
      tags: ["markets", "crypto", "btc", "today"],
      iconEmoji: "📈",
      closeInPulses: 17_491,
    }),
    mk("m_crypto_eth_5k", "eth-5k", "Will ETH touch 5k before the day closes?", {
      category: CAT.MARKETS,
      tags: ["markets", "crypto", "eth", "today"],
      iconEmoji: "Ξ",
      closeInPulses: 17_491,
    }),
    mk("m_markets_spy_green_today", "spy-green-today", "Will SPY close green today?", {
      category: CAT.MARKETS,
      tags: ["markets", "stocks", "index", "today"],
      iconEmoji: "🏛️",
      closeInPulses: 17_491,
    }),
    mk("m_markets_vix_over_20_today", "vix-20-today", "Will VIX touch 20+ today?", {
      category: CAT.MARKETS,
      tags: ["markets", "volatility", "today"],
      iconEmoji: "🌪️",
      closeInPulses: 17_491,
    }),

    /* ─────────────────────────────────────────────────────────────
       🏈🏀⚾🏒⚽ SPORTS (final-score proof)
       - Category: sports
       - Tags include league so you can sub-filter in UI later.
    ───────────────────────────────────────────────────────────── */

    /* NFL */
    mk("m_nfl_cowboys_win", "cowboys-win", "Will the Dallas Cowboys win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nfl"],
      iconEmoji: "🏈",
      closeInPulses: 17_491 * 3,
    }),
    mk("m_nfl_chiefs_win", "chiefs-win", "Will the Kansas City Chiefs win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nfl"],
      iconEmoji: "🏈",
      closeInPulses: 17_491 * 3,
    }),
    mk("m_nfl_eagles_win", "eagles-win", "Will the Philadelphia Eagles win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nfl"],
      iconEmoji: "🏈",
      closeInPulses: 17_491 * 3,
    }),
    mk("m_nfl_49ers_win", "49ers-win", "Will the San Francisco 49ers win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nfl"],
      iconEmoji: "🏈",
      closeInPulses: 17_491 * 3,
    }),
    mk("m_nfl_giants_win", "giants-win", "Will the New York Giants win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nfl"],
      iconEmoji: "🏈",
      closeInPulses: 17_491 * 3,
    }),

    /* NBA */
    mk("m_nba_knicks_win", "knicks-win", "Will the New York Knicks win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nba"],
      iconEmoji: "🏀",
      closeInPulses: 17_491 * 2,
    }),
    mk("m_nba_lakers_win", "lakers-win", "Will the Los Angeles Lakers win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nba"],
      iconEmoji: "🏀",
      closeInPulses: 17_491 * 2,
    }),
    mk("m_nba_celtics_win", "celtics-win", "Will the Boston Celtics win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nba"],
      iconEmoji: "🏀",
      closeInPulses: 17_491 * 2,
    }),
    mk("m_nba_warriors_win", "warriors-win", "Will the Golden State Warriors win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nba"],
      iconEmoji: "🏀",
      closeInPulses: 17_491 * 2,
    }),

    /* MLB */
    mk("m_mlb_yankees_win", "yankees-win", "Will the New York Yankees win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "mlb"],
      iconEmoji: "⚾",
      closeInPulses: 17_491 * 4,
    }),
    mk("m_mlb_dodgers_win", "dodgers-win", "Will the Los Angeles Dodgers win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "mlb"],
      iconEmoji: "⚾",
      closeInPulses: 17_491 * 4,
    }),

    /* NHL */
    mk("m_nhl_rangers_win", "rangers-win", "Will the New York Rangers win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nhl"],
      iconEmoji: "🏒",
      closeInPulses: 17_491 * 3,
    }),
    mk("m_nhl_mapleleafs_win", "leafs-win", "Will the Toronto Maple Leafs win their next game?", {
      category: CAT.SPORTS,
      tags: ["sports", "nhl"],
      iconEmoji: "🏒",
      closeInPulses: 17_491 * 3,
    }),

    /* Soccer (clubs) */
    mk("m_soccer_manutd_win", "manutd-win", "Will Manchester United win their next match?", {
      category: CAT.SPORTS,
      tags: ["sports", "soccer"],
      iconEmoji: "⚽",
      closeInPulses: 17_491 * 4,
    }),
    mk("m_soccer_realmadrid_win", "realmadrid-win", "Will Real Madrid win their next match?", {
      category: CAT.SPORTS,
      tags: ["sports", "soccer"],
      iconEmoji: "⚽",
      closeInPulses: 17_491 * 4,
    }),

    /* ─────────────────────────────────────────────────────────────
       🌦️ WEATHER (local observation — no API)
       - Category: weather
       - Note: location specificity is in the question; demo uses NYC.
    ───────────────────────────────────────────────────────────── */

    mk("m_weather_rain_tomorrow", "rain-tomorrow", "Will it rain tomorrow in NYC?", {
      category: CAT.WEATHER,
      tags: ["weather", "nyc", "tomorrow"],
      iconEmoji: "🌧️",
      closeInPulses: 17_491,
    }),
    mk("m_weather_rain_before_noon_tomorrow", "rain-before-noon", "Will it rain before noon tomorrow in NYC?", {
      category: CAT.WEATHER,
      tags: ["weather", "nyc", "tomorrow"],
      iconEmoji: "⛅",
      closeInPulses: 17_491,
    }),
    mk("m_weather_snow_sticks_week", "snow-sticks-week", "Will NYC see snow that sticks this week?", {
      category: CAT.WEATHER,
      tags: ["weather", "nyc", "week"],
      iconEmoji: "❄️",
      closeInPulses: 17_491 * 7,
    }),
    mk("m_weather_thunder_week", "thunder-week", "Will NYC get thunder at least once this week?", {
      category: CAT.WEATHER,
      tags: ["weather", "nyc", "week"],
      iconEmoji: "⚡",
      closeInPulses: 17_491 * 7,
    }),

    /* ─────────────────────────────────────────────────────────────
       🗓️ CALENDAR / REALITY (deterministic, always resolvable)
       - Category: calendar
       - These are “pure math” checks (Kai boundary / residue / date patterns).
    ───────────────────────────────────────────────────────────── */

    mk("m_calendar_kai_daystart_even_tomorrow", "kai-daystart-even", "Will tomorrow's Kai day-start pulse be EVEN?", {
      category: CAT.CALENDAR,
      tags: ["calendar", "kai", "tomorrow"],
      iconEmoji: "🗓️",
      closeInPulses: 17_491,
    }),
    mk("m_calendar_kai_daystart_ends00_tomorrow", "kai-daystart-ends00", "Will tomorrow's Kai day-start pulse end with '00'?", {
      category: CAT.CALENDAR,
      tags: ["calendar", "kai", "tomorrow"],
      iconEmoji: "🧮",
      closeInPulses: 17_491,
    }),
    mk("m_calendar_next_month_starts_weekend", "next-month-weekend", "Will next month start on a weekend?", {
      category: CAT.CALENDAR,
      tags: ["calendar", "chronos"],
      iconEmoji: "📅",
      closeInPulses: 17_491 * 14,
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
