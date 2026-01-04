// SigilMarkets/api/positionApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — positionApi
 *
 * Defines how positions/trades are executed.
 * MVP approach:
 * - Local deterministic execution using market state (AMM-ish or parimutuel).
 * - Emits:
 *   - vault lock open (handled by vaultStore)
 *   - position open record (handled by positionStore)
 *   - market activity event (handled by feedStore)
 *
 * Remote-ready:
 * - Optional endpoint for submitting a trade; not required for standalone.
 */

import type {
  KaiMoment,
  KaiPulse,
  LockId,
  Market,
  MarketId,
  MarketQuote,
  MarketQuoteRequest,
  MarketSide,
  PhiMicro,
  PriceMicro,
  ShareMicro,
  VaultId,
} from "../types/marketTypes";

import { ONE_PHI_MICRO, type Bps } from "../types/marketTypes";

import { quoteAmmTrade, quoteParimutuelStake, checkSlippage, type AmmQuote } from "../utils/math";
import { deriveLockId, derivePositionId, makeRandomId } from "../utils/ids";
import type {
  PositionEntrySnapshot,
  PositionLockRef,
  PositionPayoutModel,
  PositionRecord,
  SerializedPositionRecord,
} from "../types/sigilPositionTypes";
import { asPositionId, type PositionId } from "../types/sigilPositionTypes";
import type { VaultRecord, VaultLockReason } from "../types/vaultTypes";
import { parseBigIntDec } from "../utils/guards";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

export type PositionExecutionMode = "local" | "remote";

export type SigilMarketsPositionApiConfig = Readonly<{
  /** Optional. If absent, positionApi runs locally. */
  baseUrl?: string;
  /** Path for submitting trades. Default: "/trade". */
  submitPath?: string;
  /** If set to "remote", server is authoritative and local fallback is disabled. */
  mode?: PositionExecutionMode;
}>;

export const defaultPositionApiConfig = (): SigilMarketsPositionApiConfig => {
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_POSITION_API_BASE__"])
    ? (g["__SIGIL_MARKETS_POSITION_API_BASE__"] as string)
    : undefined;
  return { baseUrl: base, submitPath: "/trade", mode: base ? "remote" : "local" };
};

export type ExecuteTradeInput = Readonly<{
  market: Market;
  vault: VaultRecord;
  now: KaiMoment;

  request: MarketQuoteRequest;

  /**
   * Liquidity sensitivity param for AMM-ish quote if market doesn't provide liquidityMicro.
   * Default: 250 Φ (in microΦ) if unspecified.
   */
  defaultLiquidityMicro?: PhiMicro;

  /**
   * A nonce for deterministic LockId derivations.
   * If omitted, a random nonce is used.
   */
  nonce?: string;
}>;

export type ExecuteTradeResult =
  | Readonly<{
      ok: true;

      quote: MarketQuote;

      lock: Readonly<{
        vaultId: VaultId;
        lockId: LockId;
        amountMicro: PhiMicro;
        reason: VaultLockReason;
        createdAt: KaiMoment;
        updatedPulse: KaiPulse;
        marketId: MarketId;
        positionId: PositionId;
      }>;

      position: PositionRecord;

      activity: Readonly<{
        marketId: MarketId;
        side: MarketSide;
        stakeMicro: PhiMicro;
        sharesMicro: ShareMicro;
        avgPriceMicro: PriceMicro;
        atPulse: KaiPulse;
        vaultId: VaultId;
        lockId: LockId;
      }>;
    }>
  | Readonly<{ ok: false; error: string }>;

const toQuote = (req: MarketQuoteRequest, nowPulse: KaiPulse, q: AmmQuote): MarketQuote => {
  // worstPriceMicro and avgPriceMicro refer to SIDE price; this mirrors market quote expectations.
  const totalCostMicro = (q.netStakeMicro as unknown as bigint) + (q.feeMicro as unknown as bigint);
  return {
    marketId: req.marketId,
    side: req.side,
    orderType: req.orderType,
    stakeMicro: req.stakeMicro,
    expectedSharesMicro: q.sharesMicro,
    avgPriceMicro: q.avgPriceMicro,
    worstPriceMicro: q.worstPriceMicro,
    feeMicro: q.feeMicro,
    totalCostMicro: totalCostMicro as PhiMicro,
    postPricesMicro: {
      yes: q.yesPriceAfterMicro,
      no: (ONE_PHI_MICRO - (q.yesPriceAfterMicro as unknown as bigint)) as PriceMicro,
    },
    slippageBps: undefined,
    quotedAtPulse: nowPulse,
  };
};

