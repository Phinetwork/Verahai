// SigilMarkets/state/marketStore.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — marketStore
 *
 * Responsibilities:
 * - Hold the local market catalog + latest dynamic state (prices, status, venue)
 * - Support offline-first caching (JSON-safe serialization of bigint micros)
 * - Provide deterministic ordering for UI (updatedPulse desc, then id)
 *
 * Non-goals:
 * - Trading execution (position/vault stores)
 * - Oracle resolution authoring (oracleApi)
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
  SM_MARKETS_CACHE_KEY,
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

import {
  asEvidenceHash,
  asMarketId,
  asMarketSlug,
  asOracleId,
  isMarketOutcome,
  isMarketStatus,
  ONE_PHI_MICRO,
  type AmmCurve,
  type AmmState,
  type BinaryMarket,
  type BinaryMarketDefinition,
  type BinaryMarketState,
  type BinaryPricesMicro,
  type ClobPriceLevel,
  type ClobState,
  type KaiPulse,
  type Market,
  type MarketCategory,
  type MarketId,
  type MarketOraclePolicy,
  type MarketOutcome,
  type MarketRules,
  type MarketSettlementPolicy,
  type MarketStatus,
  type MarketTiming,
  type MarketVenueState,
  type OracleProvider,
  type ParimutuelState,
  type PriceMicro,
  type ShareMicro,
  type PhiMicro,
} from "../types/marketTypes";

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

const biToDec = (v: bigint): string => v.toString(10);

const parseBps = (v: unknown): number | null => {
  if (!isNumber(v)) return null;
  const n = clampInt(v, 0, 10_000);
  return n;
};

const parsePulse = (v: unknown): KaiPulse | null => {
  if (!isNumber(v)) return null;
  if (v < 0) return 0;
  return Math.floor(v);
};

const parseCategory = (v: unknown): MarketCategory | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as MarketCategory;
};

const parseOracleProvider = (v: unknown): OracleProvider | null => {
  if (!isString(v) || v.length === 0) return null;
  return v as OracleProvider;
};

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

