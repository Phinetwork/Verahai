// SigilMarkets/hooks/useMarket.ts
"use client";

import { useCallback, useMemo } from "react";
import type { KaiPulse, Market, MarketId, MarketOutcome, MarketStatus } from "../types/marketTypes";
import { useMarketById, useSigilMarketsMarketStore } from "../state/marketStore";
import { useSigilMarketsUi } from "../state/uiStore";
import type { SigilMarketsRoute } from "../types/uiTypes";
import { deriveMarketStatus, isResolvedLikeStatus } from "../utils/marketTiming";

export type UseMarketResult = Readonly<{
  market: Market | null;
  marketId: MarketId;
  status: "missing" | "ready";
  marketStatus: MarketStatus;
  isResolved: boolean;
  outcome: MarketOutcome | null;

  closePulse: KaiPulse;
  closeInPulses: number;
  isClosed: boolean;

  /** Convenience for UI rendering. */
  yesPriceMicro: bigint;
  noPriceMicro: bigint;
}>;

const calcCloseInPulses = (closePulse: KaiPulse, nowPulse: KaiPulse): number => {
  const c = Number.isFinite(closePulse) ? Math.floor(closePulse) : 0;
  const n = Number.isFinite(nowPulse) ? Math.floor(nowPulse) : 0;
  const d = c - n;
  return d <= 0 ? 0 : d;
};

export const useMarket = (marketId: MarketId, nowPulse: KaiPulse): UseMarketResult => {
  const market = useMarketById(marketId);

  return useMemo<UseMarketResult>(() => {
    if (!market) {
      return {
        market: null,
        marketId,
        status: "missing",
        marketStatus: "open",
        isResolved: false,
        outcome: null,
        closePulse: 0,
        closeInPulses: 0,
        isClosed: false,
        yesPriceMicro: 0n,
        noPriceMicro: 0n,
      };
    }

    const closePulse = market.def.timing.closePulse;
    const closeInPulses = calcCloseInPulses(closePulse, nowPulse);

    const marketStatus = deriveMarketStatus(market, nowPulse);
    const isClosed = marketStatus !== "open";
    const isResolved = isResolvedLikeStatus(marketStatus);
    const outcome = market.state.resolution?.outcome ?? null;

    return {
      market,
      marketId,
      status: "ready",
      marketStatus,
      isResolved,
      outcome,
      closePulse,
      closeInPulses,
      isClosed,
      yesPriceMicro: market.state.pricesMicro.yes,
      noPriceMicro: market.state.pricesMicro.no,
    };
  }, [market, marketId, nowPulse]);
};

/**
 * Route helpers
 */
export const useRouteMarketId = (): MarketId | null => {
  const { state } = useSigilMarketsUi();
  const r: SigilMarketsRoute = state.route;
  return r.view === "market" || r.view === "resolution" ? r.marketId : null;
};

export const useMarketFromRoute = (nowPulse: KaiPulse): UseMarketResult | null => {
  const marketId = useRouteMarketId();
  return marketId ? useMarket(marketId, nowPulse) : null;
};

/**
 * Minimal store-level refresh helper (no network):
 * In integrated apps, orchestration should live in a controller component (Shell).
 * This exists for local/demo usage.
 */
export const useMarketStoreActions = (): Readonly<{
  hasMarkets: boolean;
  setStatus: (status: "idle" | "loading" | "ready" | "error", error?: string) => void;
}> => {
  const { state, actions } = useSigilMarketsMarketStore();
  const hasMarkets = state.ids.length > 0;

  const setStatus = useCallback((status: "idle" | "loading" | "ready" | "error", error?: string) => {
    actions.setStatus(status, error);
  }, [actions]);

  return { hasMarkets, setStatus };
};