const joinUrl = (base: string, path: string): string => {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
};

const parseMicro = (value: unknown): bigint | null => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === "string") return parseBigIntDec(value);
  return null;
};

const parsePulse = (value: unknown): KaiPulse | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value)) as KaiPulse;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed)) as KaiPulse;
  }
  return null;
};

type TradeSubmissionRequest = Readonly<{
  marketId: MarketId;
  vaultId: VaultId;
  side: MarketSide;
  orderType: MarketQuoteRequest["orderType"];
  stakeMicro: string;
  limitPriceMicro?: string;
  maxSlippageBps?: Bps;
  nowPulse: KaiPulse;
  nonce?: string;
  owner?: Readonly<{ userPhiKey: string; kaiSignature: string }>;
}>;

type SerializedMarketQuote = Readonly<{
  marketId: MarketId;
  side: MarketSide;
  orderType: MarketQuoteRequest["orderType"];
  stakeMicro: string | number;
  expectedSharesMicro: string | number;
  avgPriceMicro: string | number;
  worstPriceMicro: string | number;
  feeMicro: string | number;
  totalCostMicro: string | number;
  postPricesMicro?: Readonly<{ yes: string | number; no: string | number }>;
  slippageBps?: Bps;
  quotedAtPulse: KaiPulse | number | string;
}>;

type SerializedExecuteTradeOk = Readonly<{
  ok: true;
  quote: SerializedMarketQuote;
  lock: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    amountMicro: string | number;
    reason: VaultLockReason;
    createdAt: KaiMoment;
    updatedPulse: KaiPulse | number | string;
    marketId: MarketId;
    positionId: PositionId;
  }>;
  position: SerializedPositionRecord;
  activity: Readonly<{
    marketId: MarketId;
    side: MarketSide;
    stakeMicro: string | number;
    sharesMicro: string | number;
    avgPriceMicro: string | number;
    atPulse: KaiPulse | number | string;
    vaultId: VaultId;
    lockId: LockId;
  }>;
}>;

type SerializedExecuteTradeResult = SerializedExecuteTradeOk | Readonly<{ ok: false; error: string }>;

const decodeQuote = (raw: SerializedMarketQuote): ExecuteTradeResult | MarketQuote => {
  const stake = parseMicro(raw.stakeMicro);
  const expectedShares = parseMicro(raw.expectedSharesMicro);
  const avgPrice = parseMicro(raw.avgPriceMicro);
  const worstPrice = parseMicro(raw.worstPriceMicro);
  const fee = parseMicro(raw.feeMicro);
  const totalCost = parseMicro(raw.totalCostMicro);
  const quotedPulse = parsePulse(raw.quotedAtPulse);

  if (
    stake === null ||
    expectedShares === null ||
    avgPrice === null ||
    worstPrice === null ||
    fee === null ||
    totalCost === null ||
    quotedPulse === null
  ) {
    return { ok: false, error: "quote: bad payload" };
  }

  const post = raw.postPricesMicro;
  let postPricesMicro: MarketQuote["postPricesMicro"] = undefined;
  if (post) {
    const yes = parseMicro(post.yes);
    const no = parseMicro(post.no);
    if (yes === null || no === null) return { ok: false, error: "quote: bad postPricesMicro" };
    postPricesMicro = { yes: yes as PriceMicro, no: no as PriceMicro };
  }

  return {
    marketId: raw.marketId,
    side: raw.side,
    orderType: raw.orderType,
    stakeMicro: stake as PhiMicro,
    expectedSharesMicro: expectedShares as ShareMicro,
    avgPriceMicro: avgPrice as PriceMicro,
    worstPriceMicro: worstPrice as PriceMicro,
    feeMicro: fee as PhiMicro,
    totalCostMicro: totalCost as PhiMicro,
    postPricesMicro,
    slippageBps: raw.slippageBps,
    quotedAtPulse: quotedPulse,
  };
};

