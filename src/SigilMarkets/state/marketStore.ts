import { create } from 'zustand';
import type { MarketSummary } from '../types/marketTypes';

interface MarketState {
  markets: MarketSummary[];
  activeMarketId: string | null;
  setActiveMarket: (id: string) => void;
  setMarkets: (markets: MarketSummary[]) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  markets: [],
  activeMarketId: null,
  setActiveMarket: (id) => set({ activeMarketId: id }),
  setMarkets: (markets) => set({ markets })
}));
