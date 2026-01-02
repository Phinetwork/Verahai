import type { MarketSummary } from '../types/marketTypes';

export const buildShareText = (market: MarketSummary) => {
  return `Verahai: ${market.title} · ${Math.round(market.yesPrice * 100)}% yes · Kairos sigil feed live.`;
};