const decodeSerializedPosition = (raw: SerializedPositionRecord): ExecuteTradeResult | PositionRecord => {
  if (!isRecord(raw)) return { ok: false, error: "position: not object" };
  const lockStake = parseMicro(raw.lock?.lockedStakeMicro);
  const stake = parseMicro(raw.entry?.stakeMicro);
  const fee = parseMicro(raw.entry?.feeMicro);
  const totalCost = parseMicro(raw.entry?.totalCostMicro);
  const shares = parseMicro(raw.entry?.sharesMicro);
  const avg = parseMicro(raw.entry?.avgPriceMicro);
  const worst = parseMicro(raw.entry?.worstPriceMicro);

  if (lockStake === null || stake === null || fee === null || totalCost === null || shares === null || avg === null || worst === null) {
    return { ok: false, error: "position: bad micros" };
  }

  return {
    id: raw.id,
    marketId: raw.marketId,
    lock: {
      vaultId: raw.lock.vaultId,
      lockId: raw.lock.lockId,
      lockedStakeMicro: lockStake as PhiMicro,
    },
    entry: {
      side: raw.entry.side,
      stakeMicro: stake as PhiMicro,
      feeMicro: fee as PhiMicro,
      totalCostMicro: totalCost as PhiMicro,
      sharesMicro: shares as ShareMicro,
      avgPriceMicro: avg as PriceMicro,
      worstPriceMicro: worst as PriceMicro,
      venue: raw.entry.venue,
      openedAt: raw.entry.openedAt,
      marketDefinitionHash: raw.entry.marketDefinitionHash,
    },
    payoutModel: raw.payoutModel,
    status: raw.status,
    resolution: raw.resolution,
    settlement: raw.settlement
      ? {
          settledPulse: raw.settlement.settledPulse,
          creditedMicro: (parseMicro(raw.settlement.creditedMicro) ?? 0n) as PhiMicro,
          debitedMicro: (parseMicro(raw.settlement.debitedMicro) ?? 0n) as PhiMicro,
          note: raw.settlement.note,
        }
      : undefined,
    sigil: raw.sigil,
    updatedPulse: raw.updatedPulse,
  };
};

const decodeExecuteTradeResult = (raw: unknown): ExecuteTradeResult => {
  if (!isRecord(raw)) return { ok: false, error: "trade: not object" };
  if (raw.ok === false) {
    return { ok: false, error: isString(raw.error) ? raw.error : "trade failed" };
  }
  if (raw.ok !== true) return { ok: false, error: "trade: missing ok flag" };

  const data = raw as SerializedExecuteTradeOk;

  const quote = decodeQuote(data.quote);
  if ("ok" in quote && quote.ok === false) return quote;

  const position = decodeSerializedPosition(data.position);
  if ("ok" in position && position.ok === false) return position;

  const lockAmt = parseMicro(data.lock.amountMicro);
  const lockPulse = parsePulse(data.lock.updatedPulse);
  const activityStake = parseMicro(data.activity.stakeMicro);
  const activityShares = parseMicro(data.activity.sharesMicro);
  const activityAvg = parseMicro(data.activity.avgPriceMicro);
  const activityPulse = parsePulse(data.activity.atPulse);

  if (
    lockAmt === null ||
    lockPulse === null ||
    activityStake === null ||
    activityShares === null ||
    activityAvg === null ||
    activityPulse === null
  ) {
    return { ok: false, error: "trade: bad activity/lock payload" };
  }

  return {
    ok: true,
    quote,
    lock: {
      vaultId: data.lock.vaultId,
      lockId: data.lock.lockId,
      amountMicro: lockAmt as PhiMicro,
      reason: data.lock.reason,
      createdAt: data.lock.createdAt,
      updatedPulse: lockPulse,
      marketId: data.lock.marketId,
      positionId: data.lock.positionId,
    },
    position,
    activity: {
      marketId: data.activity.marketId,
      side: data.activity.side,
      stakeMicro: activityStake as PhiMicro,
      sharesMicro: activityShares as ShareMicro,
      avgPriceMicro: activityAvg as PriceMicro,
      atPulse: activityPulse,
      vaultId: data.activity.vaultId,
      lockId: data.activity.lockId,
    },
  };
};

