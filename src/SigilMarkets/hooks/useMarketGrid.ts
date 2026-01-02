import { useMemo } from 'react';
import type { MarketSummary } from '../types/marketTypes';

export const useMarketGrid = (markets: MarketSummary[], query: string, filter: string) => {
  return useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return markets.filter((market) => {
      const matchesQuery = normalized.length === 0 || market.title.toLowerCase().includes(normalized);
      const matchesFilter = filter === 'all' || market.status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [markets, query, filter]);
};
