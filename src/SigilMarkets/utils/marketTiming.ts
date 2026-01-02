// SigilMarkets/utils/marketTiming.ts
"use client";

import type { KaiPulse, Market, MarketStatus } from "../types/marketTypes";

const clampPulse = (p: KaiPulse): number => {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.floor(p));
};

export const deriveMarketStatus = (market: Market, nowPulse: KaiPulse): MarketStatus => {
  const status = market.state.status;
  if (status === "resolved" || status === "voided" || status === "canceled") return status;
  if (status === "resolving" || status === "closed") return status;

  const closePulse = clampPulse(market.def.timing.closePulse);
  const now = clampPulse(nowPulse);

  if (now >= closePulse) return "closed";
  return "open";
};

export const isResolvedLikeStatus = (status: string): boolean =>
  status === "resolved" || status === "voided" || status === "canceled";