/** Keep only string-valued metadata for strict serialization typing. */
const sanitizeStringMeta = (meta: unknown): Readonly<Record<string, string>> | undefined => {
  if (!isRecord(meta)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!k) continue;
    if (isString(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** ------------------------------
 * JSON-safe serialized shapes
 * ------------------------------ */

type MicroStr = string;

type SerializedBinaryPricesMicro = Readonly<{
  yes: MicroStr;
  no: MicroStr;
}>;

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

type SerializedClobPriceLevel = Readonly<{
  priceMicro: MicroStr;
  sizeMicro: MicroStr;
}>;

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

type SerializedBinaryMarket = Readonly<{
  def: SerializedBinaryMarketDefinition;
  state: SerializedBinaryMarketState;
}>;

type SerializedMarketCache = Readonly<{
  byId: Readonly<Record<string, SerializedBinaryMarket>>;
  ids: readonly string[];
  lastSyncedPulse?: KaiPulse;
}>;

const CACHE_ENVELOPE_VERSION = 1;

/** ------------------------------
 * Serialization / Deserialization
 * ------------------------------ */

const serializePrices = (p: BinaryPricesMicro): SerializedBinaryPricesMicro => ({
  yes: biToDec(p.yes),
  no: biToDec(p.no),
});

const deserializePrices = (v: unknown): PersistResult<BinaryPricesMicro> => {
  if (!isRecord(v)) return { ok: false, error: "pricesMicro: not object" };
  const yes = parseBigIntDec(v["yes"]);
  const no = parseBigIntDec(v["no"]);
  if (yes === null || no === null) return { ok: false, error: "pricesMicro: bad micros" };
  return { ok: true, value: { yes: yes as PriceMicro, no: no as PriceMicro } };
};

const serializeVenue = (vs: MarketVenueState): SerializedVenueState => {
  if (vs.venue === "amm") {
    const a = vs.amm;
    return {
      venue: "amm",
      amm: {
        curve: a.curve,
        yesInventoryMicro: biToDec(a.yesInventoryMicro),
        noInventoryMicro: biToDec(a.noInventoryMicro),
        feeBps: a.feeBps,
        paramMicro: a.paramMicro !== undefined ? biToDec(a.paramMicro) : undefined,
      },
    };
  }
  if (vs.venue === "parimutuel") {
    const p = vs.pool;
    return {
      venue: "parimutuel",
      pool: {
        yesPoolMicro: biToDec(p.yesPoolMicro),
        noPoolMicro: biToDec(p.noPoolMicro),
        feeBps: p.feeBps,
      },
    };
  }
  const c = vs.clob;
  const serLevel = (lvl: ClobPriceLevel): SerializedClobPriceLevel => ({
    priceMicro: biToDec(lvl.priceMicro),
    sizeMicro: biToDec(lvl.sizeMicro),
  });

  return {
    venue: "clob",
    clob: {
      yesBidMicro: c.yesBidMicro !== undefined ? biToDec(c.yesBidMicro) : undefined,
      yesAskMicro: c.yesAskMicro !== undefined ? biToDec(c.yesAskMicro) : undefined,
      noBidMicro: c.noBidMicro !== undefined ? biToDec(c.noBidMicro) : undefined,
      noAskMicro: c.noAskMicro !== undefined ? biToDec(c.noAskMicro) : undefined,
      depthYes: c.depthYes ? c.depthYes.map(serLevel) : undefined,
      depthNo: c.depthNo ? c.depthNo.map(serLevel) : undefined,
      feeBps: c.feeBps,
    },
  };
};

const deserializeVenue = (v: unknown): PersistResult<MarketVenueState> => {
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

const serializeOraclePolicy = (o: MarketOraclePolicy): SerializedOraclePolicy => ({
  provider: o.provider,
  oracleId: o.oracleId,
  disputeWindowPulses: o.disputeWindowPulses,
  evidenceRequired: o.evidenceRequired,
});

const deserializeOraclePolicy = (v: unknown): PersistResult<MarketOraclePolicy> => {
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

const serializeSettlement = (s: MarketSettlementPolicy): SerializedSettlementPolicy => ({
  unit: s.unit,
  redeemPerShareMicro: biToDec(s.redeemPerShareMicro),
  feeBps: s.feeBps,
  feeTiming: s.feeTiming,
});

const deserializeSettlement = (v: unknown): PersistResult<MarketSettlementPolicy> => {
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

const serializeRules = (r: MarketRules): SerializedRules => ({
  yesCondition: r.yesCondition,
  clarifications: r.clarifications,
  oracle: serializeOraclePolicy(r.oracle),
  settlement: serializeSettlement(r.settlement),
  voidPolicy: r.voidPolicy,
});

const deserializeRules = (v: unknown): PersistResult<MarketRules> => {
  if (!isRecord(v)) return { ok: false, error: "rules: not object" };
  const yesCondition = v["yesCondition"];
  if (!isString(yesCondition) || yesCondition.length === 0) return { ok: false, error: "rules.yesCondition: bad" };

  const clarificationsRaw = v["clarifications"];
  const clarifications =
    isArray(clarificationsRaw) ? clarificationsRaw.filter((x): x is string => isString(x) && x.length > 0) : undefined;

  const oracleRes = deserializeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: oracleRes.error };

  const settlementRes = deserializeSettlement(v["settlement"]);
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

const serializeTiming = (t: MarketTiming): SerializedMarketTiming => ({
  createdPulse: t.createdPulse,
  openPulse: t.openPulse,
  closePulse: t.closePulse,
  resolveEarliestPulse: t.resolveEarliestPulse,
  resolveByPulse: t.resolveByPulse,
});

const deserializeTiming = (v: unknown): PersistResult<MarketTiming> => {
  if (!isRecord(v)) return { ok: false, error: "timing: not object" };
  const createdPulse = parsePulse(v["createdPulse"]);
  const openPulse = parsePulse(v["openPulse"]);
  const closePulse = parsePulse(v["closePulse"]);
  if (createdPulse === null || openPulse === null || closePulse === null) {
    return { ok: false, error: "timing: bad pulses" };
  }

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

const serializeResolution = (r: BinaryMarketState["resolution"]): SerializedMarketResolution | undefined => {
  if (!r) return undefined;
  return {
    marketId: r.marketId,
    outcome: r.outcome,
    resolvedPulse: r.resolvedPulse,
    oracle: {
      provider: r.oracle.provider,
      oracleId: r.oracle.oracleId,
      disputeWindowPulses: r.oracle.disputeWindowPulses,
      evidenceRequired: r.oracle.evidenceRequired,
    },
    evidence: r.evidence
      ? {
          urls: r.evidence.urls,
          hashes: r.evidence.hashes,
          summary: r.evidence.summary,
        }
      : undefined,
    dispute: r.dispute
      ? {
          proposedPulse: r.dispute.proposedPulse,
          finalPulse: r.dispute.finalPulse,
          meta: sanitizeStringMeta(r.dispute.meta),
        }
      : undefined,
  };
};

const deserializeResolution = (v: unknown): PersistResult<BinaryMarketState["resolution"] | undefined> => {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, error: "resolution: not object" };

  const marketId = v["marketId"];
  if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "resolution.marketId: bad" };

  const outcome = v["outcome"];
  if (!isMarketOutcome(outcome)) return { ok: false, error: "resolution.outcome: bad" };

  const resolvedPulse = parsePulse(v["resolvedPulse"]);
  if (resolvedPulse === null) return { ok: false, error: "resolution.resolvedPulse: bad" };

  const oracleRes = deserializeOraclePolicy(v["oracle"]);
  if (!oracleRes.ok) return { ok: false, error: `resolution.oracle: ${oracleRes.error}` };

  const evidenceRaw = v["evidence"];
  const evidence =
    isRecord(evidenceRaw) &&
    (evidenceRaw["urls"] !== undefined || evidenceRaw["hashes"] !== undefined || evidenceRaw["summary"] !== undefined)
      ? {
          urls: isArray(evidenceRaw["urls"])
            ? evidenceRaw["urls"].filter((x): x is string => isString(x) && x.length > 0)
            : undefined,
          hashes: isArray(evidenceRaw["hashes"])
            ? evidenceRaw["hashes"].filter((x): x is string => isString(x) && x.length > 0)
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
          meta: sanitizeStringMeta(disputeRaw["meta"]),
        }
      : undefined;

  return {
    ok: true,
    value: {
      marketId: asMarketId(marketId),
      outcome,
      resolvedPulse,
      oracle: oracleRes.value,
      evidence: evidence
        ? {
            urls: evidence.urls,
            hashes: evidence.hashes ? evidence.hashes.map((h) => asEvidenceHash(h)) : undefined,
            summary: evidence.summary,
          }
        : undefined,
      dispute,
    },
  };
};

const serializeMarket = (m: BinaryMarket): SerializedBinaryMarket => ({
  def: {
    id: m.def.id,
    kind: "binary",
    slug: m.def.slug,
    question: m.def.question,
    description: m.def.description,
    category: m.def.category,
    tags: [...m.def.tags],
    timing: serializeTiming(m.def.timing),
    rules: serializeRules(m.def.rules),
    iconEmoji: m.def.iconEmoji,
    heroImageUrl: m.def.heroImageUrl,
    definitionHash: m.def.definitionHash,
  },
  state: {
    status: m.state.status,
    venueState: serializeVenue(m.state.venueState),
    pricesMicro: serializePrices(m.state.pricesMicro),
    liquidityMicro: m.state.liquidityMicro !== undefined ? biToDec(m.state.liquidityMicro) : undefined,
    volume24hMicro: m.state.volume24hMicro !== undefined ? biToDec(m.state.volume24hMicro) : undefined,
    updatedPulse: m.state.updatedPulse,
    resolution: serializeResolution(m.state.resolution),
  },
});

const deserializeMarket = (v: unknown): PersistResult<BinaryMarket> => {
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
  const timingRes = deserializeTiming(defRaw["timing"]);
  if (!timingRes.ok) return { ok: false, error: `def.timing: ${timingRes.error}` };
  const rulesRes = deserializeRules(defRaw["rules"]);
  if (!rulesRes.ok) return { ok: false, error: `def.rules: ${rulesRes.error}` };

  const description = isString(defRaw["description"]) ? defRaw["description"] : undefined;
  const iconEmoji = isString(defRaw["iconEmoji"]) ? defRaw["iconEmoji"] : undefined;
  const heroImageUrl = isString(defRaw["heroImageUrl"]) ? defRaw["heroImageUrl"] : undefined;
  const definitionHash = isString(defRaw["definitionHash"]) ? asEvidenceHash(defRaw["definitionHash"]) : undefined;

  const def: BinaryMarketDefinition = {
    id: asMarketId(id),
    kind: "binary",
    slug: asMarketSlug(slug),
    question,
    description,
    category: cat,
    tags,
    timing: timingRes.value,
    rules: rulesRes.value,
    iconEmoji,
    heroImageUrl,
    definitionHash,
  };

  // state
  const status = stateRaw["status"];
  if (!isMarketStatus(status)) return { ok: false, error: "state.status: bad" };

  const venueRes = deserializeVenue(stateRaw["venueState"]);
  if (!venueRes.ok) return { ok: false, error: `state.venueState: ${venueRes.error}` };

  const pricesRes = deserializePrices(stateRaw["pricesMicro"]);
  if (!pricesRes.ok) return { ok: false, error: `state.pricesMicro: ${pricesRes.error}` };

  const updatedPulse = parsePulse(stateRaw["updatedPulse"]);
  if (updatedPulse === null) return { ok: false, error: "state.updatedPulse: bad" };

  const liquidityMicro = stateRaw["liquidityMicro"] !== undefined ? parseBigIntDec(stateRaw["liquidityMicro"]) : null;
  const volume24hMicro = stateRaw["volume24hMicro"] !== undefined ? parseBigIntDec(stateRaw["volume24hMicro"]) : null;

  const resoRes = deserializeResolution(stateRaw["resolution"]);
  if (!resoRes.ok) return { ok: false, error: `state.resolution: ${resoRes.error}` };

  const state: BinaryMarketState = {
    status,
    venueState: venueRes.value,
    pricesMicro: pricesRes.value,
    liquidityMicro: liquidityMicro !== null ? (liquidityMicro as PhiMicro) : undefined,
    volume24hMicro: volume24hMicro !== null ? (volume24hMicro as PhiMicro) : undefined,
    updatedPulse,
    resolution: resoRes.value,
  };

  return { ok: true, value: { def, state } };
};

/** ------------------------------
 * Store
 * ------------------------------ */

export type MarketStoreStatus = "idle" | "loading" | "ready" | "error";

export type SigilMarketsMarketState = Readonly<{
  byId: Readonly<Record<string, Market>>;
  ids: readonly MarketId[];
  status: MarketStoreStatus;
  error?: string;
  lastSyncedPulse?: KaiPulse;
  cacheSavedAtMs?: number;
}>;

const sortIdsDeterministic = (byId: Readonly<Record<string, Market>>): MarketId[] => {
  const entries: Array<{ id: string; p: number }> = [];
  for (const [id, m] of Object.entries(byId)) {
    const p = m.state.updatedPulse ?? 0;
    entries.push({ id, p });
  }
  entries.sort((a, b) => {
    if (b.p !== a.p) return b.p - a.p;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return entries.map((e) => asMarketId(e.id));
};

const defaultMarketState = (): SigilMarketsMarketState => ({
  byId: {},
  ids: [],
  status: "idle",
  error: undefined,
  lastSyncedPulse: undefined,
  cacheSavedAtMs: undefined,
});

type MarketCacheEnvelope = Readonly<{
  v: number;
  savedAtMs: number;
  data: SerializedMarketCache;
}>;

const decodeSerializedCache: Decoder<SerializedMarketCache> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "cache: not object" };
  const byIdRaw = v["byId"];
  const idsRaw = v["ids"];
  const lastSyncedPulse = v["lastSyncedPulse"];

  if (!isRecord(byIdRaw)) return { ok: false, error: "cache.byId: bad" };
  if (!isArray(idsRaw)) return { ok: false, error: "cache.ids: bad" };

  const byId: Record<string, SerializedBinaryMarket> = {};
  for (const [k, mv] of Object.entries(byIdRaw)) {
    if (!isString(k) || k.length === 0) continue;
    // store raw; decode later per market to allow partial salvage
    if (isRecord(mv)) byId[k] = mv as unknown as SerializedBinaryMarket;
  }

  const ids = idsRaw.filter((x): x is string => isString(x) && x.length > 0);
  const lsp = lastSyncedPulse !== undefined ? parsePulse(lastSyncedPulse) : null;

  return {
    ok: true,
    value: {
      byId,
      ids,
      lastSyncedPulse: lsp ?? undefined,
    },
  };
};

const loadCache = (storage: StorageLike | null): PersistResult<Readonly<{ state: SigilMarketsMarketState }>> => {
  const res = loadFromStorage(
    SM_MARKETS_CACHE_KEY,
    (raw) => decodeEnvelope(raw, CACHE_ENVELOPE_VERSION, decodeSerializedCache),
    storage,
  );

  if (!res.ok) return { ok: false, error: res.error };
  if (res.value === null) return { ok: true, value: { state: defaultMarketState() } };

  const env = res.value;
  const cache = env.data;

  // decode markets with salvage: skip broken entries
  const byId: Record<string, Market> = {};
  for (const [id, mv] of Object.entries(cache.byId)) {
    const dm = deserializeMarket(mv);
    if (dm.ok) byId[id] = dm.value;
  }

  const idsFromCache = cache.ids.filter((id) => byId[id] !== undefined).map((id) => asMarketId(id));
  const ids = idsFromCache.length > 0 ? idsFromCache : sortIdsDeterministic(byId);

  return {
    ok: true,
    value: {
      state: {
        byId,
        ids,
        status: "ready",
        error: undefined,
        lastSyncedPulse: cache.lastSyncedPulse,
        cacheSavedAtMs: env.savedAtMs,
      },
    },
  };
};

const persistCache = (storage: StorageLike | null, state: SigilMarketsMarketState): void => {
  if (!storage) return;

  const byId: Record<string, SerializedBinaryMarket> = {};
  for (const [id, m] of Object.entries(state.byId)) {
    byId[id] = serializeMarket(m as BinaryMarket);
  }

  const data: SerializedMarketCache = {
    byId,
    ids: state.ids.map((id) => id as unknown as string),
    lastSyncedPulse: state.lastSyncedPulse,
  };

  const env: MarketCacheEnvelope = wrapEnvelope(
    data as unknown as never,
    CACHE_ENVELOPE_VERSION,
  ) as unknown as MarketCacheEnvelope;
  saveToStorage(SM_MARKETS_CACHE_KEY, env, storage);
};

export type SigilMarketsMarketActions = Readonly<{
  hydrateFromCache: () => void;
  setMarkets: (markets: readonly Market[], opts?: Readonly<{ lastSyncedPulse?: KaiPulse }>) => void;
  upsertMarkets: (markets: readonly Market[], opts?: Readonly<{ lastSyncedPulse?: KaiPulse }>) => void;
  removeMarket: (marketId: MarketId) => void;
  updateMarketStatus: (args: Readonly<{ marketId: MarketId; status: MarketStatus; updatedPulse?: KaiPulse }>) => void;
  resolveMarket: (args: Readonly<{ marketId: MarketId; resolution: BinaryMarketState["resolution"] }>) => void;
  setStatus: (status: MarketStoreStatus, error?: string) => void;
  clearAll: () => void;
  clearCache: () => void;
  persistNow: () => void;
}>;

export type SigilMarketsMarketStore = Readonly<{
  state: SigilMarketsMarketState;
  actions: SigilMarketsMarketActions;
}>;

const SigilMarketsMarketContext = createContext<SigilMarketsMarketStore | null>(null);

export const SigilMarketsMarketProvider = (props: Readonly<{ children: ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);

  const [state, setState] = useState<SigilMarketsMarketState>(() => {
    const loaded = loadCache(storage);
    if (loaded.ok) return loaded.value.state;
    return defaultMarketState();
  });

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistMsRef = useRef<number>(0);

  // cleanup any pending timers (and prevents “useEffect unused” too)
  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = null;
    };
  }, []);

  const schedulePersist = useCallback(
    (next: SigilMarketsMarketState) => {
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
    (updater: (prev: SigilMarketsMarketState) => SigilMarketsMarketState, persist: boolean) => {
      setState((prev) => {
        const next = updater(prev);
        if (persist) schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  const actions: SigilMarketsMarketActions = useMemo(() => {
    const hydrateFromCache = (): void => {
      const loaded = loadCache(storage);
      if (!loaded.ok) {
        setState((s) => ({ ...s, status: "error", error: loaded.error }));
        return;
      }
      setState(loaded.value.state);
    };

    const setMarkets = (markets: readonly Market[], opts?: Readonly<{ lastSyncedPulse?: KaiPulse }>): void => {
      setAndMaybePersist(
        () => {
          const byId: Record<string, Market> = {};
          for (const m of markets) byId[m.def.id as unknown as string] = m;
          const ids = sortIdsDeterministic(byId);
          return {
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastSyncedPulse: opts?.lastSyncedPulse,
            cacheSavedAtMs: nowMs(),
          };
        },
        true,
      );
    };

    const upsertMarkets = (markets: readonly Market[], opts?: Readonly<{ lastSyncedPulse?: KaiPulse }>): void => {
      setAndMaybePersist(
        (prev) => {
          if (markets.length === 0) return prev;
          const byId: Record<string, Market> = { ...prev.byId };
          for (const m of markets) byId[m.def.id as unknown as string] = m;
          const ids = sortIdsDeterministic(byId);
          return {
            ...prev,
            byId,
            ids,
            status: "ready",
            error: undefined,
            lastSyncedPulse: opts?.lastSyncedPulse ?? prev.lastSyncedPulse,
            cacheSavedAtMs: nowMs(),
          };
        },
        true,
      );
    };

    const removeMarket = (marketId: MarketId): void => {
      const key = marketId as unknown as string;
      setAndMaybePersist(
        (prev) => {
          if (prev.byId[key] === undefined) return prev;
          const byId: Record<string, Market> = { ...prev.byId };
          delete byId[key];
          const ids = prev.ids.filter((id) => (id as unknown as string) !== key);
          return { ...prev, byId, ids };
        },
        true,
      );
    };

    const updateMarketStatus = (args: Readonly<{ marketId: MarketId; status: MarketStatus; updatedPulse?: KaiPulse }>): void => {
      const key = args.marketId as unknown as string;
      setAndMaybePersist(
        (prev) => {
          const existing = prev.byId[key];
          if (!existing) return prev;
          const updatedPulse = args.updatedPulse ?? existing.state.updatedPulse;
          if (existing.state.status === args.status && updatedPulse === existing.state.updatedPulse) return prev;
          const nextMarket: Market = {
            ...existing,
            state: {
              ...existing.state,
              status: args.status,
              updatedPulse: Math.max(existing.state.updatedPulse, updatedPulse),
            },
          };
          return {
            ...prev,
            byId: {
              ...prev.byId,
              [key]: nextMarket,
            },
          };
        },
        true,
      );
    };

const resolveMarket = (args: Readonly<{ marketId: MarketId; resolution: BinaryMarketState["resolution"] }>): void => {
  const resolution = args.resolution; // ✅ capture once so TS can narrow for the closure
  if (!resolution) return;

  const key = args.marketId as unknown as string;

  setAndMaybePersist(
    (prev) => {
      const existing = prev.byId[key];
      if (!existing) return prev;

      const nextStatus: MarketStatus = resolution.outcome === "VOID" ? "voided" : "resolved";
      const resolvedPulse = resolution.resolvedPulse;

      const nextMarket: Market = {
        ...existing,
        state: {
          ...existing.state,
          status: nextStatus,
          resolution, // ✅ safe
          updatedPulse: Math.max(existing.state.updatedPulse, resolvedPulse),
        },
      };

      return {
        ...prev,
        byId: {
          ...prev.byId,
          [key]: nextMarket,
        },
      };
    },
    true,
  );
};


    const setStatus = (status: MarketStoreStatus, error?: string): void => {
      setState((prev) => ({ ...prev, status, error }));
    };

    const clearAll = (): void => {
      setState(defaultMarketState());
      removeFromStorage(SM_MARKETS_CACHE_KEY, storage);
    };

    const clearCache = (): void => {
      removeFromStorage(SM_MARKETS_CACHE_KEY, storage);
      setState((prev) => ({ ...prev, cacheSavedAtMs: undefined }));
    };

    const persistNow = (): void => {
      if (!storage) return;
      persistCache(storage, state);
    };

    return {
      hydrateFromCache,
      setMarkets,
      upsertMarkets,
      removeMarket,
      updateMarketStatus,
      resolveMarket,
      setStatus,
      clearAll,
      clearCache,
      persistNow,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAndMaybePersist, storage, state]);

  const store = useMemo<SigilMarketsMarketStore>(() => ({ state, actions }), [state, actions]);

  return <SigilMarketsMarketContext.Provider value={store}>{props.children}</SigilMarketsMarketContext.Provider>;
};

export const useSigilMarketsMarketStore = (): SigilMarketsMarketStore => {
  const ctx = useContext(SigilMarketsMarketContext);
  if (!ctx) throw new Error("useSigilMarketsMarketStore must be used within <SigilMarketsMarketProvider>");
  return ctx;
};

/** Convenience selectors */
export const useMarkets = (): readonly Market[] => {
  const { state } = useSigilMarketsMarketStore();
  return state.ids
    .map((id) => state.byId[id as unknown as string])
    .filter((m): m is Market => m !== undefined);
};

export const useMarketById = (marketId: MarketId): Market | null => {
  const { state } = useSigilMarketsMarketStore();
  return state.byId[marketId as unknown as string] ?? null;
};

/** Helpers for creating a minimal market (useful for offline demos/tests). */
export const makeEmptyBinaryMarket = (args: Readonly<{ id: string; slug: string; question: string; nowPulse: KaiPulse }>): BinaryMarket => {
  const timing: MarketTiming = {
    createdPulse: args.nowPulse,
    openPulse: args.nowPulse,
    closePulse: args.nowPulse + 10_000,
  };

  const settlement: MarketSettlementPolicy = {
    unit: "phi",
    redeemPerShareMicro: ONE_PHI_MICRO,
    feeBps: 100,
    feeTiming: "entry",
  };

  const oracle: MarketOraclePolicy = {
    provider: "sigil-oracle" as OracleProvider,
    disputeWindowPulses: 0,
    evidenceRequired: false,
  };

  const rules: MarketRules = {
    yesCondition: "YES if the stated condition becomes true by the close/resolution rules.",
    clarifications: [],
    oracle,
    settlement,
    voidPolicy: { canVoid: true, refundMode: "refund-stake" },
  };

  const def: BinaryMarketDefinition = {
    id: asMarketId(args.id),
    kind: "binary",
    slug: asMarketSlug(args.slug),
    question: args.question,
    description: undefined,
    category: "other" as MarketCategory,
    tags: [],
    timing,
    rules,
  };

  const venueState: MarketVenueState = {
    venue: "amm",
    amm: {
      curve: "cpmm",
      yesInventoryMicro: 0n as ShareMicro,
      noInventoryMicro: 0n as ShareMicro,
      feeBps: 100,
    },
  };

  const state: BinaryMarketState = {
    status: "open",
    venueState,
    pricesMicro: { yes: 500_000n as PriceMicro, no: 500_000n as PriceMicro },
    updatedPulse: args.nowPulse,
  };

  return { def, state };
};

/**
 * Re-export for callers that already import helpers from the store module.
 * (Fixes: importing { asMarketId } from "../state/marketStore")
 */
export { asMarketId };
