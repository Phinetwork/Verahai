import { useMemo } from 'react';
import { useMarketStore } from '../state/marketStore';

export const useMarket = () => {
  const { markets, activeMarketId } = useMarketStore();

  return useMemo(
    () => markets.find((market) => market.id === activeMarketId) ?? markets[0] ?? null,
    [markets, activeMarketId]
  );
};