const submitRemoteTrade = async (cfg: SigilMarketsPositionApiConfig, input: ExecuteTradeInput): Promise<ExecuteTradeResult> => {
  if (!cfg.baseUrl) return { ok: false, error: "positionApi not configured" };
  if (typeof fetch !== "function") return { ok: false, error: "fetch is not available in this environment" };

  const path = cfg.submitPath ?? "/trade";
  const url = joinUrl(cfg.baseUrl, path);

  const req: TradeSubmissionRequest = {
    marketId: input.market.def.id,
    vaultId: input.vault.vaultId,
    side: input.request.side,
    orderType: input.request.orderType,
    stakeMicro: String(input.request.stakeMicro as unknown as bigint),
    limitPriceMicro:
      input.request.limitPriceMicro !== undefined ? String(input.request.limitPriceMicro as unknown as bigint) : undefined,
    maxSlippageBps: input.request.maxSlippageBps,
    nowPulse: input.now.pulse,
    nonce: input.nonce,
    owner: {
      userPhiKey: String(input.vault.owner.userPhiKey),
      kaiSignature: String(input.vault.owner.kaiSignature),
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `trade remote error ${res.status}: ${t || res.statusText}` };
    }

    const data = (await res.json()) as unknown;
    return decodeExecuteTradeResult(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { ok: false, error: `trade remote request failed: ${msg}` };
  }
};

