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
} from "../types/sigilPositionTypes";
import { asPositionId, type PositionId } from "../types/sigilPositionTypes";
import type { VaultRecord, VaultLockReason } from "../types/vaultTypes";

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