export const executeLocalTrade = async (input: ExecuteTradeInput): Promise<ExecuteTradeResult> => {
  const { market, vault, now, request } = input;

  if (vault.status === "frozen") return { ok: false, error: "vault frozen" };

  const stake = request.stakeMicro as unknown as bigint;
  if (stake <= 0n) return { ok: false, error: "stake must be > 0" };
  if ((vault.spendableMicro as unknown as bigint) < stake) return { ok: false, error: "insufficient spendable" };

  // fee bps is driven by venue state
  const venue = market.state.venueState.venue;
  const feeBps: Bps =
    venue === "amm"
      ? market.state.venueState.amm.feeBps
      : venue === "parimutuel"
        ? market.state.venueState.pool.feeBps
        : market.state.venueState.clob.feeBps;

  // Quote
  if (venue === "amm") {
    const yesPrice = market.state.pricesMicro.yes;

    const liquidityMicro =
      market.state.liquidityMicro ??
      (input.defaultLiquidityMicro ?? (250n * ONE_PHI_MICRO)); // 250 Φ default sensitivity

    const q = quoteAmmTrade({
      side: request.side,
      stakeMicro: request.stakeMicro,
      yesPriceMicro: yesPrice,
      feeBps,
      liquidityMicro,
    });

    if (request.maxSlippageBps !== undefined) {
      const chk = checkSlippage({
        avgPriceMicro: q.avgPriceMicro,
        worstPriceMicro: q.worstPriceMicro,
        maxSlippageBps: request.maxSlippageBps,
      });
      if (!chk.ok) return { ok: false, error: chk.error };
    }

    const quote = toQuote(request, now.pulse, q);

    const nonce = input.nonce ?? makeRandomId("n", 8);
    const lockId = await deriveLockId({
      vaultId: vault.vaultId,
      marketId: market.def.id,
      openPulse: now.pulse,
      nonce,
    });

    // ✅ Explicitly brand the derived id as PositionId (uses asPositionId correctly)
    const positionId = asPositionId(
      (await derivePositionId({
        vaultId: vault.vaultId,
        marketId: market.def.id,
        lockId,
      })) as unknown as string,
    );

    const lock: PositionLockRef = {
      vaultId: vault.vaultId,
      lockId,
      lockedStakeMicro: request.stakeMicro,
    };

    const entry: PositionEntrySnapshot = {
      side: request.side,
      stakeMicro: request.stakeMicro,
      feeMicro: q.feeMicro,
      totalCostMicro: quote.totalCostMicro,
      sharesMicro: q.sharesMicro,
      avgPriceMicro: q.avgPriceMicro,
      worstPriceMicro: q.worstPriceMicro,
      venue: "amm",
      openedAt: now,
      marketDefinitionHash: market.def.definitionHash,
    };

    const payoutModel: PositionPayoutModel = "amm-shares";

    const position: PositionRecord = {
      id: positionId,
      marketId: market.def.id,
      lock,
      entry,
      payoutModel,
      status: "open",
      resolution: undefined,
      settlement: undefined,
      sigil: undefined,
      updatedPulse: now.pulse,
    };

    return {
      ok: true,
      quote,
      lock: {
        vaultId: vault.vaultId,
        lockId,
        amountMicro: request.stakeMicro,
        reason: "position-open",
        createdAt: now,
        updatedPulse: now.pulse,
        marketId: market.def.id,
        positionId,
      },
      position,
      activity: {
        marketId: market.def.id,
        side: request.side,
        stakeMicro: request.stakeMicro,
        sharesMicro: q.sharesMicro,
        avgPriceMicro: q.avgPriceMicro,
        atPulse: now.pulse,
        vaultId: vault.vaultId,
        lockId,
      },
    };
  }

  if (venue === "parimutuel") {
    const q = quoteParimutuelStake({ stakeMicro: request.stakeMicro, feeBps });

    const quote: MarketQuote = {
      marketId: request.marketId,
      side: request.side,
      orderType: request.orderType,
      stakeMicro: request.stakeMicro,
      expectedSharesMicro: q.sharesMicro,
      avgPriceMicro: q.avgPriceMicro,
      worstPriceMicro: q.worstPriceMicro,
      feeMicro: q.feeMicro,
      totalCostMicro: ((q.netStakeMicro as unknown as bigint) + (q.feeMicro as unknown as bigint)) as PhiMicro,
      postPricesMicro: undefined,
      slippageBps: undefined,
      quotedAtPulse: now.pulse,
    };

    const nonce = input.nonce ?? makeRandomId("n", 8);
    const lockId = await deriveLockId({
      vaultId: vault.vaultId,
      marketId: market.def.id,
      openPulse: now.pulse,
      nonce,
    });

    // ✅ Explicitly brand the derived id as PositionId (uses asPositionId correctly)
    const positionId = asPositionId(
      (await derivePositionId({
        vaultId: vault.vaultId,
        marketId: market.def.id,
        lockId,
      })) as unknown as string,
    );

    const lock: PositionLockRef = {
      vaultId: vault.vaultId,
      lockId,
      lockedStakeMicro: request.stakeMicro,
    };

    const entry: PositionEntrySnapshot = {
      side: request.side,
      stakeMicro: request.stakeMicro,
      feeMicro: q.feeMicro,
      totalCostMicro: quote.totalCostMicro,
      sharesMicro: q.sharesMicro,
      avgPriceMicro: q.avgPriceMicro,
      worstPriceMicro: q.worstPriceMicro,
      venue: "parimutuel",
      openedAt: now,
      marketDefinitionHash: market.def.definitionHash,
    };

    const position: PositionRecord = {
      id: positionId,
      marketId: market.def.id,
      lock,
      entry,
      payoutModel: "parimutuel",
      status: "open",
      resolution: undefined,
      settlement: undefined,
      sigil: undefined,
      updatedPulse: now.pulse,
    };

    return {
      ok: true,
      quote,
      lock: {
        vaultId: vault.vaultId,
        lockId,
        amountMicro: request.stakeMicro,
        reason: "position-open",
        createdAt: now,
        updatedPulse: now.pulse,
        marketId: market.def.id,
        positionId,
      },
      position,
      activity: {
        marketId: market.def.id,
        side: request.side,
        stakeMicro: request.stakeMicro,
        sharesMicro: q.sharesMicro,
        avgPriceMicro: q.avgPriceMicro,
        atPulse: now.pulse,
        vaultId: vault.vaultId,
        lockId,
      },
    };
  }

  // CLOB not implemented in MVP execution (UI can still render best bid/ask).
  return { ok: false, error: "CLOB execution not supported in MVP" };
};

export const executeTrade = async (
  input: ExecuteTradeInput,
  cfg: SigilMarketsPositionApiConfig = defaultPositionApiConfig(),
): Promise<ExecuteTradeResult> => {
  const mode = cfg.mode ?? (cfg.baseUrl ? "remote" : "local");
  if (mode === "remote") {
    return submitRemoteTrade(cfg, input);
  }
  return executeLocalTrade(input);
};
